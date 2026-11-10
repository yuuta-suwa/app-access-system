// URL 安全性（SELF-08 / T17）。DB の CHECK 制約と同じ規則をクライアントでも事前検証する。

export type UrlCheck =
  | { ok: true; url: string; warnings: string[] }
  | { ok: false; error: string };

const SECRET_PARAM = /^(token|access_token|id_token|refresh_token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|auth|session|sessionid|code|x-amz-signature|x-goog-signature)$/i;

export function checkUrl(raw: string): UrlCheck {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'URL を入力してください。' };
  if (input.length > 2048) return { ok: false, error: 'URL が長すぎます（2048 文字まで）。' };
  if (/[\s<>"]/.test(input)) return { ok: false, error: 'URL に空白や使用できない文字が含まれています。' };
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, error: 'URL の形式が正しくありません。https:// から入力してください。' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'https:// で始まる URL のみ登録できます（javascript: / data: / file: / http: などは不可）。' };
  }
  if (!input.toLowerCase().startsWith('https://')) {
    return { ok: false, error: 'https:// で始まる URL のみ登録できます。' };
  }
  const warnings: string[] = [];
  if (u.username || u.password) warnings.push('URL にユーザー名・パスワードが含まれています。');
  for (const [k] of u.searchParams) {
    if (SECRET_PARAM.test(k)) {
      warnings.push(`URL に秘密情報の可能性があるパラメータ「${k}」が含まれています。`);
    }
  }
  if (u.hash && /(access_token|id_token|token)=/i.test(u.hash)) {
    warnings.push('URL のフラグメントにトークンが含まれている可能性があります。');
  }
  return { ok: true, url: input, warnings };
}

/** 外部アプリは iframe 埋め込みせず、別タブ・opener なしで開く */
export function openExternal(url: string): void {
  const c = checkUrl(url);
  if (!c.ok) return;
  const w = window.open(c.url, '_blank', 'noopener,noreferrer');
  if (w) w.opener = null;
}
