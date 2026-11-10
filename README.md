# LEI APP HUB（Ver.1.1 実装）

Google ログイン後、**利用者ごとに許可された共通 8 分類＋SELF だけ**を表示し、
「分類 → やりたいこと → アプリ起動」を行う Web ポータルです。SELF は本人専用のリンク保管庫です。

> **状態（2026-11-10）**：ソースコード・DB マイグレーション・RLS を実装済み。
> テストは **ローカル疑似環境のみ合格**。実 Supabase プロジェクト・実 Google OAuth・ステージングでの
> 実環境テストは **未実施** です（[docs/TEST_REPORT.md](docs/TEST_REPORT.md)、[docs/OPEN_ISSUES.md](docs/OPEN_ISSUES.md)）。
> 本番公開もしていません。

正本の要件：`LEI_APP_HUB_構想設計_開発仕様書_v1.1`（Ver.1.0 の「未ログインで 8 分類閲覧」「SELF の時だけログイン」は廃止）。

## 構成

| 層 | 採用 |
| --- | --- |
| 画面 | React 18 + TypeScript + Vite 8（SPA）、React Router 7 |
| 認証 | Supabase Auth / Google OAuth（PKCE、追加スコープなし） |
| データ | Supabase PostgreSQL |
| 認可 | PostgreSQL RLS ＋ 列単位の最小 GRANT ＋ 管理用 SECURITY DEFINER RPC |
| 公開 | Vercel 想定（`vercel.json` にセキュリティヘッダ・SPA リライト） |

```
supabase/
  migrations/
    20261110000001_schema.sql      テーブル・制約・トリガ・既定 GRANT の取り消し
    20261110000002_authz_rls.sql   認可関数・RLS ポリシー・列単位 GRANT・初回ログイン時の profile 作成
    20261110000003_rpc.sql         検索 RPC・管理者 RPC（権限変更＋監査ログ）
    20261110000004_master_data.sql 共通 8 分類（固定）・初期プリセット
  scripts/bootstrap_first_admin.sql 最初の管理者登録（DB 運営者が 1 回だけ実行）
  seed.sql                         ローカル専用サンプルデータ
  config.toml                      Supabase CLI ローカル設定（auto_expose_new_tables = false）
src/
  lib/supabase.ts   クライアント（PKCE / no-store fetch / secret key 混入時は起動停止）
  lib/api.ts        データアクセス（権限判定はしない。DB が正本）
  lib/url.ts        URL 安全性チェック（https のみ・秘密パラメータ警告・noopener で別タブ）
  auth/AuthProvider.tsx  ログイン・状態判定・権限変更/利用者切替時の画面ツリー破棄
  pages/            ログイン/承認待ち/停止/HOME/分類/目的/アプリ/検索/SELF/申請/管理
tests/
  db/   ローカル PostgreSQL での RLS/GRANT テスト（33 件）
  api/  Supabase ローカルスタック（PostgREST/GoTrue）での API テスト（17 件）
  e2e/  Playwright 画面テスト（13 件）
docs/   手順書・設計・テスト結果・未解決事項
```

## すぐ動かす（ローカル）

前提：Node.js 22、Docker、Supabase CLI（`npx supabase`）。

```bash
npm install
# Google の OAuth クライアント（ローカル用）を作成済みなら値を渡す。未作成ならダミーでも起動は可能（ログインは不可）
export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=xxxx
npx supabase start          # マイグレーション + seed.sql を適用
cp .env.example .env.local  # VITE_SUPABASE_URL=http://127.0.0.1:54321 と表示された Publishable key を設定
npm run dev                 # http://localhost:5173
```

最初の管理者：一度 Google でログイン（pending になる）→ `supabase/scripts/bootstrap_first_admin.sql` のメールを置換して SQL Editor で実行。

## テスト

```bash
npm test                  # 単体（URL 安全性・secret key 検出）
npm run db:local && npm run test:db   # ローカル PostgreSQL 16 で RLS/GRANT（Docker 不要）
# Supabase ローカルスタック起動後（キーは supabase status で確認。ローカル専用の値）
SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... SUPABASE_JWT_SECRET=... node --test tests/api/api.test.mjs
SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... SUPABASE_JWT_SECRET=... node tests/e2e/ui.e2e.mjs   # 要 npm run dev
npm run build && npm run check:bundle   # 配布物に秘密鍵・ソースマップが無いか
```

## 認可の要点（詳細は [docs/SECURITY_DESIGN.md](docs/SECURITY_DESIGN.md)）

- `anon` には public のテーブル・関数を **一切 GRANT しない**。ログイン前は分類名・アプリ名・URL・目的を配信しない。
- 閲覧範囲は毎リクエスト DB の現在値（`profiles.status`・`user_category_permissions`）で判定。JWT や `user_metadata` に権限を載せない → 撤回・停止は同じトークンでも即時反映。
- `catalog_apps` は `approved` かつ「許可分類の目的」に紐づく場合のみ返る。`app_purposes` も両側が許可範囲のときのみ。
- SELF（`personal_items` / `personal_folders`）は `active` かつ `user_id = auth.uid()`。`user_id` は INSERT/UPDATE の列 GRANT に含めず、所有者差替えはトリガでも拒否。
- 共通アプリの SELF 保存はタイトル・URL を複製しない（参照 ID のみ）。権限撤回後は内容が返らず、削除だけ可能。
- 閲覧許可と管理者ロールは別テーブル。権限テーブルへの書込 GRANT は無く、管理 RPC が DB 上の admin ロールを再検証し、同一トランザクションで監査ログに記録。自分自身のロール・状態は変更不可。
- 監査ログは追記専用（UPDATE/DELETE/TRUNCATE をトリガで拒否）。

## ドキュメント

- [環境変数名一覧](docs/ENVIRONMENT_VARIABLES.md)
- [Google OAuth 設定手順](docs/GOOGLE_OAUTH_SETUP.md)
- [権限管理手順（管理者マニュアル）](docs/ADMIN_GUIDE.md)
- [利用者向け使い方](docs/USER_GUIDE.md)
- [認可設計・Data API 公開範囲](docs/SECURITY_DESIGN.md)
- [公開手順・ステージング侵入テスト計画](docs/DEPLOYMENT.md)
- [動作確認ログ（T01〜T22）](docs/TEST_REPORT.md)
- [未解決事項](docs/OPEN_ISSUES.md)
