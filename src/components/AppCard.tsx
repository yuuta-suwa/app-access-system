import { useState } from 'react';
import { Link } from 'react-router-dom';
import { friendlyError, formatDay, saveCatalogToSelf, type CatalogApp } from '../lib/api';
import { openExternal } from '../lib/url';

export default function AppCard({ app, saved, onSaved }: { app: CatalogApp; saved: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveCatalogToSelf(app.id);
      onSaved();
      setMsg('SELF に保存しました');
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="app-card">
      <h3><Link to={`/apps/${app.id}`}>{app.title}</Link></h3>
      <dl className="app-facts">
        <dt>できること</dt><dd>{app.description || '—'}</dd>
        <dt>目指す状態</dt><dd>{app.outcome || '—'}</dd>
        <dt>使う場面</dt><dd>{app.usage_scene || '—'}</dd>
      </dl>
      <p className="meta">最終確認日：{formatDay(app.last_verified_at)}</p>
      <div className="row">
        <button className="btn primary" onClick={() => openExternal(app.launch_url)}>
          アプリを開く <span aria-hidden="true">↗</span>
        </button>
        <button className="btn ghost" disabled={busy || saved} onClick={() => void save()}>
          {saved ? 'SELF に保存済み' : 'SELF に保存'}
        </button>
      </div>
      {msg && <p className="meta" role="status">{msg}</p>}
    </article>
  );
}
