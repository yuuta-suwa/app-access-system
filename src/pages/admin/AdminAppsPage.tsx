import { useState } from 'react';
import { admin, formatDay, friendlyError, type AdminApp, type AdminPurpose, type Category } from '../../lib/api';
import { checkUrl } from '../../lib/url';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading } from '../../components/ui';

const APP_STATUS: Record<string, string> = { draft: '下書き（非公開）', approved: '公開', suspended: '停止', retired: '廃止' };

async function load() {
  const [apps, purposes, cats] = await Promise.all([admin.listApps(), admin.listPurposes(), admin.listCategories()]);
  return { apps, purposes, cats };
}

type Draft = {
  id: string | null; title: string; description: string; outcome: string; usage_scene: string; launch_url: string;
  owner_name: string; last_verified_at: string; status: string; purpose_ids: string[]; reason: string;
};

const empty: Draft = { id: null, title: '', description: '', outcome: '', usage_scene: '', launch_url: '', owner_name: '', last_verified_at: '', status: 'draft', purpose_ids: [], reason: '' };

export default function AdminAppsPage() {
  const { data, error, loading, reload } = useAsync(load, []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const edit = (a: AdminApp) => setDraft({
    id: a.id, title: a.title, description: a.description, outcome: a.outcome, usage_scene: a.usage_scene,
    launch_url: a.launch_url, owner_name: a.owner_name ?? '', last_verified_at: a.last_verified_at ?? '',
    status: a.status, purpose_ids: a.purpose_ids, reason: '',
  });

  const save = async () => {
    if (!draft) return;
    const u = checkUrl(draft.launch_url);
    if (!u.ok) return setMsg(u.error);
    if (draft.status === 'approved' && draft.purpose_ids.length === 0) return setMsg('公開するには目的を 1 つ以上選んでください。');
    try {
      await admin.saveApp({ ...draft, launch_url: u.url, last_verified_at: draft.last_verified_at || null });
      setDraft(null);
      setMsg('保存しました。');
      reload();
    } catch (e) {
      setMsg(friendlyError(e));
    }
  };

  return (
    <div>
      <div className="card">
        <div className="title-row">
          <h2 className="section-title">共通アプリ一覧</h2>
          <button className="btn" onClick={() => setDraft({ ...empty })}>＋ アプリを登録</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>アプリ名</th><th>分類</th><th>利用 URL</th><th>責任者</th><th>公開状態</th><th>最終動作確認</th><th></th></tr></thead>
            <tbody>
              {data.apps.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>{a.category_titles.join('、') || '—'}</td>
                  <td className="mono">{a.launch_url}</td>
                  <td>{a.owner_name ?? '—'}</td>
                  <td><span className={`status app-${a.status}`}>{APP_STATUS[a.status] ?? a.status}</span></td>
                  <td>{formatDay(a.last_verified_at)}</td>
                  <td><button className="btn small" onClick={() => edit(a)}>編集</button></td>
                </tr>
              ))}
              {data.apps.length === 0 && <tr><td colSpan={7}>登録されたアプリはありません。</td></tr>}
            </tbody>
          </table>
        </div>
        {msg && <p className="flash">{msg}</p>}
      </div>

      {draft && <AppForm draft={draft} setDraft={setDraft} purposes={data.purposes} cats={data.cats} onSave={() => void save()} />}

      <PurposeManager purposes={data.purposes} cats={data.cats} onChanged={reload} />
    </div>
  );
}

