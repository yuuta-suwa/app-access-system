// =====================================================================
// LEI APP HUB DB 認可テスト（ローカル PostgreSQL 疑似環境）
//   ※ 実 Supabase / 実 Google OAuth を使った「実環境テスト」ではない。
//   前提: npm run db:local でマイグレーション適用済み DB を起動しておくこと。
// =====================================================================
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { as, denied, superuser, createAuthUser } from './helpers.mjs';

const U = {};
const P = {};
const APP = {};
const ALL = [1, 2, 3, 4, 5, 6, 7, 8];

async function saveAccess(uid, status, cats, reason = 'test') {
  return as(U.admin, 'select public.admin_save_user_access($1, $2, $3::smallint[], $4) as r', [uid, status, cats, reason]);
}

before(async () => {
  const run = Date.now();
  for (const k of ['admin', 'A', 'B', 'C', 'D', 'pending', 'suspended', 'creator']) {
    U[k] = await createAuthUser(`${k.toLowerCase()}-${run}@example.test`, `${k} さん`);
  }
  // 最初の管理者は DB 運営者がブートストラップ（bootstrap_first_admin.sql と同等）
  await superuser(`update public.profiles set status='active' where user_id=$1`, [U.admin]);
  await superuser(`insert into public.role_assignments (user_id, role) values ($1,'admin')`, [U.admin]);

  await saveAccess(U.A, 'active', ALL);
  await saveAccess(U.B, 'active', [2]);
  await saveAccess(U.C, 'active', [5, 8]);
  await saveAccess(U.D, 'active', []);
  await saveAccess(U.suspended, 'active', [2]);
  await saveAccess(U.creator, 'active', [2]);
  await as(U.admin, `select public.admin_set_roles($1, array['creator'], 'creator 付与')`, [U.creator]);

  const purpose = async (cat, title) =>
    (await as(U.admin, `select public.admin_save_purpose(null, $1::smallint, $2, null) as id`, [cat, title])).rows[0].id;
  P.dx = await purpose(1, '業務フローを整えたい');
  P.ls1 = await purpose(2, '自分の価値観を整理したい');
  P.re = await purpose(5, '顧客の進捗を確認したい');
  P.docs = await purpose(8, '資料を共同編集したい');

  const app = async (title, status, purposes, url) =>
    (
      await as(
        U.admin,
        `select public.admin_save_app(null, $1, $2, 'outcome', 'scene', $3, 'owner', current_date, $4, $5::uuid[], 'test') as id`,
        [title, `${title} の説明`, url, status, purposes],
      )
    ).rows[0].id;
  APP.dx = await app('DXフロー設計ツール', 'approved', [P.dx], 'https://dx.example.test/app');
  APP.ls1 = await app('価値観ワークシート', 'approved', [P.ls1], 'https://ls1.example.test/app');
  APP.shared = await app('共通スケジューラ', 'approved', [P.ls1, P.re], 'https://shared.example.test/app');
  APP.re = await app('顧客進捗ボード', 'approved', [P.re], 'https://re.example.test/app');
  APP.draft = await app('未承認の下書きアプリ', 'draft', [P.ls1], 'https://draft.example.test/app');
});

// ---------------------------------------------------------------------
test('GRANT: anon には public テーブル権限・関数実行権限が一切無い', async () => {
  const tables = await superuser(
    `select table_name, privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'`,
  );
  assert.deepEqual(tables, []);
  const cols = await superuser(
    `select table_name from information_schema.column_privileges where grantee='anon' and table_schema='public'`,
  );
  assert.deepEqual(cols, []);
  const funcs = await superuser(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'execute')`,
  );
  assert.deepEqual(funcs, []);
});

test('GRANT: authenticated は権限・監査・招待・プリセットテーブルに書込権限を持たない', async () => {
  const rows = await superuser(
    `select table_name, privilege_type from information_schema.role_table_grants
     where grantee='authenticated' and table_schema='public'
       and table_name in ('profiles','categories','user_category_permissions','role_assignments',
                          'permission_audit_logs','user_invitations','permission_presets','purposes',
                          'catalog_apps','app_purposes')
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
  );
  assert.deepEqual(rows, []);
  const audit = await superuser(
    `select privilege_type from information_schema.role_table_grants where grantee='authenticated' and table_name in ('permission_audit_logs','user_invitations','permission_presets')`,
  );
  assert.deepEqual(audit, []);
});

