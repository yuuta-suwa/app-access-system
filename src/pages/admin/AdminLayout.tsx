import { NavLink, Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <section>
      <h1 className="page-title">管理</h1>
      <p className="fine">管理画面はサーバー（DB）側で管理者ロールを検証します。個人の SELF は管理画面から閲覧・検索・編集できません。</p>
      <nav className="subnav">
        <NavLink to="users">利用者管理</NavLink>
        <NavLink to="apps">共通アプリ・目的</NavLink>
        <NavLink to="submissions">登録申請</NavLink>
        <NavLink to="presets">権限プリセット</NavLink>
        <NavLink to="audit">変更履歴</NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
