import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const authConfig = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
export const sameOrigin = request => request.headers?.origin === new URL(authConfig.publicAppUrl).origin;

export function authClient() {
  const url = new URL(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash || !key?.startsWith('sb_publishable_')
      || `${url.origin}/auth/v1` !== authConfig.identityProvider.issuer) throw new Error('AUTH_NOT_CONFIGURED');
  return createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options) => fetch(input, { ...options,
      redirect: 'error', signal: AbortSignal.timeout(10000) }) },
  });
}

export function sessionCookie(request, name) {
  const matches = (request.headers?.cookie ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(`__Host-aleph-${name}=`));
  if (matches.length !== 1) return null;
  try {
    const value = decodeURIComponent(matches[0].slice(matches[0].indexOf('=') + 1));
    return value && value.length <= 8192 && !/[\s;\x00-\x1f]/u.test(value) ? value : null;
  } catch { return null; }
}

export function setSessionCookies(response, session) {
  const attributes = '; Path=/; HttpOnly; Secure; SameSite=Lax';
  response.setHeader('Set-Cookie', ['access', 'refresh'].map(name =>
    `__Host-aleph-${name}=${session ? encodeURIComponent(session[`${name}_token`]) : ''}${attributes}${session ? '' : '; Max-Age=0'}`));
}
