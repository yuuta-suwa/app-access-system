import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { admin, formatDate, friendlyError, isUuid, type Category, type Role, type Status } from '../../lib/api';
import { useAccess } from '../../auth/AuthProvider';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading, NotAvailable } from '../../components/ui';
import { STATUS_LABEL } from './AdminUsersPage';
import { AuditTable } from './AdminAuditPage';

async function load(id: string) {
  const [user, cats, presets, logs] = await Promise.all([
    admin.getUser(id), admin.listCategories(), admin.listPresets(), admin.auditLogs(id, 100),
  ]);
  return { user, cats, presets, logs };
}

export default function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const me = useAccess();
  const { data, error, loading, reload } = useAsync(() => (isUuid(id) ? load(id) : Promise.resolve(null)), [id]);

  // 編集中の値（「保存」を押すまで DB を更新しない）
  const [status, setStatus] = useState<Status>('pending');
  const [cats, setCats] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setStatus(data.user.status);
      setCats(data.user.category_ids);
    }
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <NotAvailable />;
  const { user } = data;
  const isSelf = user.user_id === me.user_id;

  const added = cats.filter((c) => !user.category_ids.includes(c));
  const removed = user.category_ids.filter((c) => !cats.includes(c));
  const statusChanged = status !== user.status;
  const dirty = added.length > 0 || removed.length > 0 || statusChanged;
  const title = (cid: number) => data.cats.find((c) => c.id === cid)?.title ?? String(cid);

  const toggle = (c: Category, on: boolean) => setCats(on ? [...new Set([...cats, c.id])].sort() : cats.filter((x) => x !== c.id));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await admin.saveUserAccess(user.user_id, status, cats, reason);
      setReason('');
      setConfirming(false);
      setMsg('保存しました。対象者の次回データ取得から反映されます。');
      reload();
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p><Link to="/admin/users">‹ 利用者一覧</Link></p>
      <div className="card">
        <h2 className="section-title">{user.display_name ?? '(氏名未設定)'} <span className="meta">{user.email}</span></h2>
        <p className="meta">登録：{formatDate(user.created_at)} ／ 最終ログイン：{formatDate(user.last_sign_in_at)}</p>

        <h3>アカウント状態</h3>
        <div className="chips">
          {(['pending', 'active', 'suspended'] as Status[]).map((s) => (
            <label key={s} className="check">
              <input type="radio" name="status" checked={status === s} disabled={isSelf} onChange={() => setStatus(s)} />
              {STATUS_LABEL[s]}（{s}）
            </label>
          ))}
        </div>
        {isSelf && <p className="fine">自分自身のアカウント状態は変更できません。</p>}

        <h3>共通 8 分類の閲覧許可</h3>
        <div className="row wrap">
          <button className="btn small" onClick={() => setCats(data.cats.map((c) => c.id))}>8 分類すべて許可</button>
          <button className="btn small" onClick={() => setCats([])}>すべて解除</button>
          {data.presets.map((p) => (
            <button key={p.id} className="btn small ghost" onClick={() => setCats([...p.category_ids])}>プリセット：{p.name}</button>
          ))}
        </div>
        <table className="table toggles">
          <tbody>
            {data.cats.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>
                  <label className="switch">
                    <input type="checkbox" checked={cats.includes(c.id)} onChange={(e) => toggle(c, e.target.checked)} />
                    <span>{cats.includes(c.id) ? 'ON' : 'OFF'}</span>
                  </label>
                </td>
              </tr>
            ))}
            <tr className="muted"><td>SELF</td><td>自動付与（active 時）・OFF 不可</td></tr>
          </tbody>
        </table>
        <p className="fine">分類の閲覧許可を付けても管理者ロールは付与されません。プリセットは補助であり、適用後に個別修正できます。</p>

        <label className="block">変更理由（必須・監査ログに記録）
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <div className="row">
          <button className="btn primary" disabled={!dirty || !reason.trim() || busy} onClick={() => setConfirming(true)}>保存</button>
          <button className="btn ghost" disabled={!dirty} onClick={() => { setStatus(user.status); setCats(user.category_ids); }}>変更を取り消す</button>
        </div>
        {msg && <p className="flash" role="status">{msg}</p>}
      </div>

      {confirming && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal-body">
            <h3 id="confirm-title">次の内容で保存しますか？</h3>
            <ul>
              {statusChanged && <li>状態：{STATUS_LABEL[user.status]} → <strong>{STATUS_LABEL[status]}</strong></li>}
              {added.map((c) => <li key={`a${c}`}>許可を追加：<strong>{title(c)}</strong></li>)}
              {removed.map((c) => <li key={`r${c}`}>許可を解除：<strong>{title(c)}</strong></li>)}
            </ul>
            <p className="meta">理由：{reason}</p>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void save()}>保存する</button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>戻る</button>
            </div>
          </div>
        </div>
      )}

      <RolesCard userId={user.user_id} roles={user.roles} isSelf={isSelf} active={user.status === 'active'} onSaved={reload} />

      <div className="card">
        <h2 className="section-title">変更履歴</h2>
        <AuditTable rows={data.logs} />
      </div>
    </div>
  );
}

function RolesCard({ userId, roles, isSelf, active, onSaved }: { userId: string; roles: Role[]; isSelf: boolean; active: boolean; onSaved: () => void }) {
  const [sel, setSel] = useState<Role[]>(roles);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setSel(roles), [roles]);
  const dirty = [...sel].sort().join() !== [...roles].sort().join();

  const save = async () => {
    const promoting = sel.includes('admin') && !roles.includes('admin');
    if (!window.confirm(promoting ? '管理者ロールを付与します。他の利用者の権限設定や共通アプリ掲載を変更できるようになります。よろしいですか？' : 'ロールを変更しますか？')) return;
    setMsg(null);
    try {
      await admin.setRoles(userId, sel, reason);
      setReason('');
      setMsg('ロールを変更しました。');
      onSaved();
    } catch (e) {
      setMsg(friendlyError(e));
    }
  };

  return (
    <div className="card">
      <h2 className="section-title">ロール（分類許可とは別管理）</h2>
      {isSelf ? <p className="fine">自分自身のロールは変更できません（別の管理者が操作してください）。</p> : !active ? <p className="fine">creator / admin は active 利用者にのみ付与できます。</p> : null}
      <div className="chips">
        {(['creator', 'admin'] as Role[]).map((r) => (
          <label key={r} className="check">
            <input type="checkbox" disabled={isSelf} checked={sel.includes(r)} onChange={(e) => setSel(e.target.checked ? [...sel, r] : sel.filter((x) => x !== r))} />
            {r === 'creator' ? 'creator（共通アプリの登録申請）' : 'admin（利用者承認・権限・掲載管理）'}
          </label>
        ))}
      </div>
      <label className="block">変更理由（必須）<input value={reason} disabled={isSelf} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <button className="btn" disabled={isSelf || !dirty || !reason.trim()} onClick={() => void save()}>ロールを保存</button>
      {msg && <p className="flash">{msg}</p>}
    </div>
  );
}