test('GRANT: authenticated が実行できる関数は明示した一覧のみ', async () => {
  const rows = await superuser(
    `select n.nspname||'.'||p.proname as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','app_private') and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
  );
  const allowed = new Set([
    'app_private.can_view_app', 'app_private.can_view_category', 'app_private.can_view_purpose',
    'app_private.has_role', 'app_private.is_active', 'app_private.is_admin',
    'public.get_my_access', 'public.search_hub',
  ]);
  for (const { f } of rows) {
    assert.ok(allowed.has(f) || f.startsWith('public.admin_'), `unexpected executable function: ${f}`);
  }
  // トリガ関数・内部関数は実行不可
  assert.ok(!rows.some((r) => /handle_new_auth_user|assert_admin|replace_app_purposes|forbid_/.test(r.f)));
});

test('GRANT: 全 public テーブルで RLS が有効', async () => {
  const rows = await superuser(
    `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
  );
  assert.deepEqual(rows, []);
});

test('未ログイン(anon): 共通アプリ・目的・分類・SELF を取得できない', async () => {
  for (const t of ['categories', 'purposes', 'catalog_apps', 'app_purposes', 'personal_items', 'profiles']) {
    const e = await denied(null, `select * from public.${t}`);
    assert.equal(e.code, '42501', t);
  }
  const e = await denied(null, `select public.search_hub('a')`);
  assert.equal(e.code, '42501');
});

// ---------------------------------------------------------------------
test('T01 Google ログイン（DB 部）: 初回ログインで本人 UUID の profile が pending・分類 0・ロールなしで作成', async () => {
  const uid = await createAuthUser(`new-${Date.now()}@example.test`, '新規');
  const [p] = await superuser(`select status from public.profiles where user_id=$1`, [uid]);
  assert.equal(p.status, 'pending');
  const [c] = await superuser(`select count(*)::int n from public.user_category_permissions where user_id=$1`, [uid]);
  assert.equal(c.n, 0);
  const [r] = await superuser(`select count(*)::int n from public.role_assignments where user_id=$1`, [uid]);
  assert.equal(r.n, 0);
  const { rows } = await as(uid, `select public.get_my_access() as a`);
  assert.equal(rows[0].a.user_id, uid);
  assert.equal(rows[0].a.status, 'pending');
});

