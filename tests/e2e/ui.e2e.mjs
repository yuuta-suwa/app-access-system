// =====================================================================
// LEI APP HUB 画面 E2E（Playwright + Supabase CLI ローカルスタック + Vite 開発サーバー）
//   ※ ローカル疑似環境。Google ログイン画面の通過は実施できないため、
//     ローカル JWT 秘密鍵で発行したセッションを localStorage に注入して「ログイン後」から検証する。
//   実行: SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... SUPABASE_JWT_SECRET=... node tests/e2e/ui.e2e.mjs
// =====================================================================
import { createRequire } from 'node:module';
// 環境にプリインストールされた Playwright を利用（プロジェクト依存には含めない）
const { chromium } = createRequire(import.meta.url)('playwright');
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const OUT = process.env.EVIDENCE_DIR ?? 'docs/test-evidence';
const STORAGE_KEY = `sb-${new URL(API).hostname.split('.')[0]}-auth-token`;
const svc = createClient(API, SECRET, { auth: { persistSession: false } });
const run = Date.now();
const U = {};
const results = [];

const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: randomUUID(), aal: 'aal1' });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return { access_token: `${head}.${body}.${sig}`, refresh_token: 'local-test', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}
async function mk(name) {
  const email = `ui-${name}-${run}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: `${name}さん` } });
  if (error) throw error;
  U[name] = data.user;
}
async function setAccess(name, status, cats) {
  await svc.from('profiles').update({ status }).eq('user_id', U[name].id);
  await svc.from('user_category_permissions').delete().eq('user_id', U[name].id);
  if (cats.length) await svc.from('user_category_permissions').insert(cats.map((c) => ({ user_id: U[name].id, category_id: c })));
}
async function check(id, title, fn) {
  try {
    await fn();
    results.push({ id, title, ok: true });
    console.log(`ok   ${id} ${title}`);
  } catch (e) {
    results.push({ id, title, ok: false, error: String(e.message ?? e) });
    console.log(`FAIL ${id} ${title}: ${e.message}`);
  }
}
async function login(page, name) {
  await page.goto(`${APP}/robots.txt`);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(U[name]))]);
}
const cardTitles = (page) => page.locator('.cat-card .cat-title').allInnerTexts();

for (const n of ['admin', 'A', 'B', 'C', 'pending', 'suspended']) await mk(n);
await setAccess('admin', 'active', []);
await svc.from('role_assignments').insert({ user_id: U.admin.id, role: 'admin' });
await setAccess('A', 'active', [1, 2, 3, 4, 5, 6, 7, 8]);
await setAccess('B', 'active', [2]);
await setAccess('C', 'active', [5, 8]);
await setAccess('suspended', 'suspended', [2]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// 外部アプリ URL（example.com）はサンドボックスから到達できないためスタブ応答を返す
await ctx.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>ok' }));
const page = await ctx.newPage();

await check('S00', '未ログインはログイン画面のみ（アプリ情報を取得しない）', async () => {
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('/rest/v1/')) requests.push(r.url()); });
  await page.goto(APP);
  await page.getByRole('button', { name: 'Google でログイン' }).waitFor();
  await page.screenshot({ path: `${OUT}/s00-login.png` });
  assert.deepEqual(requests, []);
  page.removeAllListeners('request');
});

await check('T02', '未承認は承認待ち画面', async () => {
  await login(page, 'pending');
  await page.goto(APP);
  await page.getByText('管理者の承認待ちです').waitFor();
  assert.equal(await page.locator('.cat-card').count(), 0);
  await page.screenshot({ path: `${OUT}/t02-pending.png` });
});

await check('T20', '停止者は利用停止画面', async () => {
  await login(page, 'suspended');
  await page.goto(APP);
  await page.getByText('ご利用を停止しています').waitFor();
  await page.screenshot({ path: `${OUT}/t20-suspended.png` });
});

await check('T03', 'A さん: 8 分類＋SELF', async () => {
  await login(page, 'A');
  await page.goto(APP);
  await page.getByText('使う場面を選んでください').waitFor();
  const t = await cardTitles(page);
  assert.equal(t.length, 9, t.join(','));
  assert.equal(t.at(-1), 'SELF');
  assert.equal(await page.getByRole('link', { name: '管理' }).count(), 0, '管理リンクなし');
  await page.screenshot({ path: `${OUT}/t03-home-A.png`, fullPage: true });
});

await check('T10', '利用者切替: A → B で A の表示・SELF が残らない', async () => {
  await page.goto(`${APP}/self`);
  await page.getByLabel('名前').fill('A の私物メモ');
  await page.getByLabel('URL').fill('https://example.com/a-only');
  await page.getByRole('button', { name: '追加する' }).click();
  await page.getByText('A の私物メモ').waitFor();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await page.waitForURL(`${APP}/`); // ログアウト時はフルリロードでメモリを破棄
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: 'Google でログイン' }).waitFor();
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null, 'セッション破棄');
  await login(page, 'B');
  await page.goto(APP);
  await page.getByText('使う場面を選んでください').waitFor();
  const t = await cardTitles(page);
  assert.deepEqual(t, ['LIFE STAGE1.0', 'SELF']);
  await page.goto(`${APP}/self`);
  await page.getByText('あなただけが見られる保管庫です').waitFor();
  assert.equal(await page.getByText('A の私物メモ').count(), 0);
});

await check('T04', 'B さん: LIFE STAGE1.0＋SELF の 2 枚', async () => {
  await page.goto(APP);
  await page.getByText('使う場面を選んでください').waitFor();
  assert.deepEqual(await cardTitles(page), ['LIFE STAGE1.0', 'SELF']);
  await page.screenshot({ path: `${OUT}/t04-home-B.png`, fullPage: true });
});

await check('T06', 'B が他分類 URL を直打ち → 汎用の利用不可画面', async () => {
  for (const path of ['/c/leistyle-dx', '/c/real-estate/p/11111111-0000-4000-8000-000000000005', '/apps/22222222-0000-4000-8000-000000000001', '/admin/users']) {
    await page.goto(APP + path);
    await page.getByText('このページは利用できません').waitFor();
    assert.equal(await page.getByText('[サンプル] 業務フロー整理').count(), 0);
    assert.equal(await page.getByText('顧客の進捗').count(), 0);
  }
  await page.screenshot({ path: `${OUT}/t06-forbidden-url.png` });
});

await check('T08', 'B の検索結果に未許可分類・アプリが出ない', async () => {
  await page.goto(`${APP}/search?q=${encodeURIComponent('サンプル')}`);
  await page.locator('.result-list, .empty').first().waitFor();
  const text = await page.locator('main').innerText();
  assert.ok(text.includes('価値観ワークシート'));
  assert.ok(!text.includes('業務フロー整理') && !text.includes('顧客進捗ボード'));
  await page.screenshot({ path: `${OUT}/t08-search-B.png`, fullPage: true });
});

await check('S02/S03', '分類 → 目的 → アプリ一覧 → 起動ボタン・SELF 保存', async () => {
  await page.goto(APP);
  await page.getByRole('link', { name: /LIFE STAGE1.0/ }).click();
  await page.getByText('何がしたいですか？').waitFor();
  await page.getByRole('link', { name: /自分の価値観を整理したい/ }).click();
  await page.getByRole('heading', { name: '[サンプル] 価値観ワークシート' }).waitFor();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: /アプリを開く/ }).first().click();
  const p = await popup;
  await p.waitForLoadState();
  assert.equal(new URL(p.url()).hostname, 'example.com');
  assert.equal(await p.evaluate(() => window.opener), null, 'noopener');
  await p.close();
  await page.getByRole('button', { name: 'SELF に保存' }).first().click();
  await page.getByRole('button', { name: 'SELF に保存済み' }).first().waitFor();
  await page.screenshot({ path: `${OUT}/s03-apps-B.png`, fullPage: true });
});

await check('T17', 'SELF に javascript: URL を登録できない', async () => {
  await page.goto(`${APP}/self`);
  await page.getByLabel('名前').fill('危険');
  await page.getByLabel('URL').fill('javascript:alert(1)');
  await page.getByText(/https:\/\/ で始まる URL のみ/).first().waitFor();
  await page.getByRole('button', { name: '追加する' }).click();
  assert.equal(await page.locator('.self-item', { hasText: '危険' }).count(), 0);
});

await check('T16', '保存済み共通アプリの権限撤回 → 「アクセスできない項目」＋削除のみ', async () => {
  await setAccess('B', 'active', []);
  await page.goto(`${APP}/self`);
  await page.getByText('アクセスできない項目').waitFor();
  const text = await page.locator('main').innerText();
  assert.ok(!text.includes('価値観ワークシート'));
  await page.screenshot({ path: `${OUT}/t16-self-revoked.png`, fullPage: true });
  page.once('dialog', (d) => d.accept());
  await page.locator('.self-item.unavailable').getByRole('button', { name: '削除' }).click();
  await page.getByText('アクセスできない項目').waitFor({ state: 'detached' });
  await setAccess('B', 'active', [2]);
});

await check('T09', '権限撤回後の再取得（画面復帰）で分類が消える', async () => {
  await page.goto(APP);
  await page.getByText('使う場面を選んでください').waitFor();
  await setAccess('B', 'active', []);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelectorAll('.cat-card').length === 1, null, { timeout: 5000 });
  assert.deepEqual(await cardTitles(page), ['SELF']);
  await setAccess('B', 'active', [2]);
});

await check('S06', '管理者: 利用者一覧→個人の 8 分類 ON/OFF・プリセット・確認ダイアログ', async () => {
  await ctx.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, 'admin');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${APP}/admin/users`);
  await page.getByRole('cell', { name: U.C.email }).waitFor();
  await page.screenshot({ path: `${OUT}/s06-admin-users.png`, fullPage: true });
  await page.getByRole('row', { name: new RegExp(U.C.email) }).getByRole('link', { name: '編集' }).click();
  await page.getByText('共通 8 分類の閲覧許可').waitFor();
  await page.getByRole('button', { name: 'プリセット：LIFE STAGE1.0' }).click();
  await page.getByLabel('変更理由（必須・監査ログに記録）').fill('E2E: プリセット適用');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('次の内容で保存しますか？').waitFor();
  await page.screenshot({ path: `${OUT}/s06-admin-confirm.png`, fullPage: true });
  await page.getByRole('button', { name: '保存する' }).click();
  await page.getByText('保存しました。').waitFor();
  await page.getByRole('cell', { name: 'E2E: プリセット適用' }).first().waitFor();
  await page.screenshot({ path: `${OUT}/s06-admin-detail.png`, fullPage: true });
  const { data } = await svc.from('user_category_permissions').select('category_id').eq('user_id', U.C.id);
  assert.deepEqual(data.map((r) => r.category_id), [2]);
  // 管理画面に SELF の一覧は無い
  assert.equal(await page.getByText('A の私物メモ').count(), 0);
});

await browser.close();
const fail = results.filter((r) => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} passed`);
process.exit(fail.length ? 1 : 0);
