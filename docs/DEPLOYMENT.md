# 公開手順・ステージング侵入テスト計画

> いずれも **未実施**。実施者・日付・結果を記入して運用記録とすること。

## 1. Supabase（ステージング → 本番の順）

1. プロジェクト作成（ステージングと本番を分ける）。リージョン・課金上限を決定。
2. マイグレーション適用：`npx supabase link --project-ref <ref>` → `npx supabase db push`
   （`seed.sql` は本番に投入しない）
3. 適用確認（SQL Editor）：
   ```sql
   -- anon に public の権限が無いこと（0 行）
   select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public';
   select table_name from information_schema.column_privileges where grantee='anon' and table_schema='public';
   -- 全テーブルで RLS 有効（0 行）
   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
   ```
4. Database → Advisors（Security / Performance）を実行し、警告を確認・記録。
5. Integrations → Data API：公開スキーマが `public`（と必要なら `graphql_public`）のみであることを確認。GraphQL を使わないなら pg_graphql の無効化を検討。
6. Google OAuth を設定（[GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md)）。Email プロバイダのサインアップを無効化。
7. 最初の管理者を登録（[ADMIN_GUIDE.md](ADMIN_GUIDE.md) §1）、2 人目の管理者を登録。

## 2. Vercel

1. リポジトリを接続（Framework: Vite、`vercel.json` 同梱）。
2. 環境変数 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` を Production / Preview 別に設定（Preview はステージングの Supabase）。
3. カスタムドメインを使う場合、`vercel.json` の CSP `connect-src` を Supabase のカスタムドメインに合わせて修正。
4. デプロイ後：`npm run check:bundle` 相当の確認（配布 JS に secret が無いこと）、レスポンスヘッダ（CSP・no-store）を確認。

## 3. ステージング権限侵入テスト（本番前に必須）

検証アカウント：A（全 8 分類）、B（LIFE STAGE1.0 のみ）、C（不動産事業・資料作成チーム）、未承認（pending）、停止者（suspended）、管理者 2 名。
**実際の Google アカウント**でログインして実施する（ローカル試験の JWT 発行方式は使わない）。

| # | 内容 | 方法 | 合否 |
| --- | --- | --- | --- |
| P1 | 各アカウントの HOME・検索・目的・アプリ表示が設定通り（T03〜T05, T08） | 画面＋DevTools の Network 応答を保存 | |
| P2 | B が他分類の URL 直打ち・古いブックマーク（T06） | `/c/leistyle-dx` 等 | |
| P3 | B のアクセストークンで REST を直接呼出（T07） | DevTools で Authorization を取得し `curl https://<ref>.supabase.co/rest/v1/catalog_apps?select=id,title,launch_url` 等、`select=*`、埋め込み `app_purposes?select=*,purposes(*)`、RPC `search_hub` | |
| P4 | 権限撤回：管理者が B の分類を OFF → 同じトークンで再取得（T09） | | |
| P5 | 利用者切替：同じブラウザで A → ログアウト → B（T10） | 戻るボタン・bfcache も確認 | |
| P6 | A が管理 RPC・権限テーブル書込（T11, T12） | `rpc/admin_save_user_access`、`role_assignments` への POST、`profiles` PATCH | |
| P7 | B が A の SELF の ID を指定して GET/PATCH/DELETE、`user_id` 偽装 POST（T13, T14） | | |
| P8 | 同じアカウントでスマホ・PC 同期（T15） | 実機 2 台 | |
| P9 | 共通アプリ保存後の撤回（T16） | | |
| P10 | 危険 URL・新規タブ起動（T17） | `javascript:` 等を UI と REST の両方で | |
| P11 | 未承認申請の非公開・承認後公開（T18）、複数分類掲載（T19） | | |
| P12 | 停止者（T20）・未承認者（T02）の全 API 拒否 | | |
| P13 | 配布 JS・ログ・ブラウザストレージに秘密鍵や他人の SELF が無い（T21） | Vercel のビルド成果物、DevTools Application タブ、Supabase ログ | |
| P14 | anon（未ログイン）で REST・OpenAPI ルート `/rest/v1/` | 401/42501 で何も返らない | |

1 件でも権限外データが返った場合は公開を停止し、原因修正後に全項目を再実施する。

## 4. 実機利用テスト（T22）

5 名以上に説明なしで「分類 → 目的 → アプリ起動」を依頼し、所要時間（目標 20 秒以内・80% 以上）・迷った箇所・用途理解を記録。分類説明文（特に AFTER STORY）を確定する。

## 5. 公開判定

T01〜T22 すべて合格、重大な権限漏えい 0 件、利用者テストの改善を反映 → 本番の Google OAuth 公開ステータス・ドメインを最終確認して公開。
