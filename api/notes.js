import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
let verifyAuthorization;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  let base;
  try {
    base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
        || base.search || base.hash || !secret?.startsWith('sb_secret_')
        || `${base.origin}/auth/v1` !== config.identityProvider?.issuer) throw new Error();
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  try {
    verifyAuthorization ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    const identity = await verifyAuthorization(authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    // 사용자 신원은 도우미의 검증 결과만 신뢰합니다. query/body의 userId·role은 사용하지 않습니다.
  } catch {
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const url = new URL('/rest/v1/aleph_defense_notes', base);
    url.searchParams.set('select', 'title,content');
    url.searchParams.set('order', 'id.asc');
    const upstream = await fetch(url, {
      headers: { apikey: secret, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error();
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => typeof row?.title !== 'string'
        || typeof row?.content !== 'string')) throw new Error();
    return response.status(200).json({ notes: rows.map(({ title, content }) => ({ title, content })) });
  } catch {
    // DB 오류, 요청 헤더, 환경변수는 응답과 로그에 노출하지 않습니다.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
