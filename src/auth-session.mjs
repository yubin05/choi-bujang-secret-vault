import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from './verify-login.mjs';

export const authConfig = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
export const sameOrigin = request => request.headers?.origin === new URL(authConfig.publicAppUrl).origin;
let verifyAuthorization;

// 거부 사유를 짧게 남깁니다. 토큰·사용자 ID·요청 본문은 기록하지 않습니다.
export const logDenied = (resource, reason) => console.warn(`aleph.denied resource=${resource} reason=${reason}`);
export function denied(response, resource, status, error, reason = error) {
  logDenied(resource, reason);
  return response.status(status).json({ error });
}

// 자료 API(메모·공지) 공통 로그인 확인입니다. 실패는 { status, error }, 성공은 검증된 신원과 DB 접속 정보를 돌려줍니다.
// 사용자 신원은 도우미의 검증 결과만 신뢰합니다. query/body의 userId·role은 사용하지 않습니다.
export async function authenticateDataRequest(request) {
  const explicitAuthorization = request.headers?.authorization;
  const access = explicitAuthorization === undefined ? sessionCookie(request, 'access') : null;
  const authorization = explicitAuthorization ?? (access ? `Bearer ${access}` : undefined);
  if (typeof authorization !== 'string' || !authorization) return { status: 401, error: 'UNAUTHORIZED' };
  if (explicitAuthorization === undefined && request.method !== 'GET' && !sameOrigin(request)) {
    return { status: 403, error: 'ORIGIN_NOT_ALLOWED' };
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  let base;
  try {
    base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
        || base.search || base.hash || !secret?.startsWith('sb_secret_')
        || `${base.origin}/auth/v1` !== authConfig.identityProvider?.issuer) throw new Error();
  } catch {
    return { status: 503, error: 'NOTES_NOT_CONFIGURED' };
  }

  try {
    verifyAuthorization ??= createLoginVerifier({ config: authConfig, supabaseSecretKey: secret });
    const identity = await verifyAuthorization(authorization);
    return identity ? { identity, base, secret } : { status: 401, error: 'UNAUTHORIZED' };
  } catch {
    return { status: 401, error: 'UNAUTHORIZED' };
  }
}

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
