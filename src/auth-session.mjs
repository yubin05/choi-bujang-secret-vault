import { createHash, randomBytes } from 'node:crypto';
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

  let db;
  try { db = dataConfig(); } catch { return { status: 503, error: 'NOTES_NOT_CONFIGURED' }; }
  const { base, secret } = db;

  let identity;
  try {
    verifyAuthorization ??= createLoginVerifier({ config: authConfig, supabaseSecretKey: secret });
    identity = await verifyAuthorization(authorization);
  } catch {
    return { status: 401, error: 'UNAUTHORIZED' };
  }
  if (!identity) return { status: 401, error: 'UNAUTHORIZED' };
  // 학생 로그인은 서버가 승인한 기기에서만 자료를 엽니다. 심판 토큰의 기기 확인은 운영 엔진·판정기가 맡습니다(docs/DECIDER_REQUEST.md).
  if (identity.kind === 'student') {
    try {
      if ((await deviceStatus(request, identity.userId, db)).deviceApproval !== 'approved') {
        return { status: 403, error: 'DEVICE_NOT_APPROVED' };
      }
    } catch {
      return { status: 503, error: 'DEVICE_CHECK_UNAVAILABLE' };
    }
  }
  return { identity, base, secret };
}

// 서버 전용 DB 접속 정보입니다. 형식이 맞지 않으면 예외를 던집니다.
export function dataConfig() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  const base = new URL(process.env.SUPABASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
      || base.search || base.hash || !secret?.startsWith('sb_secret_')
      || `${base.origin}/auth/v1` !== authConfig.identityProvider?.issuer) throw new Error('NOT_CONFIGURED');
  return { base, secret };
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

// 기기 ID는 서버가 HttpOnly 쿠키로 준 무작위 값입니다. 개인키가 아니며 화면 스크립트가 읽을 수 없고, DB에는 해시만 둡니다.
const DEVICE_ID = /^[A-Za-z0-9_-]{43}$/u;
const sha256 = value => createHash('sha256').update(value).digest('hex');

// 기기 승인 표를 서버 키로 읽거나 '대기' 행을 추가합니다. 서버 키에는 승인(UPDATE) 권한이 없습니다(sql/step11-device-approvals.sql).
async function deviceTable({ base, secret }, params, row) {
  const url = new URL('/rest/v1/aleph_defense_devices', base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const upstream = await fetch(url, {
    method: row ? 'POST' : 'GET',
    headers: { apikey: secret, Accept: 'application/json',
      ...(row ? { 'Content-Type': 'application/json', Prefer: 'return=minimal' } : {}) },
    ...(row ? { body: JSON.stringify(row) } : {}),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (row && upstream.status === 409) return null;
  if (!upstream.ok) throw new Error('DEVICE_UNAVAILABLE');
  return row ? [] : upstream.json();
}

// 승인 여부는 DB의 approved_at으로만 정합니다. 쿠키·요청 본문·화면 상태는 승인 근거가 아닙니다.
export async function deviceStatus(request, userId, db, id = sessionCookie(request, 'device')) {
  if (!DEVICE_ID.test(id ?? '')) return { deviceApproval: 'none' };
  const rows = await deviceTable(db, { select: 'code,approved_at', owner_id: `eq.${userId}`, device_hash: `eq.${sha256(id)}` });
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('DEVICE_UNAVAILABLE');
  if (rows.length === 0) return { deviceApproval: 'none' };
  return rows[0].approved_at ? { deviceApproval: 'approved' } : { deviceApproval: 'pending', deviceCode: rows[0].code };
}

// 승인 요청은 '대기' 행과 확인 코드만 만듭니다. 승인은 학생이 SQL Editor에서 화면의 코드를 대조해 직접 합니다.
export async function requestDevice(request, response, userId, db) {
  let id = sessionCookie(request, 'device');
  if (!DEVICE_ID.test(id ?? '')) {
    id = randomBytes(32).toString('base64url');
    const previous = response.getHeader?.('Set-Cookie') ?? [];
    response.setHeader('Set-Cookie', [...[previous].flat(),
      `__Host-aleph-device=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000`]);
  }
  const current = await deviceStatus(request, userId, db, id);
  if (current.deviceApproval !== 'none') return current;
  const deviceCode = randomBytes(4).toString('hex').toUpperCase();
  const added = await deviceTable(db, {}, { owner_id: userId, device_hash: sha256(id), code: deviceCode });
  // 두 번 눌러 이미 행이 생겼으면 그 상태를 그대로 돌려줍니다.
  return added ? { deviceApproval: 'pending', deviceCode } : deviceStatus(request, userId, db, id);
}
