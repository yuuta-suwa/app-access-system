-- =====================================================================
-- LEI APP HUB Ver.1.1 : 02 認可関数・RLS・GRANT
-- ---------------------------------------------------------------------
--  * 認可は毎リクエスト DB の現在値で判定する（JWT に権限を載せない）。
--  * user_metadata / app_metadata は権限判断に使わない。
--  * 書込系の権限変更はすべて SECURITY DEFINER RPC（03 マイグレーション）経由。
--    authenticated に権限テーブルへの INSERT/UPDATE/DELETE を GRANT しない。
--  * anon には何も GRANT しない（ログイン前に共通アプリ名・URL・目的を配信しない）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 認可ヘルパ（app_private, SECURITY DEFINER, search_path 固定）
-- ---------------------------------------------------------------------
create or replace function app_private.current_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.status from public.profiles p where p.user_id = (select auth.uid());
$$;

create or replace function app_private.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.status = 'active'
  );
$$;

create or replace function app_private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_assignments r on r.user_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.status = 'active'
      and (r.role = p_role or (p_role = 'creator' and r.role = 'admin'))
  );
$$;

create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_role('admin');
$$;

create or replace function app_private.can_view_category(p_category_id smallint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_category_permissions ucp on ucp.user_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.status = 'active'
      and ucp.category_id = p_category_id
  );
$$;

-- 公開状態 approved かつ「許可済み分類の目的」に 1 件以上紐づくアプリのみ閲覧可
create or replace function app_private.can_view_app(p_app_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.catalog_apps a
    join public.app_purposes ap on ap.app_id = a.id
    join public.purposes pu on pu.id = ap.purpose_id
    join public.user_category_permissions ucp on ucp.category_id = pu.category_id
    join public.profiles p on p.user_id = ucp.user_id
    where a.id = p_app_id
      and a.status = 'approved'
      and ucp.user_id = (select auth.uid())
      and p.status = 'active'
  );
$$;

create or replace function app_private.can_view_purpose(p_purpose_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purposes pu
    where pu.id = p_purpose_id
      and app_private.can_view_category(pu.category_id)
  );
$$;

revoke all on function app_private.current_status() from public;
revoke all on function app_private.is_active() from public;
revoke all on function app_private.has_role(text) from public;
revoke all on function app_private.is_admin() from public;
revoke all on function app_private.can_view_category(smallint) from public;
revoke all on function app_private.can_view_app(uuid) from public;
revoke all on function app_private.can_view_purpose(uuid) from public;
grant execute on function app_private.is_active() to authenticated;
grant execute on function app_private.has_role(text) to authenticated;
grant execute on function app_private.is_admin() to authenticated;
grant execute on function app_private.can_view_category(smallint) to authenticated;
grant execute on function app_private.can_view_app(uuid) to authenticated;
grant execute on function app_private.can_view_purpose(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. auth.users → profiles 自動作成（初回は pending・分類 0・ロールなし）
--    事前招待があれば、Google が検証したメールで本人紐づけして active 化する。
-- ---------------------------------------------------------------------
create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_inv   public.user_invitations%rowtype;
  v_cat   smallint;
  v_verified boolean := new.email_confirmed_at is not null;
begin
  insert into public.profiles (user_id, email, display_name, status)
  values (
    new.id,
    v_email,
    -- 表示名は表示専用。権限判断には使わない
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    'pending'
  )
  on conflict (user_id) do nothing;

  if v_email <> '' and v_verified then
    select * into v_inv from public.user_invitations
    where email = v_email and consumed_at is null
    for update;

    if found then
      update public.profiles
         set status = 'active', status_changed_at = now(), status_changed_by = v_inv.invited_by
       where user_id = new.id;

      insert into public.permission_audit_logs (actor_id, target_user_id, action, before_value, after_value, reason)
      values (v_inv.invited_by, new.id, 'status.change',
              jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'active'),
              'invitation:' || coalesce(v_inv.reason, ''));

      foreach v_cat in array v_inv.category_ids loop
        insert into public.user_category_permissions (user_id, category_id, granted_by)
        values (new.id, v_cat, v_inv.invited_by)
        on conflict do nothing;
        insert into public.permission_audit_logs (actor_id, target_user_id, category_id, action, reason)
        values (v_inv.invited_by, new.id, v_cat, 'category.grant', 'invitation');
      end loop;

      update public.user_invitations
         set consumed_by = new.id, consumed_at = now()
       where email = v_email;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function app_private.handle_new_auth_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_auth_user();

-- メール変更の追従（照合用。所有権判定には使わない）
create or replace function app_private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(coalesce(new.email, '')) where user_id = new.id;
  return new;
end;
$$;
revoke all on function app_private.handle_auth_user_email_change() from public;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app_private.handle_auth_user_email_change();

-- ---------------------------------------------------------------------
-- 3. RLS 有効化（全テーブル）+ FORCE（テーブル所有者以外の経路でも適用）
-- ---------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.categories                enable row level security;
alter table public.user_category_permissions enable row level security;
alter table public.role_assignments          enable row level security;
alter table public.permission_presets        enable row level security;
alter table public.purposes                  enable row level security;
alter table public.catalog_apps              enable row level security;
alter table public.app_purposes              enable row level security;
alter table public.personal_folders          enable row level security;
alter table public.personal_items            enable row level security;
alter table public.app_submissions           enable row level security;
alter table public.user_invitations          enable row level security;
alter table public.permission_audit_logs     enable row level security;

-- ---------------------------------------------------------------------
-- 4. GRANT：まず全取り消し → 必要最小限のみ付与
-- ---------------------------------------------------------------------
revoke all on table
  public.profiles, public.categories, public.user_category_permissions, public.role_assignments,
  public.permission_presets, public.purposes, public.catalog_apps, public.app_purposes,
  public.personal_folders, public.personal_items, public.app_submissions,
  public.user_invitations, public.permission_audit_logs
