// T21 補助: ビルド成果物 dist/ に秘密鍵らしき文字列が含まれていないかを検査する
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'Supabase secret key'],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google OAuth client secret'],
  [/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|GOOGLE_CLIENT_SECRET/, '秘密用の環境変数名'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '秘密鍵 PEM'],
  [/postgres(ql)?:\/\/[^\s"']+:[^\s"']+@/, 'DB 接続文字列（パスワード付き）'],
];

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let bad = 0;
for (const file of walk('dist')) {
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`NG: ${file} に ${label} が含まれています`);
      bad++;
    }
  }
  // JWT 形式の値があれば role を確認
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString());
      if (payload.role && payload.role !== 'anon') {
        console.error(`NG: ${file} に role=${payload.role} の JWT が含まれています`);
        bad++;
      }
    } catch {}
  }
  if (file.endsWith('.map')) {
    console.error(`NG: ソースマップ ${file} が配布物に含まれています`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('OK: dist/ に秘密鍵・service_role・ソースマップは見つかりませんでした');
