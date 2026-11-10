-- =====================================================================
-- 最初の管理者の登録（DB 運営者が SQL Editor から 1 回だけ実行）
--   1. 対象者が一度 Google でログインし、profiles に pending で作成されていること
--   2. 下の :admin_email を実際のメールに置き換えて実行
--   Google ユーザーが自分で管理者権限を設定する経路は存在しない。
--   管理者は 2 名以上を推奨（喪失時の復旧のため）。
-- =====================================================================
begin;

with target as (
  select user_id from public.profiles where email = lower('REPLACE_WITH_ADMIN_EMAIL@example.com')
)
update public.profiles p
   set status = 'active', status_changed_at = now()
  from target t
 where p.user_id = t.user_id;

insert into public.role_assignments (user_id, role)
select user_id, 'admin' from public.profiles where email = lower('REPLACE_WITH_ADMIN_EMAIL@example.com')
on conflict do nothing;

insert into public.permission_audit_logs (actor_id, target_user_id, action, after_value, reason)
select null, user_id, 'role.grant', jsonb_build_object('role', 'admin'), 'bootstrap: DB operator'
from public.profiles where email = lower('REPLACE_WITH_ADMIN_EMAIL@example.com');

-- 対象が見つからない場合は中止
do $$
begin
  if not exists (
    select 1 from public.role_assignments r join public.profiles p on p.user_id = r.user_id
    where r.role = 'admin' and p.status = 'active'
  ) then
    raise exception 'admin bootstrap failed: profile not found (先に Google ログインを 1 回実施してください)';
  end if;
end $$;

commit;
