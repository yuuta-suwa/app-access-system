import { useAuth } from '../auth/AuthProvider';

function StatusShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { signOut, refreshAccess, state } = useAuth();
  const email = state.kind === 'signedIn' ? state.access?.email ?? state.session.user.email : '';
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-mark big">L</div>
        <h1>{title}</h1>
        {children}
        {email && <p className="fine">ログイン中：{email}</p>}
        <div className="row center">
          <button className="btn" onClick={() => void refreshAccess()}>状態を再確認</button>
          <button className="btn ghost" onClick={() => void signOut()}>ログアウト</button>
        </div>
      </div>
    </div>
  );
}

export function PendingPage() {
  return (
    <StatusShell title="管理者の承認待ちです">
      <ol className="steps">
        <li className="done">Google での本人確認 — 完了</li>
        <li className="current">管理者による利用承認 — 承認待ち</li>
        <li>利用できる分類の設定 — 承認後に管理者が設定</li>
      </ol>
      <p>承認されるまで、アプリ・SELF などのデータは表示されません。承認後に「状態を再確認」を押してください。</p>
    </StatusShell>
  );
}

export function SuspendedPage() {
  return (
    <StatusShell title="ご利用を停止しています">
      <p>このアカウントは現在利用停止中のため、データを表示できません。再開をご希望の場合は管理者にお問い合わせください。</p>
    </StatusShell>
  );
}

export function NoProfilePage() {
  return (
    <StatusShell title="アカウント情報を確認できません">
      <p>利用者情報を取得できませんでした。時間をおいて「状態を再確認」を押すか、管理者にお問い合わせください。</p>
    </StatusShell>
  );
}
