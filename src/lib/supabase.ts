import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configError: string | null = (() => {
  if (!url || !key) return 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が設定されていません。';
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    return 'VITE_SUPABASE_URL は https:// で指定してください。';
  }
  if (isSecretKey(key)) {
    return '安全のため起動を停止しました：ブラウザ用設定に Secret key / service_role key が指定されています。Publishable key に差し替えてください。';
  }
  return null;
})();

/** Secret key（sb_secret_）や service_role JWT がブラウザに配布されるのを防ぐ */
export function isSecretKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

// 認可済みデータをブラウザの HTTP キャッシュに残さない
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

export const supabase = createClient(url ?? 'http://localhost', configError ? 'invalid' : key!, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: noStoreFetch },
});
