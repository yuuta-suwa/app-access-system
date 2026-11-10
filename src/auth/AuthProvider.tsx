import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getMyAccess, type MyAccess } from '../lib/api';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signedOut'; message?: string }
  | { kind: 'signedIn'; session: Session; access: MyAccess | null; epoch: number };

interface AuthContextValue {
  state: AuthState;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function accessKey(a: MyAccess | null): string {
  if (!a) return 'none';
  return `${a.user_id}|${a.status}|${a.roles.join(',')}|${a.category_ids.join(',')}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' });
  const lastKey = useRef<string>('');
  const lastUser = useRef<string | null>(null);

  const load = useCallback(async (session: Session | null, reason?: string) => {
    if (!session) {
      lastKey.current = '';
      lastUser.current = null;
      setState({ kind: 'signedOut', message: reason });
      return;
    }
    let access: MyAccess | null = null;
    try {
      access = await getMyAccess();
    } catch {
      access = null;
    }
    const key = accessKey(access);
    setState((prev) => {
      const sameUser = lastUser.current === session.user.id;
      const changed = key !== lastKey.current;
      lastKey.current = key;
      lastUser.current = session.user.id;
      const prevEpoch = prev.kind === 'signedIn' ? prev.epoch : 0;
      // 利用者や権限が変わったら epoch を進めて画面ツリーを作り直す（一覧・検索・保存キャッシュを破棄）
      const epoch = !sameUser || changed ? prevEpoch + 1 : prevEpoch;
      return { kind: 'signedIn', session, access, epoch };
    });
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error_description') || params.get('error');

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void load(data.session, oauthError ? `ログインに失敗しました：${oauthError}` : undefined);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        void load(null, lastUser.current ? 'ログアウトしました、またはセッションの有効期限が切れました。' : undefined);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // コールバック内で await しない（supabase-js のデッドロック回避）
        setTimeout(() => void load(session), 0);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const refreshAccess = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session, data.session ? undefined : 'セッションの有効期限が切れました。再度ログインしてください。');
  }, [load]);

  // 画面復帰・定期的に DB の現在の権限を再取得（権限撤回・停止を反映）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshAccess();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(() => void refreshAccess(), 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshAccess]);

  const signInWithGoogle = useCallback(async () => {
    // 追加の Google API スコープは要求しない（Supabase Auth 既定の openid / email / profile のみ）
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setState({ kind: 'signedOut', message: `ログインを開始できませんでした：${error.message}` });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' });
    // メモリ上の状態を完全に破棄するためフルリロード
    window.location.replace('/');
  }, []);

  return (
    <AuthContext.Provider value={{ state, signInWithGoogle, signOut, refreshAccess }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

export function useAccess(): MyAccess {
  const { state } = useAuth();
  if (state.kind !== 'signedIn' || !state.access) throw new Error('not active');
  return state.access;
}