test('T01 補足: user_metadata に admin を書いても権限は付かない', async () => {
  const [{ id }] = await superuser(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
     values ($1, now(), '{"role":"admin","admin":true,"status":"active"}', '{"role":"admin"}') returning id`,
    [`meta-${Date.now()}@example.test`],
  );
  const { rows } = await as(id, `select public.get_my_access() as a`);
  assert.equal(rows[0].a.status, 'pending');
  const e = await denied(id, `select * from public.admin_list_users(null)`);
  assert.equal(e.code, '42501');
});

test('T02 初回未承認: pending は分類・目的・共通アプリ・SELF を取得できない', async () => {
  const uid = U.pending;
  for (const t of ['categories', 'purposes', 'catalog_apps', 'app_purposes', 'personal_items', 'personal_folders', 'user_category_permissions']) {
    const cols = t === 'catalog_apps' ? 'id, title, launch_url' : t === 'personal_items' ? 'id' : t === 'personal_folders' ? 'id' : t === 'app_purposes' ? 'app_id' : t === 'user_category_permissions' ? 'category_id' : 'id';
    const { rows } = await as(uid, `select ${cols} from public.${t}`);
    assert.equal(rows.length, 0, t);
  }
  const s = await as(uid, `select * from public.search_hub('アプリ')`);
  assert.equal(s.rows.length, 0);
  const e = await denied(uid, `insert into public.personal_items (kind, external_url, custom_title) values ('link','https://example.com','x')`);
  assert.equal(e.code, '42501');
  // 自分の状態だけは取得可能（承認待ち画面のため）
  const me = await as(uid, `select status from public.profiles`);
  assert.deepEqual(me.rows, [{ status: 'pending' }]);
});

test('T03 A さん: 全 8 分類が表示され、管理者ではない', async () => {
  const { rows } = await as(U.A, `select code from public.categories order by sort_order`);
  assert.equal(rows.length, 8);
  const a = await as(U.A, `select public.get_my_access() as a`);
  assert.deepEqual(a.rows[0].a.roles, []);
});

test('T04 B さん: LIFE STAGE1.0 だけ。他分類の目的・アプリは存在しない', async () => {
  const c = await as(U.B, `select title from public.categories`);
  assert.deepEqual(c.rows.map((r) => r.title), ['LIFE STAGE1.0']);
  const p = await as(U.B, `select id from public.purposes`);
  assert.deepEqual(p.rows.map((r) => r.id), [P.ls1]);
  const a = await as(U.B, `select id from public.catalog_apps order by title`);
  assert.deepEqual(new Set(a.rows.map((r) => r.id)), new Set([APP.ls1, APP.shared]));
});

test('T05 C さん: 指定した 2 分類のみ', async () => {
  const c = await as(U.C, `select code from public.categories order by sort_order`);
  assert.deepEqual(c.rows.map((r) => r.code), ['real-estate', 'docs-team']);
});

test('D さん: 0 分類・承認済み → 共通分類なし、SELF は利用可能', async () => {
  const c = await as(U.D, `select id from public.categories`);
  assert.equal(c.rows.length, 0);
  await as(U.D, `insert into public.personal_items (kind, external_url, custom_title) values ('link','https://example.com/d','D link')`);
  const i = await as(U.D, `select custom_title from public.personal_items`);
  assert.deepEqual(i.rows, [{ custom_title: 'D link' }]);
});

test('T06 禁止カテゴリの URL 直打ち相当: code 指定でも 0 件（存在有無も区別できない）', async () => {
  const forbidden = await as(U.B, `select id from public.categories where code='leistyle-dx'`);
  const missing = await as(U.B, `select id from public.categories where code='no-such-category'`);
  assert.equal(forbidden.rows.length, 0);
  assert.equal(missing.rows.length, 0);
  const pur = await as(U.B, `select id from public.purposes where category_id = 1`);
  assert.equal(pur.rows.length, 0);
});

test('T07 API 直接呼出: 権限なしの目的・アプリ名・利用 URL が返らない', async () => {
  const a = await as(U.B, `select title, launch_url from public.catalog_apps where id=$1`, [APP.dx]);
  assert.equal(a.rows.length, 0);
  const ap = await as(U.B, `select purpose_id from public.app_purposes where app_id=$1`, [APP.shared]);
  assert.deepEqual(ap.rows.map((r) => r.purpose_id), [P.ls1], '別分類(不動産)の目的との対応は漏れない');
  const pu = await as(U.B, `select title from public.purposes where id=$1`, [P.re]);
  assert.equal(pu.rows.length, 0);
  // 列 GRANT 外の列（owner_id など）は取得不可
  const e = await denied(U.B, `select owner_id from public.catalog_apps`);
  assert.equal(e.code, '42501');
});

test('T08 検索: 未許可分類の名前・アプリが結果に出ない', async () => {
  const b = await as(U.B, `select result_type, title from public.search_hub('DX')`);
  assert.equal(b.rows.length, 0);
  const b2 = await as(U.B, `select result_type, title from public.search_hub('顧客')`);
  assert.equal(b2.rows.length, 0, '不動産の目的・アプリが出ない');
  const a = await as(U.A, `select result_type, title from public.search_hub('DX')`);
  assert.ok(a.rows.some((r) => r.title === 'DXフロー設計ツール'));
  // ワイルドカードの注入で全件化しない
  const w = await as(U.B, `select * from public.search_hub('%')`);
  assert.equal(w.rows.length, 0);
});

test('T09 権限の即時撤回: OFF 後の再取得で元カテゴリの情報を取得できない', async () => {
  const before = await as(U.B, `select id from public.catalog_apps where id=$1`, [APP.ls1]);
  assert.equal(before.rows.length, 1);
  await saveAccess(U.B, 'active', [], 'T09 撤回');
  for (const q of [
    [`select id from public.categories`],
    [`select id from public.purposes`],
    [`select id from public.catalog_apps`],
    [`select * from public.search_hub('価値観')`],
  ]) {
    const r = await as(U.B, ...q);
    assert.equal(r.rows.length, 0, q[0]);
  }
  await saveAccess(U.B, 'active', [2], 'T09 復旧');
});

test('T10 利用者切替（DB 部）: 同一接続でも JWT の sub が変われば結果が切り替わる', async () => {
  const a = await as(U.A, `select count(*)::int n from public.categories`);
  const b = await as(U.B, `select count(*)::int n from public.categories`);
  assert.equal(a.rows[0].n, 8);
  assert.equal(b.rows[0].n, 1);
});

test('T11 管理権限の分離: 全分類を閲覧できる A でも管理操作は拒否', async () => {
  for (const sql of [
    [`select * from public.admin_list_users(null)`],
    [`select public.admin_save_user_access($1,'active','{1}'::smallint[],'x')`, [U.B]],
    [`select public.admin_set_roles($1, array['admin'], 'x')`, [U.A]],
    [`select * from public.admin_list_audit_logs(null, 10)`],
    [`select * from public.admin_list_apps()`],
    [`select public.admin_save_app(null,'x','','','','https://x.example','o',null,'approved','{}'::uuid[],'x')`],
  ]) {
    const e = await denied(U.A, ...sql);
    assert.equal(e.code, '42501', sql[0]);
  }
});

test('T12 管理画面の不正操作: 通常利用者は権限テーブル・操作ログを改変できない', async () => {
  const cases = [
    [`insert into public.user_category_permissions (user_id, category_id) values ($1, 1)`, [U.B]],
    [`delete from public.user_category_permissions where user_id=$1`, [U.B]],
    [`insert into public.role_assignments (user_id, role) values ($1, 'admin')`, [U.B]],
    [`update public.profiles set status='active' where user_id=$1`, [U.B]],
    [`select * from public.permission_audit_logs`],
    [`delete from public.permission_audit_logs`],
    [`insert into public.permission_audit_logs (action) values ('fake')`],
    [`select * from public.permission_presets`],
    [`select * from public.user_invitations`],
    [`update public.catalog_apps set launch_url='https://evil.example'`],
    [`insert into public.categories (id, code, title, description, sort_order) values (9,'self','SELF','x',9)`],
  ];
  for (const [sql, params] of cases) {
    const e = await denied(U.B, sql, params ?? []);
    assert.equal(e.code, '42501', sql);
  }
  // DB 所有者であっても監査ログは追記専用
  await assert.rejects(superuser(`delete from public.permission_audit_logs`), /append-only/);
  await assert.rejects(superuser(`update public.permission_audit_logs set reason='x'`), /append-only/);
});

test('T12 補足: 管理者でも自分のロール・状態は変更できず、最後の管理者は外せない', async () => {
  const e1 = await denied(U.admin, `select public.admin_set_roles($1, array[]::text[], 'self')`, [U.admin]);
  assert.equal(e1.code, '42501');
  const e2 = await denied(U.admin, `select public.admin_save_user_access($1, 'suspended', '{}'::smallint[], 'self')`, [U.admin]);
  assert.equal(e2.code, '42501');
});

test('監査ログ: 権限変更時に操作者・対象・内容・時刻・理由が記録される', async () => {
  await saveAccess(U.C, 'active', [5, 8, 3], '監査テスト追加');
  await saveAccess(U.C, 'active', [5, 8], '監査テスト削除');
  const { rows } = await as(U.admin, `select * from public.admin_list_audit_logs($1, 10)`, [U.C]);
  const grant = rows.find((r) => r.action === 'category.grant' && r.category_id === 3);
  const revoke = rows.find((r) => r.action === 'category.revoke' && r.category_id === 3);
  assert.ok(grant && revoke);
  assert.equal(grant.actor_id, U.admin);
  assert.equal(grant.target_user_id, U.C);
  assert.equal(grant.reason, '監査テスト追加');
  assert.ok(grant.at instanceof Date);
  // 理由なしは拒否
  const e = await denied(U.admin, `select public.admin_save_user_access($1,'active','{5}'::smallint[], '')`, [U.C]);
  assert.equal(e.code, '22023');
});

test('管理者ロールと閲覧許可は独立: 分類 0 の管理者は HOME に分類が出ないが管理 RPC で 8 分類を扱える', async () => {
  const home = await as(U.admin, `select id from public.categories`);
  assert.equal(home.rows.length, 0);
  const adm = await as(U.admin, `select * from public.admin_list_categories()`);
  assert.equal(adm.rows.length, 8);
  // 全分類 ON にしても admin ロールは付与されない
  const r = await as(U.A, `select role from public.role_assignments`);
  assert.equal(r.rows.length, 0);
});

// ---------------------------------------------------------------------
test('T13 SELF の個別性: A の保存情報は B の API に存在せず、管理者も参照できない', async () => {
  await as(U.A, `insert into public.personal_items (kind, external_url, custom_title) values ('link','https://a.example.test/private','A の私物リンク')`);
  const b = await as(U.B, `select custom_title from public.personal_items`);
  assert.ok(!b.rows.some((r) => r.custom_title === 'A の私物リンク'));
  const adm = await as(U.admin, `select id from public.personal_items`);
  assert.equal(adm.rows.length, 0, '管理者も他人の SELF を見られない');
  const funcs = await superuser(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'admin_%' and p.prosrc ilike '%personal_%'`,
  );
  assert.deepEqual(funcs, [], '管理 RPC は personal_* を参照しない');
});

