import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAccess, useAuth } from '../auth/AuthProvider';

export default function Layout() {
  const access = useAccess();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const isAdmin = access.roles.includes('admin');
  const isCreator = isAdmin || access.roles.includes('creator');

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v) navigate(`/search?q=${encodeURIComponent(v)}`);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="LEI APP HUB ホーム">
          <span className="brand-mark">L</span>
          <span className="brand-name">LEI APP HUB</span>
        </Link>
        <form className="search" role="search" onSubmit={onSearch}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="やりたいこと・アプリ名で探す"
            aria-label="検索"
            maxLength={100}
            autoComplete="off"
          />
        </form>
        <nav className="topnav">
          <NavLink to="/self">SELF</NavLink>
          {isCreator && <NavLink to="/submit">登録申請</NavLink>}
          {isAdmin && <NavLink to="/admin">管理</NavLink>}
          <button className="linklike" onClick={() => void signOut()} title={access.email}>
            ログアウト
          </button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">
        <span>{access.display_name ?? access.email}</span>
      </footer>
    </div>
  );
}
