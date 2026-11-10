# 環境変数名一覧

値（秘密情報）はこのリポジトリに記載しません。

## ブラウザに埋め込まれる値（公開可）

`VITE_` で始まる変数はビルド時に JavaScript へ埋め込まれ、誰でも読めます。**秘密鍵を絶対に入れないでください。**

| 変数名 | 設定場所 | 内容 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel（Production / Preview）、ローカル `.env.local` | `https://<project-ref>.supabase.co`（カスタムドメイン利用時はそのURL） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 同上 | Supabase の **Publishable key**（`sb_publishable_...`）。旧形式の anon key も可 |

アプリは起動時に `VITE_SUPABASE_PUBLISHABLE_KEY` が `sb_secret_...` または `role=service_role` の JWT だった場合、**起動を停止**します（`src/lib/supabase.ts`）。

## サーバー側のみ（ブラウザ・Vercel のフロント変数には置かない）

| 変数名 | 使う場所 | 内容 |
| --- | --- | --- |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | Supabase CLI ローカル（`supabase/config.toml` から参照） | Google OAuth Client ID |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` | 同上 | Google OAuth Client Secret（秘密） |
| `SUPABASE_PUBLISHABLE_KEY` | `tests/api`・`tests/e2e` の実行時 | テスト対象スタックの Publishable key |
| `SUPABASE_SECRET_KEY` | `tests/api`・`tests/e2e` の実行時のみ | テスト用ユーザー作成に使用（秘密）。本番プロジェクトの値でテストを実行しない |
| `SUPABASE_JWT_SECRET` | 同上（ローカルスタックのみ） | ローカル試験用トークン発行。**本番の値は使用しない** |
| `SUPABASE_URL` / `APP_URL` | 同上（任意） | 既定 `http://127.0.0.1:54321` / `http://localhost:5173` |
| `PGHOST` / `PGPORT` / `PGDATABASE` | `tests/db` の実行時（任意） | 既定 `/tmp` / `55432` / `leihub` |

## 本番の Supabase ダッシュボードで設定するもの（環境変数ではない）

- Authentication → Sign In / Providers → Google：Client ID、Client Secret
- Authentication → URL Configuration：Site URL、Redirect URLs

Google Client Secret・Supabase Secret key（service_role key）・DB パスワードはフロントエンド・Git・チャットに置かないでください。
