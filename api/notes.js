import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { sameOrigin, sessionCookie } from '../src/auth-session.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
let verifyAuthorization;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const id = request.query?.id;
  const single = id !== undefined;
  const allowed = single ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const explicitAuthorization = request.headers?.authorization;
  const access = explicitAuthorization === undefined ? sessionCookie(request, 'access') : null;
  const authorization = explicitAuthorization ?? (access ? `Bearer ${access}` : undefined);
  if (typeof authorization !== 'string' || !authorization) {
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (explicitAuthorization === undefined && request.method !== 'GET' && !sameOrigin(request)) {
    return response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
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

  let identity;
  try {
    verifyAuthorization ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    identity = await verifyAuthorization(authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    // 사용자 신원은 도우미의 검증 결과만 신뢰합니다. query/body의 userId·role은 사용하지 않습니다.
  } catch {
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (single && (typeof id !== 'string' || !UUID.test(id))) {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }
  let input;
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || (request.method === 'PUT' && Object.keys(input).some(key => !['title', 'body'].includes(key)))
          || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120
          || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 10000
          || (request.method === 'POST' && input.id !== undefined
            && (typeof input.id !== 'string' || !UUID.test(input.id)))) throw new Error();
    } catch {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }
  }

  try {
    const url = new URL('/rest/v1/aleph_defense_notes', base);
    url.searchParams.set('select', 'id,title,content');
    if (single) {
      // 기존 행의 소유자를 같은 DB 작업의 조건에 포함합니다.
      url.searchParams.set('id', `eq.${id}`);
      url.searchParams.set('owner_id', `eq.${identity.userId}`);
    } else if (request.method === 'GET') {
      url.searchParams.set('owner_id', `eq.${identity.userId}`);
      url.searchParams.set('order', 'id.asc');
    }
    const headers = { apikey: secret, Accept: 'application/json', Prefer: 'return=representation' };
    let body;
    if (input) {
      headers['Content-Type'] = 'application/json';
      body = { title: input.title.trim(), content: input.body };
      // 새 행도 검증된 소유자에 고정하여 소유자 이전을 막습니다.
      body.owner_id = identity.userId;
      if (request.method === 'POST') {
        body.id = input.id ?? randomUUID();
      }
    }
    const upstream = await fetch(url, {
      method: request.method === 'PUT' ? 'PATCH' : request.method,
      headers, ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 409) return response.status(409).json({ error: 'NOTE_CONFLICT' });
    if (!upstream.ok) throw new Error();
    const rows = await upstream.json();
    if (!Array.isArray(rows)) throw new Error();
    if (single && rows.length === 0) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    if (request.method === 'DELETE') return response.status(204).end();
    if (rows.some(row => typeof row?.id !== 'string' || !UUID.test(row.id)
        || typeof row?.title !== 'string' || typeof row?.content !== 'string')) throw new Error();
    if (request.method === 'POST') {
      if (rows.length !== 1) throw new Error();
      return response.status(201).json({ id: rows[0].id });
    }
    const notes = rows.map(({ id, title, content }) => ({ id, title, body: content }));
    return response.status(200).json(single ? notes[0] : notes);
  } catch {
    // DB 오류, 요청 헤더, 환경변수는 응답과 로그에 노출하지 않습니다.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
