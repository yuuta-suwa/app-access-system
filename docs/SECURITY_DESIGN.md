# 認可設計・Data API 公開範囲

## 1. 原則

1. 認可の正本は DB。フロントの表示制御は利便性のためであり、セキュリティ境界ではない。
2. 既定拒否：`anon` には何も GRANT しない。新規利用者は pending・分類 0・ロールなし。
3. 毎リクエスト判定：`auth.uid()` と DB の現在値で判定。JWT・`user_metadata`・`app_metadata` に権限を持たせない。
4. 最小 GRANT：テーブル単位ではなく**列単位**で SELECT/INSERT/UPDATE を付与。権限系テーブルへの書込 GRANT は無し。
5. 管理操作は SECURITY DEFINER RPC のみ。冒頭で DB 上の admin ロールを検証し、同一トランザクションで監査ログに記録。

## 2. 2026 年の Supabase 仕様変更への対応

Supabase は public スキーマの新規テーブル・関数を `anon`/`authenticated`/`service_role` に自動 GRANT する既定を
「取り消し（明示 GRANT 必須）」へ移行中です（[Securing your API](https://supabase.com/docs/guides/api/securing-your-api)、
[changelog discussion #45329](https://github.com/orgs/supabase/discussions/45329)）。本実装は新旧どちらのプロジェクトでも同じ結果になるよう:

- マイグレーション冒頭で `ALTER DEFAULT PRIVILEGES ... REVOKE` を実行（既存プロジェクトの自動公開を停止）
- 各テーブルで `REVOKE ALL ... FROM anon, authenticated` の後に必要な列だけ GRANT
- 関数は `REVOKE ALL ... FROM PUBLIC, anon` の後に `authenticated` へ必要なものだけ EXECUTE
- ローカル CLI 設定 `auto_expose_new_tables = false`
- テストで「Supabase の旧既定（自動 GRANT）を再現した DB」に適用しても anon に権限が残らないことを確認（`tests/db`）

RLS は全 13 テーブルで有効。GRANT と RLS は別レイヤーであり、両方を検証しています。

## 3. Data API に公開するテーブル・関数（authenticated のみ）

| オブジェクト | SELECT 列 | INSERT / UPDATE / DELETE | 行の条件（RLS） |
| --- | --- | --- | --- |
| profiles | user_id, email, display_name, status, created_at | なし | 本人の行のみ（pending/suspended 画面表示のため状態不問） |
| categories | id, code, title, description, sort_order | なし | active かつ当該分類の許可あり |
| user_category_permissions | user_id, category_id, granted_at | なし | 本人・active |
| role_assignments | user_id, role, granted_at | なし | 本人・active |
| purposes | id, category_id, title, description, sort_order | なし | 所属分類が許可済み |
| catalog_apps | id, title, description, outcome, usage_scene, launch_url, owner_name, last_verified_at（owner_id, status, created_by は非公開） | なし | approved かつ許可分類の目的に紐づく |
| app_purposes | app_id, purpose_id, sort_order | なし | 目的・アプリの双方が閲覧可能 |
| personal_folders | id, user_id, name, sort_order, created_at, updated_at | INSERT(name, sort_order) / UPDATE(name, sort_order) / DELETE | active かつ user_id = auth.uid() |
| personal_items | id, user_id, kind, catalog_app_id, external_url, custom_title, note, folder_id, sort_order, created_at, updated_at | INSERT(kind, catalog_app_id, external_url, custom_title, note, folder_id, sort_order) / UPDATE(external_url, custom_title, note, folder_id, sort_order) / DELETE | active かつ user_id = auth.uid()。共通アプリ参照の INSERT は現在閲覧可能なアプリのみ |
| app_submissions | id, submitted_by, target_app_id, payload, status, review_note, reviewed_at, created_at | INSERT(target_app_id, payload) | creator 以上かつ本人分 |
| permission_presets / user_invitations / permission_audit_logs | **GRANT なし** | **なし** | 管理 RPC 経由のみ |

関数（EXECUTE は authenticated のみ）：`get_my_access`・`search_hub`（SECURITY INVOKER＝呼出者の RLS 適用）、
`admin_*` 19 本（SECURITY DEFINER・admin 再検証）。`app_private` スキーマの認可関数は Data API 非公開スキーマに置き、RLS 評価用に EXECUTE のみ付与。
トリガ関数・内部関数（`handle_new_auth_user` 等）は誰にも EXECUTE を付与していません。

`service_role` には運用スクリプト用に CRUD を付与（監査ログは SELECT/INSERT のみ）。service_role/Secret key はブラウザに配布しません。

## 4. 所有者・改ざん対策

- `personal_*.user_id` は `DEFAULT auth.uid()` で INSERT/UPDATE の列 GRANT に含めない → 他人名義での作成・所有者差替え不可。加えてトリガで `user_id` 変更を拒否。
- `personal_items` のフォルダは `(folder_id, user_id)` の複合 FK → 他人のフォルダに入れられない。
- `kind` と `catalog_app_id` は変更不可（トリガ）。`kind='catalog'` は `custom_title`/`external_url` を持てない（CHECK）→ 権限撤回後に名前・URL を保持・再配信する抜け道を塞ぐ。
- URL は DB の CHECK で `^https://` かつ空白・`<>"` 無し・2048 文字以内。クライアントでも同規則＋秘密パラメータ警告。
- 監査ログは UPDATE/DELETE/TRUNCATE をトリガで拒否（DB 所有者でも不可。必要時はトリガ無効化が必要＝痕跡が残る）。

## 5. キャッシュ・クライアント

- Supabase への fetch は `cache: 'no-store'`。取得データは React のメモリのみ（localStorage 等に保存しない。保存されるのは supabase-js のセッションのみ）。
- 利用者 ID・状態・ロール・許可分類が変わると、ルーティングツリーを key で再マウントして一覧・検索・保存キャッシュを破棄。画面復帰・フォーカス・5 分ごとに再確認。
- ログアウトはローカルセッション削除後にフルリロード。
- `vercel.json`：HTML は `Cache-Control: no-store`、CSP（`script-src 'self'`、`frame-ancestors 'none'` 等）、`X-Robots-Tag: noindex`。`robots.txt` で全拒否。
- 外部アプリは iframe で埋め込まず、`window.open(url, '_blank', 'noopener,noreferrer')` で開く。
- ソースマップを配布しない（`build.sourcemap: false`、`check:bundle` で検査）。

## 6. 既知の限界

- DB 運営権限（Secret key / DB パスワード）を持つ者は技術的に全データへアクセス可能。追加暗号化は別設計。
- 外部アプリの URL を知る者の直接アクセスはポータルでは防げない（移動先アプリの認可で対応）。
- PostgREST 応答自体には `Cache-Control` が付かない（ローカル確認）。ブラウザ側は `no-store` で送信しているが、中間プロキシ等の挙動は実環境で確認が必要。
