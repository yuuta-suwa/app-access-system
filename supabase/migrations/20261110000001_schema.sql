-- =====================================================================
-- LEI APP HUB Ver.1.1 : 01 スキーマ定義
-- ---------------------------------------------------------------------
-- 方針
--  * public スキーマのテーブルは Data API (PostgREST) から到達し得るため、
--    既定の自動 GRANT を取り消し、必要な権限だけを後続マイグレーションで明示付与する。
--  * 認可判定用の SECURITY DEFINER 関数とトリガ関数は Data API に公開しない
--    app_private スキーマに置く。
--  * 本人識別の正本は auth.users.id (UUID)。メールは照合用であり所有権判定に使わない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 既定権限の取り消し（新規テーブル・関数の自動公開を止める）
--    参照: https://supabase.com/docs/guides/api/securing-your-api
--    "Default privileges for new tables and functions"
-- ---------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
-- RLS ポリシー内で認可関数を評価するため authenticated に USAGE のみ付与（関数ごとに EXECUTE を個別付与）
grant usage on schema app_private to authenticated;

-- 注意: スキーマ単位の ALTER DEFAULT PRIVILEGES では PUBLIC への既定 EXECUTE を取り消せないため、
--       app_private の関数は作成直後に個別に REVOKE する。

-- ---------------------------------------------------------------------
-- 1. profiles : Google 認証 ID と利用承認状態
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  display_name    text,
  status          text not null default 'pending'
                  check (status in ('pending', 'active', 'suspended')),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create index profiles_status_idx on public.profiles (status);

comment on table public.profiles is
  '利用者の承認状態。status は pending/active/suspended。本人は自分の行のみ参照可・変更不可。';

-- ---------------------------------------------------------------------
-- 2. categories : 共通 8 分類（固定マスタ。SELF は含めない）
-- ---------------------------------------------------------------------
create table public.categories (
  id          smallint primary key check (id between 1 and 8),
  code        text not null unique check (code ~ '^[a-z0-9-]+$'),
  title       text not null,
  description text not null,
  sort_order  smallint not null
);
comment on table public.categories is
  '共通 8 分類の固定マスタ。SELF は個人用 UI ルートであり、このテーブルに含めない。';

-- ---------------------------------------------------------------------
-- 3. user_category_permissions : 利用者 × 閲覧可能分類
-- ---------------------------------------------------------------------
create table public.user_category_permissions (
  user_id     uuid not null references public.profiles (user_id) on delete cascade,
  category_id smallint not null references public.categories (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id) on delete set null,
  primary key (user_id, category_id)
);
create index ucp_category_idx on public.user_category_permissions (category_id);