function AppForm({ draft, setDraft, purposes, cats, onSave }: {
  draft: Draft; setDraft: (d: Draft | null) => void; purposes: AdminPurpose[]; cats: Category[]; onSave: () => void;
}) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="card form-grid">
      <h2 className="section-title">{draft.id ? 'アプリを編集' : 'アプリを登録'}</h2>
      <label>アプリ名<input value={draft.title} onChange={set('title')} maxLength={120} /></label>
      <label>利用用 URL（管理用 URL ではなく利用者が開く URL）<input value={draft.launch_url} onChange={set('launch_url')} maxLength={2048} /></label>
      <label>できること<textarea value={draft.description} onChange={set('description')} rows={2} /></label>
      <label>使った後に目指す状態<textarea value={draft.outcome} onChange={set('outcome')} rows={2} /></label>
      <label>使う場面<textarea value={draft.usage_scene} onChange={set('usage_scene')} rows={2} /></label>
      <label>管理責任者<input value={draft.owner_name} onChange={set('owner_name')} maxLength={120} /></label>
      <label>最終動作確認日<input type="date" value={draft.last_verified_at} onChange={set('last_verified_at')} /></label>
      <label>公開状態
        <select value={draft.status} onChange={set('status')}>
          {Object.entries(APP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>掲載する目的（複数分類への掲載は同じアプリを再利用）</legend>
        {cats.map((c) => {
          const ps = purposes.filter((p) => p.category_id === c.id);
          return (
            <div key={c.id} className="purpose-group">
              <strong>{c.title}</strong>
              {ps.length === 0 && <span className="meta">（目的未登録）</span>}
              {ps.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={draft.purpose_ids.includes(p.id)}
                    onChange={(e) => setDraft({ ...draft, purpose_ids: e.target.checked ? [...draft.purpose_ids, p.id] : draft.purpose_ids.filter((x) => x !== p.id) })} />
                  {p.title}
                </label>
              ))}
            </div>
          );
        })}
      </fieldset>
      <label>変更理由（必須）<input value={draft.reason} onChange={set('reason')} maxLength={500} /></label>
      <div className="row">
        <button className="btn primary" disabled={!draft.title.trim() || !draft.reason.trim()} onClick={onSave}>保存</button>
        <button className="btn ghost" onClick={() => setDraft(null)}>取消</button>
      </div>
    </div>
  );
}

function PurposeManager({ purposes, cats, onChanged }: { purposes: AdminPurpose[]; cats: Category[]; onChanged: () => void }) {
  const [cat, setCat] = useState<number>(cats[0]?.id ?? 1);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const add = async () => {
    try {
      await admin.savePurpose(null, cat, title, desc, (purposes.filter((p) => p.category_id === cat).length + 1) * 10);
      setTitle(''); setDesc('');
      onChanged();
    } catch (e) { setMsg(friendlyError(e)); }
  };

  return (
    <div className="card">
      <h2 className="section-title">分類ごとの「やりたいこと」（目的）</h2>
      <div className="form-grid">
        <label>分類<select value={cat} onChange={(e) => setCat(Number(e.target.value))}>{cats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>目的（例：顧客の進捗を確認したい）<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
        <label>補足説明（任意）<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <button className="btn" disabled={!title.trim()} onClick={() => void add()}>目的を追加</button>
      </div>
      {msg && <p className="flash">{msg}</p>}
      <table className="table">
        <thead><tr><th>分類</th><th>目的</th><th>並び順</th><th></th></tr></thead>
        <tbody>
          {purposes.map((p) => (
            <tr key={p.id}>
              <td>{p.category_title}</td>
              <td>{p.title}{p.description && <span className="meta"> — {p.description}</span>}</td>
              <td>{p.sort_order}</td>
              <td className="row">
                <button className="btn small" onClick={async () => {
                  const t = window.prompt('目的を変更', p.title);
                  if (!t || !t.trim()) return;
                  try { await admin.savePurpose(p.id, p.category_id, t.trim(), p.description ?? '', p.sort_order); onChanged(); } catch (e) { setMsg(friendlyError(e)); }
                }}>名前変更</button>
                <button className="btn small ghost danger" onClick={async () => {
                  if (!window.confirm(`目的「${p.title}」を削除しますか？ アプリとの紐づけも解除されます。`)) return;
                  try { await admin.deletePurpose(p.id); onChanged(); } catch (e) { setMsg(friendlyError(e)); }
                }}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
