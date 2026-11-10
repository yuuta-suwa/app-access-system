import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Loading() {
  return <div className="loading" role="status">読み込み中…</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>再読み込み</button>}
    </div>
  );
}

/** 権限外・存在しない・停止中を区別しない汎用表示（存在有無を漏らさない） */
export function NotAvailable() {
  return (
    <div className="notice">
      <h1>このページは利用できません</h1>
      <p>URL が正しくないか、閲覧できる範囲外の内容です。</p>
      <Link className="btn" to="/">ホームへ戻る</Link>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { to?: string; label: string }[] }) {
  return (
    <nav className="crumbs" aria-label="パンくず">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">›</span>}
          {it.to ? <Link to={it.to}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
