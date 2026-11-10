# 動作確認ログ（受入テスト T01〜T22）

実施日：2026-11-10（UTC）。生ログ・スクリーンショットは [test-evidence/](test-evidence/)。

## テスト環境の区分（厳密な区別）

| 区分 | 内容 | 実施 |
| --- | --- | --- |
| **L1 疑似：ローカル PostgreSQL** | PostgreSQL 16 ＋ Supabase の最小スタブ（anon/authenticated/service_role・auth.users・auth.uid()）。Supabase 旧既定の「public 自動 GRANT」を再現した上でマイグレーションを適用。`SET ROLE authenticated` ＋ `request.jwt.claims` で PostgREST の挙動を再現（`tests/db`、33 件） | ✅ 33/33 合格 |
| **L2 疑似：Supabase ローカルスタック** | Supabase CLI 2.122.1 の実物コンテナ（Supabase Postgres 17・PostgREST・GoTrue・Kong）にマイグレーションを適用し、REST/RPC を HTTP で呼出（`tests/api`、17 件）。`supabase db lint` もエラー 0 | ✅ 17/17 合格 |
| **L3 疑似：画面 E2E** | Playwright Chromium ＋ Vite 開発サーバー ＋ L2 スタック（`tests/e2e`、13 件、2 回連続合格） | ✅ 13/13 合格 |
| L0 単体・ビルド | Vitest（URL 安全性・secret key 検出 18 件）、tsc、vite build、配布物の秘密情報検査、`npm audit`（0 件） | ✅ 合格 |
| **R 実環境** | 実 Supabase プロジェクト＋実 Google OAuth＋Vercel（ステージング/本番） | ❌ **未実施** |

### 疑似環境の制約（実環境で再確認が必要な点）

- **Google ログインそのもの（T01 の OAuth 部分）は一切検証していない。** ローカルでは Google の Client ID が無く、メールログインも無効化しているため、
  L2/L3 では GoTrue 管理 API で利用者を作成し、ローカルスタックの JWT 秘密鍵で同形式のアクセストークンを発行して使用した。
  「JWT 検証 → authenticated ロール → RLS」以降の経路は本番と同じだが、Google 同意画面・コールバック・PKCE 交換・トークン更新は未検証。
- 外部アプリ URL（example.com）はサンドボックスから到達できないため、E2E では応答をスタブ化して「新規タブ・noopener で開く」ことのみ確認。
- L1 の `auth` スキーマはスタブ（実 Supabase の auth スキーマとは異なる）。L2 で実物の auth スキーマ上でも適用・動作を確認済み。

## 結果一覧

凡例：✅ 合格（疑似環境）／ — 該当環境で未実施／ ❌ 未実施

| ID | シナリオ | L1 DB | L2 API | L3 画面 | 実環境 | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Google ログイン | ✅（profile 自動作成・UUID 一致・pending・user_metadata の admin 無視） | ✅（JWT sub 一致） | — | ❌ | **Google OAuth は未検証** |
| T02 | 初回未承認 | ✅ | ✅ | ✅ 承認待ち画面 | ❌ | |
| T03 | A さん | ✅ 8 分類・ロールなし | ✅ | ✅ 9 枚・管理リンクなし | ❌ | |
| T04 | B さん | ✅ | ✅ | ✅ 2 枚 | ❌ | |
| T05 | C さん | ✅ | ✅ | — | ❌ | 画面は B で代表確認 |
| T06 | 禁止カテゴリ URL 直打ち | ✅ 存在有無も区別不可 | ✅ | ✅ 汎用「利用できません」 | ❌ | |
| T07 | API 直接呼出 | ✅ | ✅ REST 直叩き・`select=*`・GRANT 外列・埋め込み | — | ❌ | |
| T08 | 検索 | ✅ ワイルドカード注入含む | ✅ | ✅ | ❌ | |
| T09 | 権限の即時撤回 | ✅ | ✅ **同一 JWT のまま**即時に返らない | ✅ 画面復帰で分類消滅 | ❌ | |
| T10 | 利用者切替 | ✅（DB 部） | — | ✅ A→ログアウト→B で A の表示・SELF 無し、セッション削除 | ❌ | bfcache/戻るボタンは実機で要確認 |
| T11 | 管理権限の分離 | ✅ | ✅ | ✅ A に管理リンク無し・/admin は利用不可 | ❌ | |
| T12 | 管理画面の不正操作 | ✅ 権限テーブル・監査ログ改変不可、自己ロール変更不可、最後の admin 保護 | ✅ | — | ❌ | |
| T13 | SELF の個別性 | ✅ 管理者も参照不可、管理 RPC は personal_* 非参照 | ✅ | ✅ | ❌ | |
| T14 | SELF の書込検証 | ✅ ID 指定 GET/UPDATE/DELETE・user_id 偽装/差替え・他人フォルダ | ✅ | — | ❌ | |
| T15 | SELF 端末同期 | ✅（DB 部） | ✅ 別セッション | — | ❌ | **実機 2 台は未実施** |
| T16 | SELF の共通リンク | ✅ | ✅ | ✅「アクセスできない項目」＋削除 | ❌ | |
| T17 | URL 入力の安全性 | ✅ DB CHECK | ✅ | ✅ UI 拒否・noopener 新規タブ | ❌ | 単体 18 件も合格 |
| T18 | 登録審査 | ✅ 申請中非公開・creator 以外申請不可・承認で公開 | — | — | ❌ | 申請画面の E2E は未実施 |
| T19 | 複数分類掲載 | ✅ | ✅ | — | ❌ | |
| T20 | 利用停止 | ✅ | ✅ 同一 JWT で即時拒否 | ✅ 停止画面 | ❌ | |
| T21 | 非公開情報の漏えい | ✅ anon 権限 0・関数一覧 | ✅ anon OpenAPI に定義なし | — | ❌ | 配布 JS 検査：secret/service_role JWT/ソースマップなし（ダミー値ビルド） |
| T22 | 実機利用テスト（5 名以上） | — | — | — | ❌ | **未実施**（人による検証が必要） |

**結論**：疑似環境（L1〜L3）で実施した項目はすべて合格。**実環境テスト（R）は全項目未実施**、T22 は未実施のため、
公開ゲート（T01〜T22 すべて合格）は **満たしていません**。

## 追加で確認したこと

- anon（Publishable key のみ）で REST を呼ぶと `401 / 42501 permission denied`（テーブル・RPC とも）。
- authenticated が EXECUTE できる関数は `get_my_access`・`search_hub`・`admin_*`・RLS 用認可関数のみ（トリガ関数等は不可）。
- 監査ログは DB 所有者でも UPDATE/DELETE 不可（トリガ）。
- 事前招待：検証済みメールのみ active 化、未検証メールは pending のまま。
- プリセット編集で既存利用者の権限は変わらない。
- メールでの新規登録はローカル設定で拒否（`Email signups are disabled`）。

## 再実行方法

README の「テスト」節を参照。L2/L3 のキーは `npx supabase status` で表示されるローカル専用値を使う（本番の鍵は使わない）。
