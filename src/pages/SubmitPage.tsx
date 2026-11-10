import { useState, type FormEvent } from 'react';
import { createSubmission, formatDate, friendlyError, listCategories, listMySubmissions, listPurposes } from '../lib/api';
import { checkUrl } from '../lib/url';
import { useAsync } from '../lib/useAsync';
import { ErrorBox, Loading } from '../components/ui';

const STATUS: Record<string, string> = { submitted: '審査中', approved: '承認・掲載', rejected: '差戻し', withdrawn: '取下げ' };

async function load() {
  const cats = await listCategories();
  const purposes = (await Promise.all(cats.map((c) => listPurposes(c.id)))).flat();
  const mine = await listMySubmissions();
  return { cats, purposes, mine };
}

export default function SubmitPage() {
  const { data, error, loading, reload } = useAsync(load, []);
  const [f, setF] = useState({ title: '', description: '', outcome: '', usage_scene: '', launch_url: '', owner_name: '', screenshot_url: '', note: '' });
  const [purposeIds, setPurposeIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const u = checkUrl(f.launch_url);
    if (!u.ok) return setMsg(u.error);
    if (f.screenshot_url) {
      const s = checkUrl(f.screenshot_url);
      if (!s.ok) return setMsg(`画面見本: ${s.error}`);
    }
    if (purposeIds.length === 0) return setMsg('対応する目的を 1 つ以上選んでください。');
    if (!f.owner_name.trim()) return setMsg('管理責任者を入力してください。');
    setBusy(true);
    try {
      await createSubmission({ ...f, launch_url: u.url, purpose_ids: purposeIds });
      setF({ title: '', description: '', outcome: '', usage_scene: '', launch_url: '', owner_name: '', screenshot_url: '', note: '' });
      setPurposeIds([]);
      setMsg('申請しました。管理者の承認後に掲載されます。');
      reload();
    } catch (e2) {
      setMsg(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1 className="page-title">共通アプリの登録申請</h1>
      <p className="lead">申請内容は管理者の審査・承認後に共通カタログへ掲載されます。申請中は一般利用者に公開されません。</p>
      <form className="card form-grid" onSubmit={submit}>
        <label>アプリ名<input value={f.title} onChange={set('title')} maxLength={120} required /></label>
        <label>利用用 URL（https://）<input value={f.launch_url} onChange={set('launch_url')} maxLength={2048} required /></label>
        <label>できること<textarea value={f.description} onChange={set('description')} rows={2} required /></label>
        <label>使った後に目指す状態<textarea value={f.outcome} onChange={set('outcome')} rows={2} /></label>
        <label>使う場面<textarea value={f.usage_scene} onChange={set('usage_scene')} rows={2} /></label>
        <label>管理責任者<input value={f.owner_name} onChange={set('owner_name')} maxLength={120} required /></label>
        <label>画面見本 URL（任意）<input value={f.screenshot_url} onChange={set('screenshot_url')} maxLength={2048} /></label>
        <fieldset>
          <legend>分類・対応する目的</legend>
          {data.cats.map((c) => {
            const ps = data.purposes.filter((p) => p.category_id === c.id);
            if (ps.length === 0) return null;
            return (
              <div key={c.id} className="purpose-group">
                <strong>{c.title}</strong>
                {ps.map((p) => (
                  <label key={p.id} className="check">
                    <input type="checkbox" checked={purposeIds.includes(p.id)}
                      onChange={(e) => setPurposeIds(e.target.checked ? [...purposeIds, p.id] : purposeIds.filter((x) => x !== p.id))} />
                    {p.title}
                  </label>
                ))}
              </div>
            );
          })}
          <p className="fine">一覧にない分類・目的への掲載は、備考に記載してください（管理者が設定します）。</p>
        </fieldset>
        <label>備考<textarea value={f.note} onChange={set('note')} rows={2} /></label>
        {msg && <p className="flash" role="status">{msg}</p>}
        <button className="btn primary" disabled={busy}>申請する</button>
      </form>

      <h2 className="section-title">自分の申請</h2>
      <table className="table">
        <thead><tr><th>アプリ名</th><th>状態</th><th>申請日</th><th>審査コメント</th></tr></thead>
        <tbody>
          {data.mine.map((s) => (
            <tr key={s.id}><td>{s.payload.title}</td><td>{STATUS[s.status] ?? s.status}</td><td>{formatDate(s.created_at)}</td><td>{s.review_note ?? '—'}</td></tr>
          ))}
          {data.mine.length === 0 && <tr><td colSpan={4}>申請はまだありません。</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
