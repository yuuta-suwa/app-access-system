import { useState } from 'react';
import { admin, formatDate, friendlyError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading } from '../../components/ui';

const TABS = [['submitted', '審査待ち'], ['approved', '承認済み'], ['rejected', '差戻し'], ['', 'すべて']] as const;

export default function AdminSubmissionsPage() {
  const [tab, setTab] = useState<string>('submitted');
  const { data, error, loading, reload } = useAsync(async () => ({
    subs: await admin.listSubmissions(tab || null), purposes: await admin.listPurposes(),
  }), [tab]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const review = async (id: string, decision: 'approved' | 'rejected') => {
    const label = decision === 'approved' ? '承認して公開' : '差戻し';
    if (!window.confirm(`この申請を${label}しますか？`)) return;
    try {
      await admin.reviewSubmission(id, decision, notes[id] ?? '');
      setMsg(`${label}しました。`);
      reload();
    } catch (e) { setMsg(friendlyError(e)); }
  };

  return (
    <div>
      <div className="chips">
        {TABS.map(([k, v]) => <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {msg && <p className="flash">{msg}</p>}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (data?.subs ?? []).map((s) => {
        const pmap = new Map((data?.purposes ?? []).map((p) => [p.id, `${p.category_title} › ${p.title}`]));
        return (
          <article key={s.id} className="card">
            <h3>{s.payload.title} <span className="meta">（{s.status}）</span></h3>
            <dl className="app-facts">
              <dt>申請者</dt><dd>{s.submitter_email ?? '—'} ／ {formatDate(s.created_at)}</dd>
              <dt>利用 URL</dt><dd className="mono">{s.payload.launch_url}</dd>
              <dt>できること</dt><dd>{s.payload.description}</dd>
              <dt>目指す状態</dt><dd>{s.payload.outcome || '—'}</dd>
              <dt>使う場面</dt><dd>{s.payload.usage_scene || '—'}</dd>
              <dt>管理責任者</dt><dd>{s.payload.owner_name}</dd>
              <dt>目的</dt><dd>{(s.payload.purpose_ids ?? []).map((id) => pmap.get(id) ?? '(不明な目的)').join('、')}</dd>
              {s.payload.screenshot_url && <><dt>画面見本</dt><dd className="mono">{s.payload.screenshot_url}</dd></>}
              {s.payload.note && <><dt>備考</dt><dd>{s.payload.note}</dd></>}
              {s.target_app_id && <><dt>対象アプリ</dt><dd className="mono">{s.target_app_id}</dd></>}
            </dl>
            {s.status === 'submitted' ? (
              <div className="form-grid">
                <p className="fine">承認前に利用 URL が正しく開けること、管理責任者を確認してください（URL は自動で開きません）。</p>
                <label>審査コメント<input value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} maxLength={500} /></label>
                <div className="row">
                  <button className="btn primary" onClick={() => void review(s.id, 'approved')}>承認して公開</button>
                  <button className="btn ghost danger" onClick={() => void review(s.id, 'rejected')}>差戻し</button>
                </div>
              </div>
            ) : <p className="meta">審査コメント：{s.review_note ?? '—'}（{formatDate(s.reviewed_at)}）</p>}
          </article>
        );
      })}
      {data && data.subs.length === 0 && <p className="empty">該当する申請はありません。</p>}
    </div>
  );
}
