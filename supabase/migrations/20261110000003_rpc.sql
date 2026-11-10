-- =====================================================================
-- LEI APP HUB Ver.1.1 : 03 RPC（利用者向け検索 / 管理者操作 / 監査）
-- ---------------------------------------------------------------------
--  * 利用者向け関数は SECURITY INVOKER（呼出者の RLS がそのまま適用される）。
--  * 管理者向け関数は SECURITY DEFINER。冒頭で DB 上の admin ロールを検証し、
--    クライアントが提示する admin=true 等は一切参照しない。
--  * 権限変更は同一トランザクション内で permission_audit_logs に記録する。
--  * 管理 RPC は SELF（personal_*）を一切参照しない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 共通: 管理者チェック
-- ---------------------------------------------------------------------
create or replace function app_private.assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app_private.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function app_private.assert_admin() from public;

create or replace function app_private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception '変更理由を入力してください' using errcode = '22023';
  end if;
  return left(btrim(p_reason), 500);
end;
$$;
revoke all on function app_private.require_reason(text) from public;

create or replace function app_private.normalize_category_ids(p_ids smallint[])
returns smallint[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids smallint[];
begin
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids
  from unnest(coalesce(p_ids, '{}')) as x;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.categories c where c.id = x)) then
    raise exception 'unknown category id' using errcode = '22023';
  end if;
  return v_ids;
end;
$$;
revoke all on function app_private.normalize_category_ids(smallint[]) from public;

-- =====================================================================
-- A. 利用者向け（SECURITY INVOKER）
-- =====================================================================

-- 自分の利用状態（pending/suspended でも status は返る。分類・ロールは active 時のみ RLS で返る）
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id',      p.user_id,
    'email',        p.email,
    'display_name', p.display_name,
    'status',       p.status,
    'roles',        coalesce((select jsonb_agg(r.role order by r.role) from public.role_assignments r where r.user_id = p.user_id), '[]'::jsonb),
    'category_ids', coalesce((select jsonb_agg(u.category_id order by u.category_id) from public.user_category_permissions u where u.user_id = p.user_id), '[]'::jsonb)
  )
  from public.profiles p
  where p.user_id = (select auth.uid());
$$;