test('T14 SELF の書込検証: B は A の ID 指定で取得・更新・削除できず、所有者差替えもできない', async () => {
  const [{ id: aItem }] = await superuser(
    `select id from public.personal_items where user_id=$1 and custom_title='A の私物リンク'`,
    [U.A],
  );
  const sel = await as(U.B, `select * from public.personal_items where id=$1`, [aItem]);
  assert.equal(sel.rows.length, 0);
  const upd = await as(U.B, `update public.personal_items set custom_title='hacked' where id=$1`, [aItem]);
  assert.equal(upd.rowCount, 0);
  const del = await as(U.B, `delete from public.personal_items where id=$1`, [aItem]);
  assert.equal(del.rowCount, 0);
  const [still] = await superuser(`select custom_title from public.personal_items where id=$1`, [aItem]);
  assert.equal(still.custom_title, 'A の私物リンク');

  const e1 = await denied(U.B, `insert into public.personal_items (user_id, kind, external_url, custom_title) values ($1,'link','https://x.example','x')`, [U.A]);
  assert.equal(e1.code, '42501', 'user_id 指定の INSERT は列 GRANT で拒否');
  const e2 = await denied(U.A, `update public.personal_items set user_id=$1 where id=$2`, [U.B, aItem]);
  assert.equal(e2.code, '42501', 'user_id の UPDATE は拒否');

  // 他人のフォルダへの格納も不可（複合 FK）
  const { rows: [f] } = await as(U.A, `insert into public.personal_folders (name) values ('A フォルダ') returning id`);
  const e3 = await denied(U.B, `insert into public.personal_items (kind, external_url, custom_title, folder_id) values ('link','https://x.example','x',$1)`, [f.id]);
  assert.equal(e3.code, '23503');
  const fu = await as(U.B, `update public.personal_folders set name='x' where id=$1`, [f.id]);
  assert.equal(fu.rowCount, 0);
});