-- ---------------------------------------------------------------------
-- 4. role_assignments : member / creator / admin（分類許可とは別軸）
--    行が無い active 利用者は member として扱う。
-- ---------------------------------------------------------------------
create table public.role_assignments (
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  role       text not null check (role in ('member', 'creator', 'admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------
-- 5. permission_presets : 権限設定の補助テンプレート（ロールではない）
-- ---------------------------------------------------------------------
create table public.permission_presets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (char_length(name) between 1 and 60),
  category_ids smallint[] not null default '{}',
  sort_order   smallint not null default 100,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. purposes : 分類ごとの「やりたいこと」
-- ---------------------------------------------------------------------
create table public.purposes (
  id          uuid primary key default gen_random_uuid(),
  category_id smallint not null references public.categories (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  description text,
  sort_order  smallint not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index purposes_category_idx on public.purposes (category_id, sort_order);

-- ---------------------------------------------------------------------
-- 7. catalog_apps : 共通アプリの唯一の正本
-- ---------------------------------------------------------------------
create table public.catalog_apps (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 120),
  description      text not null default '',        -- できること
  outcome          text not null default '',        -- 使った後に目指す状態・得られる変化
  usage_scene      text not null default '',        -- 使う場面
  launch_url       text not null
                   check (launch_url ~ '^https://[^\s<>"]+$' and char_length(launch_url) <= 2048),
  status           text not null default 'draft'
                   check (status in ('draft', 'approved', 'suspended', 'retired')),
  owner_id         uuid references auth.users (id) on delete set null,  -- 管理責任者
  owner_name       text,
  last_verified_at date,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index catalog_apps_status_idx on public.catalog_apps (status);

-- ---------------------------------------------------------------------
-- 8. app_purposes : アプリ × 目的（多対多。複数分類掲載は同一 app_id を再利用）
-- ---------------------------------------------------------------------
create table public.app_purposes (
  app_id     uuid not null references public.catalog_apps (id) on delete cascade,
  purpose_id uuid not null references public.purposes (id) on delete cascade,
  sort_order smallint not null default 100,
  primary key (app_id, purpose_id)
);
create index app_purposes_purpose_idx on public.app_purposes (purpose_id);

-- ---------------------------------------------------------------------
-- 9. personal_folders : SELF 本人フォルダ
-- ---------------------------------------------------------------------
create table public.personal_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)   -- personal_items からの複合 FK 用（他人のフォルダへの所属を防ぐ）
);
create index personal_folders_user_idx on public.personal_folders (user_id, sort_order);

-- ---------------------------------------------------------------------
-- 10. personal_items : SELF 本人専用リンク
--     kind='link'    : 本人が登録した外部 URL（https のみ）
--     kind='catalog' : 共通アプリへの参照。タイトル・URL は複製せず catalog_app_id のみ保持
-- ---------------------------------------------------------------------
create table public.personal_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  kind           text not null check (kind in ('link', 'catalog')),
  catalog_app_id uuid references public.catalog_apps (id) on delete set null,
  external_url   text check (external_url is null or (
                   external_url ~ '^https://[^\s<>"]+$' and char_length(external_url) <= 2048)),
  custom_title   text check (custom_title is null or char_length(custom_title) between 1 and 120),
  note           text check (note is null or char_length(note) <= 1000),
  folder_id      uuid,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint personal_items_folder_owner_fk
    foreign key (folder_id, user_id) references public.personal_folders (id, user_id)
    on delete set null (folder_id),
  constraint personal_items_kind_shape check (
    (kind = 'link'    and external_url is not null and custom_title is not null and catalog_app_id is null)
    or
    -- 共通アプリ参照は名前・URL を保持しない（権限撤回後の再配信を防ぐ）。
    -- 正本アプリが削除された場合 catalog_app_id は NULL になり「利用できない項目」となる。
    (kind = 'catalog' and external_url is null and custom_title is null)
  )
);
create index personal_items_user_idx on public.personal_items (user_id, sort_order);
create unique index personal_items_unique_catalog
  on public.personal_items (user_id, catalog_app_id) where kind = 'catalog' and catalog_app_id is not null;

-- ---------------------------------------------------------------------
-- 11. app_submissions : 制作者の登録・変更申請
-- ---------------------------------------------------------------------
create table public.app_submissions (
  id            uuid primary key default gen_random_uuid(),
  submitted_by  uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  target_app_id uuid references public.catalog_apps (id) on delete set null,  -- 変更申請時
  payload       jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 32768),
  status        text not null default 'submitted'
                check (status in ('submitted', 'approved', 'rejected', 'withdrawn')),
  review_note   text,
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index app_submissions_status_idx on public.app_submissions (status, created_at);

-- ---------------------------------------------------------------------
-- 12. user_invitations : 管理者の事前招待（初回ログイン時にメールで本人紐づけ）
-- ---------------------------------------------------------------------
create table public.user_invitations (
  email        text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  category_ids smallint[] not null default '{}',
  reason       text,
  invited_by   uuid references auth.users (id) on delete set null,
  invited_at   timestamptz not null default now(),
  consumed_by  uuid references auth.users (id) on delete set null,
  consumed_at  timestamptz
);

-- ---------------------------------------------------------------------
-- 13. permission_audit_logs : 権限・掲載操作の監査（追記専用）
-- ---------------------------------------------------------------------
create table public.permission_audit_logs (
  id             bigint generated always as identity primary key,
  actor_id       uuid,              -- 操作者 (auth.users.id)。システム処理は NULL
  target_user_id uuid,              -- 変更対象の利用者
  category_id    smallint,
  target_app_id  uuid,
  action         text not null,     -- 例: category.grant / category.revoke / status.change / role.grant
  before_value   jsonb,
  after_value    jsonb,
  reason         text,
  at             timestamptz not null default now()
);
create index audit_target_idx on public.permission_audit_logs (target_user_id, at desc);
create index audit_at_idx on public.permission_audit_logs (at desc);

-- ---------------------------------------------------------------------
-- 共通トリガ: updated_at
-- ---------------------------------------------------------------------
create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();
create trigger trg_purposes_touch before update on public.purposes
  for each row execute function app_private.touch_updated_at();
create trigger trg_catalog_apps_touch before update on public.catalog_apps
  for each row execute function app_private.touch_updated_at();
create trigger trg_personal_folders_touch before update on public.personal_folders
  for each row execute function app_private.touch_updated_at();
create trigger trg_personal_items_touch before update on public.personal_items
  for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 所有者差し替え禁止（列 GRANT に加えた多層防御）
-- ---------------------------------------------------------------------
create or replace function app_private.forbid_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'owner change is not allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_personal_folders_owner before update on public.personal_folders
  for each row execute function app_private.forbid_owner_change();
create trigger trg_personal_items_owner before update on public.personal_items
  for each row execute function app_private.forbid_owner_change();

-- personal_items: 種別・参照先の変更禁止
create or replace function app_private.forbid_item_kind_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'kind change is not allowed' using errcode = '42501';
  end if;
  -- catalog_app_id は FK の ON DELETE SET NULL によるシステム更新のみ許可
  if new.catalog_app_id is distinct from old.catalog_app_id and new.catalog_app_id is not null then
    raise exception 'catalog reference change is not allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_personal_items_kind before update on public.personal_items
  for each row execute function app_private.forbid_item_kind_change();

-- 監査ログは追記専用
create or replace function app_private.forbid_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'permission_audit_logs is append-only' using errcode = '42501';
end;
$$;

revoke all on function app_private.touch_updated_at() from public;
revoke all on function app_private.forbid_owner_change() from public;
revoke all on function app_private.forbid_item_kind_change() from public;
revoke all on function app_private.forbid_audit_mutation() from public;

create trigger trg_audit_no_update before update or delete on public.permission_audit_logs
  for each row execute function app_private.forbid_audit_mutation();
create trigger trg_audit_no_truncate before truncate on public.permission_audit_logs
  for each statement execute function app_private.forbid_audit_mutation();