from anon, authenticated;

-- service_role はサーバー側の運用スクリプト専用（ブラウザに配布しない）
grant select, insert, update, delete on table
  public.profiles, public.categories, public.user_category_permissions, public.role_assignments,
  public.permission_presets, public.purposes, public.catalog_apps, public.app_purposes,
  public.personal_folders, public.personal_items, public.app_submissions,
  public.user_invitations
to service_role;
grant select, insert on table public.permission_audit_logs to service_role;

-- 読み取り（RLS で行を絞る）
grant select (user_id, email, display_name, status, created_at)       on public.profiles to authenticated;
grant select (id, code, title, description, sort_order)               on public.categories to authenticated;
grant select (user_id, category_id, granted_at)                       on public.user_category_permissions to authenticated;
grant select (user_id, role, granted_at)                              on public.role_assignments to authenticated;
grant select (id, category_id, title, description, sort_order)        on public.purposes to authenticated;
grant select (id, title, description, outcome, usage_scene, launch_url, owner_name, last_verified_at)
                                                                      on public.catalog_apps to authenticated;
grant select (app_id, purpose_id, sort_order)                         on public.app_purposes to authenticated;

-- SELF（本人 CRUD。user_id は INSERT/UPDATE 列に含めない＝DEFAULT auth.uid() 固定・差替え不可）
grant select (id, user_id, name, sort_order, created_at, updated_at)  on public.personal_folders to authenticated;
grant insert (name, sort_order)                                       on public.personal_folders to authenticated;
grant update (name, sort_order)                                       on public.personal_folders to authenticated;
grant delete                                                          on public.personal_folders to authenticated;

grant select (id, user_id, kind, catalog_app_id, external_url, custom_title, note, folder_id, sort_order, created_at, updated_at)
                                                                      on public.personal_items to authenticated;
grant insert (kind, catalog_app_id, external_url, custom_title, note, folder_id, sort_order)
                                                                      on public.personal_items to authenticated;
grant update (external_url, custom_title, note, folder_id, sort_order) on public.personal_items to authenticated;
grant delete                                                          on public.personal_items to authenticated;

-- 制作者申請（本人分のみ参照・新規申請）
grant select (id, submitted_by, target_app_id, payload, status, review_note, reviewed_at, created_at)
                                                                      on public.app_submissions to authenticated;
grant insert (target_app_id, payload)                                 on public.app_submissions to authenticated;

-- permission_presets / user_invitations / permission_audit_logs は authenticated に GRANT しない（管理 RPC 経由のみ）

-- ---------------------------------------------------------------------
-- 5. RLS ポリシー
-- ---------------------------------------------------------------------

-- profiles: 本人の行のみ（pending/suspended 画面表示に status が必要なため状態不問）
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- categories: active かつ当該分類の許可あり
create policy categories_select_permitted on public.categories
  for select to authenticated
  using (app_private.can_view_category(id));

-- user_category_permissions: 本人の許可のみ（active 時）
create policy ucp_select_self on public.user_category_permissions
  for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_active());

-- role_assignments: 本人のロールのみ（active 時）
create policy roles_select_self on public.role_assignments
  for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_active());

-- purposes: 所属分類が許可済み
create policy purposes_select_permitted on public.purposes
  for select to authenticated
  using (app_private.can_view_category(category_id));

-- catalog_apps: approved かつ許可済み分類の目的に紐づく
create policy catalog_apps_select_permitted on public.catalog_apps
  for select to authenticated
  using (app_private.can_view_app(id));

-- app_purposes: アプリ・目的の双方が閲覧可能な対応のみ（別分類の対応関係を漏らさない）
create policy app_purposes_select_permitted on public.app_purposes
  for select to authenticated
  using (app_private.can_view_purpose(purpose_id) and app_private.can_view_app(app_id));

-- personal_folders: active かつ本人
create policy folders_select_own on public.personal_folders
  for select to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()));
create policy folders_insert_own on public.personal_folders
  for insert to authenticated
  with check (app_private.is_active() and user_id = (select auth.uid()));
create policy folders_update_own on public.personal_folders
  for update to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()))
  with check (app_private.is_active() and user_id = (select auth.uid()));
create policy folders_delete_own on public.personal_folders
  for delete to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()));

-- personal_items: active かつ本人。共通アプリ参照の保存は「現在閲覧可能なアプリ」に限る
create policy items_select_own on public.personal_items
  for select to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()));
create policy items_insert_own on public.personal_items
  for insert to authenticated
  with check (
    app_private.is_active()
    and user_id = (select auth.uid())
    and (kind = 'link' or (kind = 'catalog' and catalog_app_id is not null and app_private.can_view_app(catalog_app_id)))
  );
create policy items_update_own on public.personal_items
  for update to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()))
  with check (app_private.is_active() and user_id = (select auth.uid()));
-- 権限撤回後でも本人は削除だけは可能（SELF-07）
create policy items_delete_own on public.personal_items
  for delete to authenticated
  using (app_private.is_active() and user_id = (select auth.uid()));

-- app_submissions: creator 以上が本人分のみ
create policy submissions_select_own on public.app_submissions
  for select to authenticated
  using (submitted_by = (select auth.uid()) and app_private.has_role('creator'));
create policy submissions_insert_own on public.app_submissions
  for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'submitted' and app_private.has_role('creator'));

-- permission_presets / user_invitations / permission_audit_logs:
--   authenticated 向けポリシーなし（GRANT も無いため Data API から到達不可）
