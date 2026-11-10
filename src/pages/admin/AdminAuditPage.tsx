import { admin, formatDate, type AuditRow } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading } from '../../components/ui';

const ACTION: Record<string, string> = {
  'status.change': '状態変更', 'category.grant': '分類許可', 'category.revoke': '分類解除',
  'role.grant': 'ロール付与', 'role.revoke': 'ロール解除', 'preset.save': 'プリセット保存', 'preset.delete': 'プリセット削除',
  'invitation.create': '招待登録', 'invitation.revoke': '招待取消', 'app.save': 'アプリ保存', 'purpose.save': '目的保存',
  'purpose.delete': '目的削除', 'submission.approved': '申請承認', 'submission.rejected': '申請差戻し',
};

function short(v: unknown): string {
  if (v == null) return '';
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>日時</th><th>操作</th><th>操作者</th><th>対象者</th><th>分類</th><th>変更前→後</th><th>理由</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.at)}</td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td>{r.actor_email ?? (r.actor_id ? r.actor_id.slice(0, 8) : 'システム')}</td>
              <td>{r.target_email ?? '—'}</td>
              <td>{r.category_title ?? '—'}</td>
              <td className="mono">{short(r.before_value)} → {short(r.after_value)}</td>
              <td>{r.reason ?? ''}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7}>履歴はありません。</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAuditPage() {
  const { data, error, loading, reload } = useAsync(() => admin.auditLogs(null, 500), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="card">
      <h2 className="section-title">権限・掲載の変更履歴（最新 500 件）</h2>
      <p className="fine">監査ログは追記専用です。画面・API から編集・削除することはできません。</p>
      <AuditTable rows={data ?? []} />
    </div>
  );
}