test('T15 SELF 端末同期（DB 部）: 同じユーザー ID の別セッションから同じ項目が見える', async () => {
  await as(U.A, `insert into public.personal_items (kind, external_url, custom_title) values ('link','https://a.example.test/phone','スマホで登録')`);
  const pc = await as(U.A, `select custom_title from public.personal_items where custom_title='スマホで登録'`);
  assert.equal(pc.rows.length, 1);
});

test('T16 SELF の共通リンク: 分類撤回後は保存済み共通アプリのタイトル・URL・説明が漏れず、削除だけ可能', async () => {
  const { rows: [it] } = await as(U.C, `insert into public.personal_items (kind, catalog_app_id) values ('catalog',$1) returning id`, [APP.re]);
  await saveAccess(U.C, 'active', [8], 'T16 不動産撤回');
  const item = await as(U.C, `select * from public.personal_items where id=$1`, [it.id]);
  assert.equal(item.rows.length, 1);
  assert.equal(item.rows[0].custom_title, null);
  assert.equal(item.rows[0].external_url, null);
  const app = await as(U.C, `select title, launch_url, description from public.catalog_apps where id=$1`, [APP.re]);
  assert.equal(app.rows.length, 0);
  // タイトルを複製して保存する抜け道も無い
  const e = await denied(U.C, `update public.personal_items set custom_title='x' where id=$1`, [it.id]);
  assert.equal(e.code, '23514');
  const del = await as(U.C, `delete from public.personal_items where id=$1`, [it.id]);
  assert.equal(del.rowCount, 1);
  await saveAccess(U.C, 'active', [5, 8], 'T16 復旧');
});

