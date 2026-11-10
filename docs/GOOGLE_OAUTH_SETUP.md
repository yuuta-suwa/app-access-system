# Google OAuth 設定手順（Supabase Auth）

2026-11-10 時点の Supabase 公式ドキュメント（Supabase Docs MCP で取得）で確認した手順です。
画面名は変更されることがあるため、実施時に以下を再確認してください。

- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/api/securing-your-api

> 本書の手順は **未実施** です（実プロジェクトへの設定は運用担当者が行う）。

## 1. Google Cloud（Google Auth Platform）

1. Google Cloud Console でプロジェクトを作成（または選択）。
2. Google Auth Platform → **Branding**：アプリ名、サポートメール、ロゴ、プライバシーポリシー URL 等を設定。
3. **Audience**：対象ユーザーを設定（社内のみなら Internal、外部の Google アカウントも使うなら External）。
4. **Data Access (Scopes)**：次の 3 つのみ。**追加の Google API スコープは要求しない。**
   - `openid`（手動追加）
   - `.../auth/userinfo.email`（既定）
   - `.../auth/userinfo.profile`（既定）
5. **Clients** → OAuth クライアント ID を作成 → 種類「ウェブ アプリケーション」
   - 承認済みの JavaScript 生成元：公開ドメイン（例 `https://hub.example.com`）、ステージングのドメイン。開発時のみ `http://localhost:5173`（本番前に削除）
   - 承認済みのリダイレクト URI：Supabase ダッシュボードの Google プロバイダ画面に表示される Callback URL
     （`https://<project-ref>.supabase.co/auth/v1/callback`。カスタムドメイン利用時はそのドメイン）
     ローカル CLI の場合は `http://127.0.0.1:54321/auth/v1/callback`
6. Client ID と Client Secret を控える（Secret はパスワード管理ツール等で保管。Git・チャットに貼らない）。

## 2. Supabase ダッシュボード

1. Authentication → Sign In / Providers → **Google** を有効化し、Client ID・Client Secret を入力。
2. 同画面の **Email** プロバイダ：LEI APP HUB は Google のみを使うため、メールでのサインアップを無効化（推奨）。
3. Authentication → **URL Configuration**
   - Site URL：`https://<公開ドメイン>`
   - Redirect URLs：`https://<公開ドメイン>/auth/callback`、ステージングの `/auth/callback`。
     ワイルドカードは必要最小限に（Vercel のプレビュー URL を許可する場合はチーム固有のパターンに限定）。
4. （推奨）カスタムドメインを設定すると、同意画面に `<project-ref>.supabase.co` ではなく自ドメインが表示され、フィッシング耐性が上がる。

## 3. アプリ側の実装（済）

- `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })`
- `flowType: 'pkce'`：認可コードはクライアントで交換。Client Secret はブラウザに置かない（Supabase Auth が保持）。
- `scopes` は指定しない＝Supabase Auth 既定（openid email profile）のみ。
- Google ログイン成功 ≠ 利用承認。初回は DB トリガで `profiles.status = 'pending'`・分類 0・ロールなしで作成。

## 4. 動作確認（未実施・実施時のチェックリスト）

- [ ] T01：Google でログインし、`auth.users.id` と `profiles.user_id` が一致、`status = pending` で作成される
- [ ] 同意画面に要求スコープが「メールアドレス・基本プロフィール」のみ表示される
- [ ] 承認待ち画面が表示され、Network タブに分類・アプリの応答が無い
- [ ] ログアウト後、戻るボタンでデータが表示されない
- [ ] セッション期限切れ時に日本語メッセージでログイン画面へ戻る
- [ ] 認証失敗（同意拒否）時に日本語メッセージが出る
