import { describe, expect, it } from 'vitest';
import { checkUrl } from './url';
import { isSecretKey } from './supabase';

describe('checkUrl (T17 / SELF-08)', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'http://example.com',
    'vbscript:msgbox',
    'ftp://example.com',
    '//example.com',
    'example.com',
    'https://exa mple.com',
  ])('rejects %s', (u) => {
    expect(checkUrl(u).ok).toBe(false);
  });

  it('accepts https', () => {
    const r = checkUrl('https://example.com/path?q=1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('warns on secret-looking params', () => {
    const r = checkUrl('https://example.com/?token=abc&api_key=x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(2);
  });

  it('warns on credentials in URL', () => {
    const r = checkUrl('https://user:pass@example.com/');
    expect(r.ok && r.warnings.length > 0).toBe(true);
  });
});

describe('isSecretKey (T21)', () => {
  it('detects sb_secret_ keys', () => expect(isSecretKey('sb_secret_abc')).toBe(true));
  it('allows publishable keys', () => expect(isSecretKey('sb_publishable_abc')).toBe(false));
  it('detects service_role JWT', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }));
    expect(isSecretKey(`x.${payload}.y`)).toBe(true);
  });
  it('allows anon JWT', () => {
    const payload = btoa(JSON.stringify({ role: 'anon' }));
    expect(isSecretKey(`x.${payload}.y`)).toBe(false);
  });
});