test('SELF-03: 許可されていない共通アプリは保存できない', async () => {
  const e = await denied(U.B, `insert into public.personal_items (kind, catalog_app_id) values ('catalog',$1)`, [APP.dx]);
  assert.equal(e.code, '42501');
  const e2 = await denied(U.B, `insert into public.personal_items (kind, catalog_app_id) values ('catalog',$1)`, [APP.draft]);
  assert.equal(e2.code, '42501');
  await as(U.B, `insert into public.personal_items (kind, catalog_app_id) values ('catalog',$1)`, [APP.ls1]);
});

test('T17 URL 入力の安全性: 危険スキーム・http を DB で拒否', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'http://example.com', 'vbscript:x', 'https://exa mple.com', ' https://x.example']) {
    const e = await denied(U.A, `insert into public.personal_items (kind, external_url, custom_title) values ('link',$1,'x')`, [url]);
    assert.equal(e.code, '23514', url);
  }
  const e = await denied(U.admin, `select public.admin_save_app(null,'x','','','','javascript:alert(1)','o',null,'approved','{}'::uuid[],'x')`);
  assert.equal(e.code, '23514');
});

test('T18 登録審査: 未承認（draft）の共通アプリ・申請中データは公開されない', async () => {
  const a = await as(U.A, `select id from public.catalog_apps where id=$1`, [APP.draft]);
  assert.equal(a.rows.length, 0);
  const payload = { title: '申請中アプリ', description: 'd', outcome: 'o', usage_scene: 's', launch_url: 'https://sub.example.test', purpose_ids: [P.ls1], owner_name: '制作者' };
  const { rows: [s] } = await as(U.creator, `insert into public.app_submissions (payload) values ($1) returning id, status`, [payload]);
  assert.equal(s.status, 'submitted');
  const e = await denied(U.B, `insert into public.app_submissions (payload) values ($1)`, [payload]);
  assert.equal(e.code, '42501', 'creator 以外は申請不可');
  const e2 = await denied(U.creator, `insert into public.app_submissions (payload, status) values ($1, 'approved')`, [payload]);
  assert.equal(e2.code, '42501', '申請者は status を指定できない');
  const vis = await as(U.B, `select * from public.search_hub('申請中')`);
  assert.equal(vis.rows.length, 0);
  const own = await as(U.creator, `select status from public.app_submissions`);
  assert.equal(own.rows.length, 1);
  const other = await as(U.B, `select id from public.app_submissions`);
  assert.equal(other.rows.length, 0);

  const { rows: [r] } = await as(U.admin, `select public.admin_review_submission($1, 'approved', 'OK') as app_id`, [s.id]);
  const now = await as(U.B, `select title from public.catalog_apps where id=$1`, [r.app_id]);
  assert.deepEqual(now.rows, [{ title: '申請中アプリ' }]);
});

