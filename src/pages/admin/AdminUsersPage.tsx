import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { admin, formatDate, friendlyError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading } from '../../components/ui';

export const STATUS_LABEL = { pending: '承認待ち', active: '利用可能', suspended: '利用停止' } as const;

export default function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const users = useAsync(() => admin.listUsers(query), [query]);

  return (
    <div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input type="search" placeholder="氏名・メールで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">検索</button>
      </form>
      {users.loading ? <Loading /> : users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>氏名</th><th>Google 認証メール</th><th>状態</th><th>許可分類数</th><th>ロール</th><th>最終ログイン</th><th>操作</th></tr></thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.user_id}>
                  <td>{u.display_name ?? '—'}</td>
                  <td>{u.email}</td>
                  <td><span className={`status ${u.status}`}>{STATUS_LABEL[u.status]}</span></td>
                  <td>{u.category_count} / 8</td>
                  <td>{u.roles.length ? u.roles.join(', ') : 'member'}</td>
                  <td>{formatDate(u.last_sign_in_at)}</td>
                  <td><Link className="btn small" to={`/admin/users/${u.user_id}`}>編集</Link></td>
                </tr>
              ))}
              {(users.data ?? []).length === 0 && <tr><td colSpan={7}>該当する利用者はいません。</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Invitations />
    </div>
  );
}

function Invitations() {
  const inv = useAsync(async () => ({ list: await admin.listInvitations(), cats: await admin.listCategories() }), []);
  const [email, setEmail] = useState('');
  const [cats, setCats] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await admin.invite(email, cats, reason);
      setEmail(''); setCats([]); setReason('');
      setMsg('招待を登録しました。本人が初回 Google ログインした時点で利用可能になります。');
      inv.reload();
    } catch (e2) {
      setMsg(friendlyError(e2));
    }
  };

  if (inv.loading) return <Loading />;
  if (inv.error) return <ErrorBox message={inv.error} onRetry={inv.reload} />;
  const catTitle = new Map((inv.data?.cats ?? []).map((c) => [c.id, c.title]));
  return (
    <div className="card">
      <h2 className="section-title">事前招待</h2>
      <p className="fine">Google が検証したメールアドレスが一致した場合のみ、初回ログイン時に active＋指定分類で紐づけます。管理者ロールは付与しません。</p>
      <form className="form-grid" onSubmit={submit}>
        <label>メールアドレス<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <div className="chips">
          {(inv.data?.cats ?? []).map((c) => (
            <label key={c.id} className="check"><input type="checkbox" checked={cats.includes(c.id)}
              onChange={(e) => setCats(e.target.checked ? [...cats, c.id] : cats.filter((x) => x !== c.id))} />{c.title}</label>
          ))}
        </div>
        <label>理由<input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} /></label>
        {msg && <p className="flash">{msg}</p>}
        <button className="btn primary">招待を登録</button>
      </form>
      <table className="table">
        <thead><tr><th>メール</th><th>分類</th><th>招待日</th><th>状態</th><th></th></tr></thead>
        <tbody>
          {(inv.data?.list ?? []).map((i) => (
            <tr key={i.email}>
              <td>{i.email}</td>
              <td>{i.category_ids.map((c) => catTitle.get(c)).join('、') || 'SELF のみ'}</td>
              <td>{formatDate(i.invited_at)}</td>
              <td>{i.consumed_at ? `紐づけ済み（${formatDate(i.consumed_at)}）` : '未ログイン'}</td>
              <td>{!i.consumed_at && <button className="btn small ghost" onClick={async () => {
                if (!window.confirm(`${i.email} の招待を取り消しますか？`)) return;
                try { await admin.revokeInvitation(i.email); inv.reload(); } catch (e) { setMsg(friendlyError(e)); }
              }}>取消</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
