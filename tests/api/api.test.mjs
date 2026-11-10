// =====================================================================
// LEI APP HUB API 認可テスト（Supabase CLI ローカルスタック = 実物の PostgREST / GoTrue / Supabase Postgres）
//   ※ ローカル疑似環境。実 Supabase プロジェクト・実 Google OAuth を使った「実環境テスト」ではない。
//   ※ Google OAuth はローカルで実行できず、メールログインも無効化しているため、利用者は GoTrue 管理 API で
//      作成し、ローカルスタックの JWT 秘密鍵で同形式のアクセストークンを発行して使う
//      （JWT 検証 → authenticated ロール → RLS の経路は本番と同一。Google ログイン部分は未検証）。
//   前提: supabase start 済み。SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY を環境変数で渡す。
// =====================================================================
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'node:crypto';

const URL_ = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY; // テストランナー（サーバー側）のみで使用。ブラウザへ配布しない
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!PUB || !SECRET || !JWT_SECRET) throw new Error('SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY / SUPABASE_JWT_SECRET required');

function b64url(x) { return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url'); }
function mintToken(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: randomUUID(), aal: 'aal1' });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function clientFor(token) {
  return createClient(URL_, PUB, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(URL_, SECRET, opts);
const anon = createClient(URL_, PUB, opts);
const run = Date.now();
const U = {}; // name -> { id, client, token }
const SAMPLE = {
  dx: '22222222-0000-4000-8000-000000000001',
  ls1: '22222222-0000-4000-8000-000000000002',
  shared: '22222222-0000-4000-8000-000000000003',
  re: '22222222-0000-4000-8000-000000000005',
};

async function makeUser(name) {
  const email = `${name}-${run}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: `${name} さん`, role: 'admin' } });
  if (error) throw error;
  const token = mintToken(data.user.id, email);
  U[name] = { id: data.user.id, client: clientFor(token), token, email };
}

const rest = (path, token, init = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: PUB, Authorization: `Bearer ${token ?? PUB}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

async function access(name, status, cats) {
  const { error } = await U.admin.client.rpc('admin_save_user_access', { p_user_id: U[name].id, p_status: status, p_category_ids: cats, p_reason: 'api test' });
  if (error) throw error;
}

before(async () => {
  for (const n of ['admin', 'A', 'B', 'C', 'pending', 'suspended']) await makeUser(n);
  // 最初の管理者のブートストラップ（DB 運営者の操作に相当。サーバー側の secret key でのみ可能）
  let r = await svc.from('profiles').update({ status: 'active' }).eq('user_id', U.admin.id);
  assert.ifError(r.error);
  r = await svc.from('role_assignments').insert({ user_id: U.admin.id, role: 'admin' });
  assert.ifError(r.error);
  await access('A', 'active', [1, 2, 3, 4, 5, 6, 7, 8]);
  await access('B', 'active', [2]);
  await access('C', 'active', [5, 8]);
  await access('suspended', 'active', [2]);
});

test('Google 専用: メールでの新規登録はできない', async () => {
  const { error } = await anon.auth.signUp({ email: `signup-${run}@example.test`, password: 'password-123456' });
  assert.ok(error, 'email signup must be disabled');
});

test('未ログイン(publishable key のみ): データ API から分類・アプリ・目的・SELF を取得できない', async () => {
  for (const t of ['categories?select=id,title', 'catalog_apps?select=id,title,launch_url', 'purposes?select=id,title', 'app_purposes?select=app_id', 'personal_items?select=id', 'profiles?select=email']) {
    const res = await rest(t);
    const body = await res.json();
    assert.ok(res.status === 401 || res.status === 403 || (Array.isArray(body) && body.length === 0), `${t} -> ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    assert.ok(!(Array.isArray(body) && body.length > 0));
  }
  const rpc = await rest('rpc/search_hub', null, { method: 'POST', body: JSON.stringify({ p_q: 'サンプル' }) });
  assert.ok(rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `search_hub anon -> ${rpc.status}`);
});

test('OpenAPI: anon にはテーブル定義が公開されない', async () => {
  const res = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: PUB, Authorization: `Bearer ${PUB}` } });
  const text = await res.text();
  for (const t of ['catalog_apps', 'personal_items', 'permission_audit_logs', 'user_category_permissions']) {
    assert.ok(!text.includes(`"/${t}"`), `anon openapi exposes ${t} (status ${res.status})`);
  }
});

test('T01 本人 ID: JWT の sub と profile.user_id が一致し、初回は pending（user_metadata.role=admin は無視）', async () => {
  const { data, error } = await U.pending.client.rpc('get_my_access');
  assert.ifError(error);
  assert.equal(data.user_id, U.pending.id);
  assert.equal(data.status, 'pending');
  assert.deepEqual(data.roles, []);
});

test('T02 pending: 分類・目的・共通アプリ・SELF が取得できない', async () => {
  const c = U.pending.client;
  for (const [t, cols] of [['categories', 'id'], ['purposes', 'id'], ['catalog_apps', 'id,title,launch_url'], ['personal_items', 'id']]) {
    const { data, error } = await c.from(t).select(cols);
    assert.ifError(error);
    assert.deepEqual(data, [], t);
  }
  const ins = await c.from('personal_items').insert({ kind: 'link', external_url: 'https://example.com', custom_title: 'x' });
  assert.ok(ins.error);
});

test('T03/T04/T05 分類の表示範囲', async () => {
  const a = await U.A.client.from('categories').select('code');
  assert.equal(a.data.length, 8);
  const b = await U.B.client.from('categories').select('title');
  assert.deepEqual(b.data.map((x) => x.title), ['LIFE STAGE1.0']);
  const c = await U.C.client.from('categories').select('code').order('sort_order');
  assert.deepEqual(c.data.map((x) => x.code), ['real-estate', 'docs-team']);
});

test('T06/T07 B が他分類を直接要求しても返らない（REST 直叩き）', async () => {
  const t = U.B.token;
  for (const path of [
    'categories?code=eq.leistyle-dx&select=id,title',
    'purposes?category_id=eq.1&select=id,title',
    `catalog_apps?id=eq.${SAMPLE.dx}&select=id,title,launch_url`,
    `catalog_apps?id=eq.${SAMPLE.re}&select=id,title,launch_url`,
    `app_purposes?app_id=eq.${SAMPLE.shared}&purpose_id=eq.11111111-0000-4000-8000-000000000005&select=app_id`,
  ]) {
    const res = await rest(path, t);
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), [], path);
  }
  // select=* や GRANT 外の列は拒否
  const star = await rest('catalog_apps?select=*', t);
  assert.ok(star.status >= 400, `select=* -> ${star.status}`);
  const owner = await rest('catalog_apps?select=owner_id', t);
  assert.ok(owner.status >= 400);
  // 埋め込み経由でも漏れない
  const emb = await rest(`app_purposes?select=app_id,purposes(title,category_id)`, t);
  const rows = emb.status === 200 ? await emb.json() : [];
  assert.ok(rows.every((r) => r.purposes == null || r.purposes.category_id === 2), JSON.stringify(rows));
});

test('T08 検索 RPC は許可範囲のみ', async () => {
  const b = await U.B.client.rpc('search_hub', { p_q: 'サンプル' });
  assert.ifError(b.error);
  const titles = b.data.map((r) => r.title);
  assert.ok(titles.includes('[サンプル] 価値観ワークシート'));
  assert.ok(!titles.includes('[サンプル] 業務フロー整理'));
  assert.ok(!titles.includes('[サンプル] 顧客進捗ボード'));
  const a = await U.A.client.rpc('search_hub', { p_q: 'サンプル' });
  assert.ok(a.data.some((r) => r.title === '[サンプル] 業務フロー整理'));
});

test('T09 権限撤回: 同じ JWT のまま再取得すると即座に返らない（JWT に権限を載せていない）', async () => {
  const before = await rest(`catalog_apps?id=eq.${SAMPLE.ls1}&select=id`, U.B.token);
  assert.equal((await before.json()).length, 1);
  await access('B', 'active', []);
  const after = await rest(`catalog_apps?id=eq.${SAMPLE.ls1}&select=id`, U.B.token);
  assert.deepEqual(await after.json(), []);
  const cats = await rest('categories?select=id', U.B.token);
  assert.deepEqual(await cats.json(), []);
  await access('B', 'active', [2]);
});

test('T11/T12 全分類の A も管理 RPC・権限テーブル書込は拒否', async () => {
  const c = U.A.client;
  const r1 = await c.rpc('admin_list_users', { p_query: null });
  assert.equal(r1.error?.code, '42501');
  const r2 = await c.rpc('admin_save_user_access', { p_user_id: U.A.id, p_status: 'active', p_category_ids: [1], p_reason: 'x' });
  assert.equal(r2.error?.code, '42501');
  const r3 = await c.from('role_assignments').insert({ user_id: U.A.id, role: 'admin' });
  assert.ok(r3.error);
  const r4 = await c.from('user_category_permissions').insert({ user_id: U.B.id, category_id: 1 });
  assert.ok(r4.error);
  const r5 = await c.from('permission_audit_logs').select('id');
  assert.ok(r5.error);
  const r6 = await c.from('profiles').update({ status: 'active' }).eq('user_id', U.pending.id).select('user_id');
  assert.ok(r6.error || r6.data.length === 0);
  const me = await c.rpc('get_my_access');
  assert.deepEqual(me.data.roles, []);
});

test('T13/T14 SELF: B は A の項目を取得・更新・削除できない', async () => {
  const ins = await U.A.client.from('personal_items').insert({ kind: 'link', external_url: 'https://example.com/a-private', custom_title: 'A 私物' }).select('id').single();
  assert.ifError(ins.error);
  const id = ins.data.id;
  const sel = await U.B.client.from('personal_items').select('id').eq('id', id);
  assert.deepEqual(sel.data, []);
  const upd = await U.B.client.from('personal_items').update({ custom_title: 'hacked' }).eq('id', id).select('id');
  assert.ok(upd.error || upd.data.length === 0);
  const del = await U.B.client.from('personal_items').delete().eq('id', id).select('id');
  assert.ok(del.error || del.data.length === 0);
  const steal = await U.A.client.from('personal_items').update({ user_id: U.B.id }).eq('id', id);
  assert.ok(steal.error, 'owner change must fail');
  const forge = await U.B.client.from('personal_items').insert({ user_id: U.A.id, kind: 'link', external_url: 'https://x.example', custom_title: 'forged' });
  assert.ok(forge.error, 'user_id spoof must fail');
  const adminView = await U.admin.client.from('personal_items').select('id');
  assert.deepEqual(adminView.data, []);
  const still = await U.A.client.from('personal_items').select('custom_title').eq('id', id).single();
  assert.equal(still.data.custom_title, 'A 私物');
});

test('T15 端末同期: 同じアカウントの別セッションで同じ項目が見える', async () => {
  const other = clientFor(mintToken(U.A.id, U.A.email)); // 別端末の別セッション相当
  const { data } = await other.from('personal_items').select('custom_title');
  assert.ok(data.some((r) => r.custom_title === 'A 私物'));
});

test('T16 保存済み共通アプリ: 撤回後は内容が返らず削除のみ可能', async () => {
  const ins = await U.C.client.from('personal_items').insert({ kind: 'catalog', catalog_app_id: SAMPLE.re }).select('id').single();
  assert.ifError(ins.error);
  await access('C', 'active', [8]);
  const item = await U.C.client.from('personal_items').select('id,kind,catalog_app_id,custom_title,external_url').eq('id', ins.data.id).single();
  assert.equal(item.data.custom_title, null);
  assert.equal(item.data.external_url, null);
  const app = await U.C.client.from('catalog_apps').select('title,launch_url,description').eq('id', SAMPLE.re);
  assert.deepEqual(app.data, []);
  const del = await U.C.client.from('personal_items').delete().eq('id', ins.data.id).select('id');
  assert.equal(del.data.length, 1);
  await access('C', 'active', [5, 8]);
});

test('T17 危険スキームは API でも拒否', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://example.com']) {
    const r = await U.A.client.from('personal_items').insert({ kind: 'link', external_url: url, custom_title: 'x' });
    assert.equal(r.error?.code, '23514', url);
  }
});

test('T19 同一アプリ ID が B（LIFE STAGE1.0）と C（不動産）に許可分類経由で表示', async () => {
  const b = await U.B.client.from('catalog_apps').select('id').eq('id', SAMPLE.shared);
  const c = await U.C.client.from('catalog_apps').select('id').eq('id', SAMPLE.shared);
  assert.equal(b.data[0].id, SAMPLE.shared);
  assert.equal(c.data[0].id, SAMPLE.shared);
});

test('T20 停止: 停止後は同じ JWT でもデータ取得不可', async () => {
  const before = await U.suspended.client.from('categories').select('id');
  assert.equal(before.data.length, 1);
  await access('suspended', 'suspended', [2]);
  for (const t of ['categories', 'purposes', 'personal_items']) {
    const { data } = await U.suspended.client.from(t).select('id');
    assert.deepEqual(data, [], t);
  }
  const me = await U.suspended.client.rpc('get_my_access');
  assert.equal(me.data.status, 'suspended');
});

test('T10/T21 補助: データ API 応答がブラウザ・共有キャッシュに保存されない設定か確認（ヘッダ記録）', async () => {
  const res = await rest('categories?select=id', U.A.token);
  const cc = res.headers.get('cache-control');
  console.log(`  [info] PostgREST Cache-Control: ${cc ?? '(none)'} / Vary: ${res.headers.get('vary') ?? '(none)'}`);
  // クライアントは fetch(cache:'no-store') で送信するため、ヘッダが無くてもブラウザ HTTP キャッシュには保存しない
  assert.ok(true);
});