test('T19 複数分類掲載: 同じアプリ ID を再利用し、許可分類経由のみ表示', async () => {
  const b = await as(U.B, `select id from public.catalog_apps where id=$1`, [APP.shared]);
  const c = await as(U.C, `select id from public.catalog_apps where id=$1`, [APP.shared]);
  assert.equal(b.rows[0].id, APP.shared);
  assert.equal(c.rows[0].id, APP.shared);
  const cp = await as(U.C, `select purpose_id from public.app_purposes where app_id=$1`, [APP.shared]);
  assert.deepEqual(cp.rows.map((r) => r.purpose_id), [P.re]);
});

test('T20 利用停止: suspended は新しいデータ取得・SELF 操作が拒否される', async () => {
  await as(U.suspended, `insert into public.personal_items (kind, external_url, custom_title) values ('link','https://s.example','S')`);
  await saveAccess(U.suspended, 'suspended', [2], 'T20 停止');
  for (const t of ['categories', 'purposes', 'personal_items']) {
    const r = await as(U.suspended, `select id from public.${t}`);
    assert.equal(r.rows.length, 0, t);
  }
  const ca = await as(U.suspended, `select id from public.catalog_apps`);
  assert.equal(ca.rows.length, 0);
  const del = await as(U.suspended, `delete from public.personal_items`);
  assert.equal(del.rowCount, 0);
  const me = await as(U.suspended, `select public.get_my_access() as a`);
  assert.equal(me.rows[0].a.status, 'suspended');
  assert.deepEqual(me.rows[0].a.category_ids, []);
});

test('招待: 事前招待メールの初回ログインで本人紐づけ・指定分類のみ付与（未検証メールは対象外）', async () => {
  const email = `invited-${Date.now()}@example.test`;
  await as(U.admin, `select public.admin_invite_user($1, '{2}'::smallint[], '招待テスト')`, [email]);
  const uid = await createAuthUser(email, '招待さん');
  const { rows } = await as(uid, `select public.get_my_access() as a`);
  assert.equal(rows[0].a.status, 'active');
  assert.deepEqual(rows[0].a.category_ids, [2]);
  assert.deepEqual(rows[0].a.roles, []);

  const email2 = `unverified-${Date.now()}@example.test`;
  await as(U.admin, `select public.admin_invite_user($1, '{1}'::smallint[], '未検証テスト')`, [email2]);
  const [{ id }] = await superuser(`insert into auth.users (email) values ($1) returning id`, [email2]);
  const r2 = await as(id, `select public.get_my_access() as a`);
  assert.equal(r2.rows[0].a.status, 'pending');
});

test('プリセット編集は既存利用者の権限を変更しない', async () => {
  const { rows: [p] } = await as(U.admin, `select id from public.admin_list_presets() where name='LIFE STAGE1.0'`);
  const before = await as(U.B, `select count(*)::int n from public.categories`);
  await as(U.admin, `select public.admin_save_preset($1, 'LIFE STAGE1.0', '{2,3}'::smallint[], 20::smallint)`, [p.id]);
  const after = await as(U.B, `select count(*)::int n from public.categories`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});