-- 横断検索：分類・目的・アプリ。RLS によって許可範囲のみが対象になる
create or replace function public.search_hub(p_q text)
returns table (
  result_type   text,
  id            text,
  title         text,
  snippet       text,
  category_code text,
  category_title text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_pattern text;
begin
  if char_length(v_q) = 0 or char_length(v_q) > 100 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select 'category'::text, c.code, c.title, c.description, c.code, c.title
  from public.categories c
  where c.title ilike v_pattern or c.description ilike v_pattern or c.code ilike v_pattern

  union all
  select 'purpose'::text, pu.id::text, pu.title, coalesce(pu.description, ''), c.code, c.title
  from public.purposes pu
  join public.categories c on c.id = pu.category_id
  where pu.title ilike v_pattern or pu.description ilike v_pattern

  union all
  select distinct on (a.id)
         'app'::text, a.id::text, a.title, a.description, c.code, c.title
  from public.catalog_apps a
  join public.app_purposes ap on ap.app_id = a.id
  join public.purposes pu on pu.id = ap.purpose_id
  join public.categories c on c.id = pu.category_id
  where a.title ilike v_pattern or a.description ilike v_pattern
     or a.outcome ilike v_pattern or a.usage_scene ilike v_pattern;
end;
$$;

revoke all on function public.get_my_access() from public, anon;
revoke all on function public.search_hub(text) from public, anon;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.search_hub(text) to authenticated;

-- =====================================================================
-- B. 管理者：利用者・分類権限・ロール
-- =====================================================================

create or replace function public.admin_list_categories()
returns table (id smallint, code text, title text, description text, sort_order smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query select c.id, c.code, c.title, c.description, c.sort_order from public.categories c order by c.sort_order;
end;
$$;

create or replace function public.admin_list_users(p_query text default null)
returns table (
  user_id uuid, email text, display_name text, status text,
  category_count integer, roles text[], last_sign_in_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform app_private.assert_admin();
  return query
  select p.user_id, p.email, p.display_name, p.status,
         (select count(*)::int from public.user_category_permissions u where u.user_id = p.user_id),
         coalesce((select array_agg(r.role order by r.role) from public.role_assignments r where r.user_id = p.user_id), '{}'),
         au.last_sign_in_at,
         p.created_at
  from public.profiles p
  left join auth.users au on au.id = p.user_id
  where v_q = '' or p.email ilike v_pattern or p.display_name ilike v_pattern
  order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end, p.created_at desc
  limit 500;
end;
$$;

create or replace function public.admin_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app_private.assert_admin();
  select jsonb_build_object(
    'user_id', p.user_id,
    'email', p.email,
    'display_name', p.display_name,
    'status', p.status,
    'status_changed_at', p.status_changed_at,
    'created_at', p.created_at,
    'last_sign_in_at', au.last_sign_in_at,
    'category_ids', coalesce((select jsonb_agg(u.category_id order by u.category_id) from public.user_category_permissions u where u.user_id = p.user_id), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.role_assignments r where r.user_id = p.user_id), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  left join auth.users au on au.id = p.user_id
  where p.user_id = p_user_id;

  if v_result is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

-- 状態と 8 分類の許可を 1 トランザクションで保存（「保存」まで DB を更新しない UI と対応）
create or replace function public.admin_save_user_access(
  p_user_id uuid,
  p_status text,
  p_category_ids smallint[],
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.assert_admin();
  v_reason text := app_private.require_reason(p_reason);
  v_old_status text;
  v_new_ids smallint[] := app_private.normalize_category_ids(p_category_ids);
  v_old_ids smallint[];
  v_added smallint[];
  v_removed smallint[];
  v_cat smallint;
begin
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select status into v_old_status from public.profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if p_user_id = v_actor and p_status <> v_old_status then
    raise exception '自分自身のアカウント状態は変更できません' using errcode = '42501';
  end if;

  select coalesce(array_agg(category_id order by category_id), '{}') into v_old_ids
  from public.user_category_permissions where user_id = p_user_id;

  select coalesce(array_agg(x order by x), '{}') into v_added   from unnest(v_new_ids) x where not (x = any (v_old_ids));
  select coalesce(array_agg(x order by x), '{}') into v_removed from unnest(v_old_ids) x where not (x = any (v_new_ids));

  if p_status <> v_old_status then
    update public.profiles
       set status = p_status, status_changed_at = now(), status_changed_by = v_actor
     where user_id = p_user_id;
    insert into public.permission_audit_logs (actor_id, target_user_id, action, before_value, after_value, reason)
    values (v_actor, p_user_id, 'status.change',
            jsonb_build_object('status', v_old_status), jsonb_build_object('status', p_status), v_reason);
  end if;

  foreach v_cat in array v_added loop
    insert into public.user_category_permissions (user_id, category_id, granted_by)
    values (p_user_id, v_cat, v_actor);
    insert into public.permission_audit_logs (actor_id, target_user_id, category_id, action, before_value, after_value, reason)
    values (v_actor, p_user_id, v_cat, 'category.grant',
            jsonb_build_object('granted', false), jsonb_build_object('granted', true), v_reason);
  end loop;

  foreach v_cat in array v_removed loop
    delete from public.user_category_permissions where user_id = p_user_id and category_id = v_cat;
    insert into public.permission_audit_logs (actor_id, target_user_id, category_id, action, before_value, after_value, reason)
    values (v_actor, p_user_id, v_cat, 'category.revoke',
            jsonb_build_object('granted', true), jsonb_build_object('granted', false), v_reason);
  end loop;

  return jsonb_build_object(
    'status_before', v_old_status, 'status_after', p_status,
    'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)
  );
end;
$$;

-- ロール変更（分類許可とは独立）。自分自身のロールは変更不可。最後の admin は外せない
create or replace function public.admin_set_roles(p_user_id uuid, p_roles text[], p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.assert_admin();
  v_reason text := app_private.require_reason(p_reason);
  v_new text[];
  v_old text[];
  v_role text;
  v_status text;
begin
  if p_user_id = v_actor then
    raise exception '自分自身のロールは変更できません（別の管理者に依頼してください）' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct r order by r), '{}') into v_new from unnest(coalesce(p_roles, '{}')) r;
  if exists (select 1 from unnest(v_new) r where r not in ('member', 'creator', 'admin')) then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  select status into v_status from public.profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' and (v_new && array['creator', 'admin']) then
    raise exception 'creator/admin は active 利用者にのみ付与できます' using errcode = '22023';
  end if;

  select coalesce(array_agg(role order by role), '{}') into v_old from public.role_assignments where user_id = p_user_id;

  foreach v_role in array v_new loop
    if not (v_role = any (v_old)) then
      insert into public.role_assignments (user_id, role, granted_by) values (p_user_id, v_role, v_actor);
      insert into public.permission_audit_logs (actor_id, target_user_id, action, before_value, after_value, reason)
      values (v_actor, p_user_id, 'role.grant', jsonb_build_object('roles', v_old), jsonb_build_object('role', v_role), v_reason);
    end if;
  end loop;

  foreach v_role in array v_old loop
    if not (v_role = any (v_new)) then
      delete from public.role_assignments where user_id = p_user_id and role = v_role;
      insert into public.permission_audit_logs (actor_id, target_user_id, action, before_value, after_value, reason)
      values (v_actor, p_user_id, 'role.revoke', jsonb_build_object('roles', v_old), jsonb_build_object('role', v_role), v_reason);
    end if;
  end loop;

  if not exists (
    select 1 from public.role_assignments r join public.profiles p on p.user_id = r.user_id
    where r.role = 'admin' and p.status = 'active'
  ) then
    raise exception '有効な管理者が 0 名になるため変更できません' using errcode = '42501';
  end if;

  return jsonb_build_object('roles_before', to_jsonb(v_old), 'roles_after', to_jsonb(v_new));
end;
$$;

-- 監査ログ参照（管理者のみ）
create or replace function public.admin_list_audit_logs(p_target_user_id uuid default null, p_limit integer default 200)
returns table (
  id bigint, at timestamptz, action text,
  actor_id uuid, actor_email text, target_user_id uuid, target_email text,
  category_id smallint, category_title text, target_app_id uuid,
  before_value jsonb, after_value jsonb, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query
  select l.id, l.at, l.action, l.actor_id, pa.email, l.target_user_id, pt.email,
         l.category_id, c.title, l.target_app_id, l.before_value, l.after_value, l.reason
  from public.permission_audit_logs l
  left join public.profiles pa on pa.user_id = l.actor_id
  left join public.profiles pt on pt.user_id = l.target_user_id
  left join public.categories c on c.id = l.category_id
  where p_target_user_id is null or l.target_user_id = p_target_user_id
  order by l.at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- =====================================================================
-- C. 管理者：権限プリセット（補助テンプレート。編集しても既存利用者は変更しない）
-- =====================================================================
create or replace function public.admin_list_presets()
returns table (id uuid, name text, category_ids smallint[], sort_order smallint, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query select p.id, p.name, p.category_ids, p.sort_order, p.updated_at
  from public.permission_presets p order by p.sort_order, p.name;
end;
$$;

create or replace function public.admin_save_preset(p_id uuid, p_name text, p_category_ids smallint[], p_sort_order smallint default 100)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
  v_ids smallint[] := app_private.normalize_category_ids(p_category_ids);
  v_id uuid;
  v_before jsonb;
begin
  if p_id is null then
    insert into public.permission_presets (name, category_ids, sort_order, updated_by)
    values (btrim(p_name), v_ids, coalesce(p_sort_order, 100), v_actor)
    returning id into v_id;
  else
    select to_jsonb(p) into v_before from public.permission_presets p where p.id = p_id;
    update public.permission_presets
       set name = btrim(p_name), category_ids = v_ids, sort_order = coalesce(p_sort_order, 100),
           updated_by = v_actor, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'preset not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.permission_audit_logs (actor_id, action, before_value, after_value, reason)
  values (v_actor, 'preset.save', v_before,
          jsonb_build_object('id', v_id, 'name', btrim(p_name), 'category_ids', to_jsonb(v_ids)),
          'プリセット編集（既存利用者の権限は変更しない）');
  return v_id;
end;
$$;

create or replace function public.admin_delete_preset(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
  v_before jsonb;
begin
  select to_jsonb(p) into v_before from public.permission_presets p where p.id = p_id;
  delete from public.permission_presets where id = p_id;
  insert into public.permission_audit_logs (actor_id, action, before_value, reason)
  values (v_actor, 'preset.delete', v_before, 'プリセット削除');
end;
$$;

-- =====================================================================
-- D. 管理者：事前招待（初回 Google ログイン時、検証済みメール一致で本人紐づけ）
-- =====================================================================
create or replace function public.admin_invite_user(p_email text, p_category_ids smallint[], p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.assert_admin();
  v_reason text := app_private.require_reason(p_reason);
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_ids    smallint[] := app_private.normalize_category_ids(p_category_ids);
begin
  if exists (select 1 from public.profiles where email = v_email) then
    raise exception 'このメールの利用者は登録済みです。利用者管理から設定してください' using errcode = '23505';
  end if;
  insert into public.user_invitations (email, category_ids, reason, invited_by)
  values (v_email, v_ids, v_reason, v_actor)
  on conflict (email) do update
    set category_ids = excluded.category_ids, reason = excluded.reason,
        invited_by = excluded.invited_by, invited_at = now()
    where public.user_invitations.consumed_at is null;
  insert into public.permission_audit_logs (actor_id, action, after_value, reason)
  values (v_actor, 'invitation.create', jsonb_build_object('email', v_email, 'category_ids', to_jsonb(v_ids)), v_reason);
end;
$$;

create or replace function public.admin_list_invitations()
returns table (email text, category_ids smallint[], reason text, invited_at timestamptz, consumed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query select i.email, i.category_ids, i.reason, i.invited_at, i.consumed_at
  from public.user_invitations i order by i.invited_at desc;
end;
$$;

create or replace function public.admin_revoke_invitation(p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
begin
  delete from public.user_invitations where email = lower(btrim(p_email)) and consumed_at is null;
  insert into public.permission_audit_logs (actor_id, action, before_value, reason)
  values (v_actor, 'invitation.revoke', jsonb_build_object('email', lower(btrim(p_email))), '招待取消');
end;
$$;

-- =====================================================================
-- E. 管理者：目的・共通アプリ・申請審査
-- =====================================================================
create or replace function public.admin_list_purposes()
returns table (id uuid, category_id smallint, category_title text, title text, description text, sort_order smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query select p.id, p.category_id, c.title, p.title, p.description, p.sort_order
  from public.purposes p join public.categories c on c.id = p.category_id
  order by c.sort_order, p.sort_order, p.title;
end;
$$;

create or replace function public.admin_save_purpose(p_id uuid, p_category_id smallint, p_title text, p_description text, p_sort_order smallint default 100)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
  v_id uuid;
begin
  if p_id is null then
    insert into public.purposes (category_id, title, description, sort_order)
    values (p_category_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_sort_order, 100))
    returning id into v_id;
  else
    update public.purposes
       set category_id = p_category_id, title = btrim(p_title),
           description = nullif(btrim(coalesce(p_description, '')), ''), sort_order = coalesce(p_sort_order, 100)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'purpose not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.permission_audit_logs (actor_id, category_id, action, after_value, reason)
  values (v_actor, p_category_id, 'purpose.save', jsonb_build_object('id', v_id, 'title', btrim(p_title)), '目的の登録・更新');
  return v_id;
end;
$$;

create or replace function public.admin_delete_purpose(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
  v_before jsonb;
begin
  select to_jsonb(p) into v_before from public.purposes p where p.id = p_id;
  delete from public.purposes where id = p_id;
  insert into public.permission_audit_logs (actor_id, action, before_value, reason)
  values (v_actor, 'purpose.delete', v_before, '目的の削除');
end;
$$;

create or replace function public.admin_list_apps()
returns table (
  id uuid, title text, description text, outcome text, usage_scene text, launch_url text,
  status text, owner_id uuid, owner_name text, last_verified_at date, updated_at timestamptz,
  purpose_ids uuid[], category_titles text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query
  select a.id, a.title, a.description, a.outcome, a.usage_scene, a.launch_url, a.status,
         a.owner_id, a.owner_name, a.last_verified_at, a.updated_at,
         coalesce((select array_agg(ap.purpose_id) from public.app_purposes ap where ap.app_id = a.id), '{}'),
         coalesce((select array_agg(distinct c.title) from public.app_purposes ap
                   join public.purposes p on p.id = ap.purpose_id
                   join public.categories c on c.id = p.category_id where ap.app_id = a.id), '{}')
  from public.catalog_apps a
  order by a.updated_at desc;
end;
$$;

create or replace function app_private.replace_app_purposes(p_app_id uuid, p_purpose_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(coalesce(p_purpose_ids, '{}')) x where not exists (select 1 from public.purposes p where p.id = x)) then
    raise exception 'unknown purpose id' using errcode = '22023';
  end if;
  delete from public.app_purposes where app_id = p_app_id and not (purpose_id = any (coalesce(p_purpose_ids, '{}')));
  insert into public.app_purposes (app_id, purpose_id)
  select p_app_id, x from unnest(coalesce(p_purpose_ids, '{}')) x
  on conflict do nothing;
end;
$$;
revoke all on function app_private.replace_app_purposes(uuid, uuid[]) from public;

create or replace function public.admin_save_app(
  p_id uuid,
  p_title text,
  p_description text,
  p_outcome text,
  p_usage_scene text,
  p_launch_url text,
  p_owner_name text,
  p_last_verified_at date,
  p_status text,
  p_purpose_ids uuid[],
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.assert_admin();
  v_reason text := app_private.require_reason(p_reason);
  v_id uuid;
  v_before jsonb;
begin
  if p_status not in ('draft', 'approved', 'suspended', 'retired') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.catalog_apps (title, description, outcome, usage_scene, launch_url, owner_name, last_verified_at, status, created_by)
    values (btrim(p_title), coalesce(p_description, ''), coalesce(p_outcome, ''), coalesce(p_usage_scene, ''),
            btrim(p_launch_url), nullif(btrim(coalesce(p_owner_name, '')), ''), p_last_verified_at, p_status, v_actor)
    returning id into v_id;
  else
    select to_jsonb(a) into v_before from public.catalog_apps a where a.id = p_id;
    update public.catalog_apps
       set title = btrim(p_title), description = coalesce(p_description, ''), outcome = coalesce(p_outcome, ''),
           usage_scene = coalesce(p_usage_scene, ''), launch_url = btrim(p_launch_url),
           owner_name = nullif(btrim(coalesce(p_owner_name, '')), ''), last_verified_at = p_last_verified_at,
           status = p_status
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'app not found' using errcode = 'P0002'; end if;
  end if;
  perform app_private.replace_app_purposes(v_id, p_purpose_ids);
  insert into public.permission_audit_logs (actor_id, target_app_id, action, before_value, after_value, reason)
  values (v_actor, v_id, 'app.save', v_before,
          jsonb_build_object('title', btrim(p_title), 'status', p_status, 'launch_url', btrim(p_launch_url),
                             'purpose_ids', to_jsonb(coalesce(p_purpose_ids, '{}'))), v_reason);
  return v_id;
end;
$$;

create or replace function public.admin_list_submissions(p_status text default 'submitted')
returns table (
  id uuid, submitted_by uuid, submitter_email text, target_app_id uuid, payload jsonb,
  status text, review_note text, reviewed_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_admin();
  return query
  select s.id, s.submitted_by, p.email, s.target_app_id, s.payload, s.status, s.review_note, s.reviewed_at, s.created_at
  from public.app_submissions s left join public.profiles p on p.user_id = s.submitted_by
  where p_status is null or s.status = p_status
  order by s.created_at desc
  limit 500;
end;
$$;

-- 申請審査。承認時に共通カタログの唯一の正本を作成（または対象アプリを更新）して公開する
create or replace function public.admin_review_submission(p_id uuid, p_decision text, p_note text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_admin();
  v_sub public.app_submissions%rowtype;
  v_payload jsonb;
  v_app_id uuid;
  v_purpose_ids uuid[];
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  select * into v_sub from public.app_submissions where id = p_id for update;
  if not found then raise exception 'submission not found' using errcode = 'P0002'; end if;
  if v_sub.status <> 'submitted' then raise exception 'already reviewed' using errcode = '22023'; end if;

  if p_decision = 'approved' then
    v_payload := v_sub.payload;
    select coalesce(array_agg(x::uuid), '{}') into v_purpose_ids
    from jsonb_array_elements_text(coalesce(v_payload -> 'purpose_ids', '[]'::jsonb)) x;

    v_app_id := public.admin_save_app(
      v_sub.target_app_id,
      v_payload ->> 'title',
      v_payload ->> 'description',
      v_payload ->> 'outcome',
      v_payload ->> 'usage_scene',
      v_payload ->> 'launch_url',
      v_payload ->> 'owner_name',
      current_date,
      'approved',
      v_purpose_ids,
      'submission:' || p_id::text || ' ' || coalesce(p_note, '')
    );
  end if;

  update public.app_submissions
     set status = p_decision, review_note = p_note, reviewed_by = v_actor, reviewed_at = now(),
         target_app_id = coalesce(v_app_id, target_app_id)
   where id = p_id;

  insert into public.permission_audit_logs (actor_id, target_user_id, target_app_id, action, after_value, reason)
  values (v_actor, v_sub.submitted_by, v_app_id, 'submission.' || p_decision,
          jsonb_build_object('submission_id', p_id), p_note);
  return v_app_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 管理 RPC の EXECUTE は authenticated のみ（関数内で admin を再検証）
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_list_categories()',
    'public.admin_list_users(text)',
    'public.admin_get_user(uuid)',
    'public.admin_save_user_access(uuid, text, smallint[], text)',
    'public.admin_set_roles(uuid, text[], text)',
    'public.admin_list_audit_logs(uuid, integer)',
    'public.admin_list_presets()',
    'public.admin_save_preset(uuid, text, smallint[], smallint)',
    'public.admin_delete_preset(uuid)',
    'public.admin_invite_user(text, smallint[], text)',
    'public.admin_list_invitations()',
    'public.admin_revoke_invitation(text)',
    'public.admin_list_purposes()',
    'public.admin_save_purpose(uuid, smallint, text, text, smallint)',
    'public.admin_delete_purpose(uuid)',
    'public.admin_list_apps()',
    'public.admin_save_app(uuid, text, text, text, text, text, text, date, text, uuid[], text)',
    'public.admin_list_submissions(text)',
    'public.admin_review_submission(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
