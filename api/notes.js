import { randomUUID } from 'node:crypto';
import { authenticateDataRequest, denied, logDenied } from '../src/auth-session.mjs';
import { RESOURCE_IDS } from '../src/resources.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  // 이 함수의 모든 요청은 내 메모 자원입니다. 강사 공지(notices.instructor)와 섞지 않습니다.
  response.setHeader('X-Resource-Id', RESOURCE_IDS.notes);
  const id = request.query?.id;
  const single = id !== undefined;
  const allowed = single ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return denied(response, RESOURCE_IDS.notes, 405, 'METHOD_NOT_ALLOWED');
  }

  const auth = await authenticateDataRequest(request);
  if (auth.error) return denied(response, RESOURCE_IDS.notes, auth.status, auth.error);
  const { identity, base, secret } = auth;

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
    url.searchParams.set('select', 'id,title,content,owner_id');
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
    // 저장된 소유자를 검증된 사용자와 다시 대조합니다. DB 조건이 빠져도 남의 행·주인 없는 행은 응답에 넣지 않습니다.
    // 쓰기의 1차 방어는 위 DB 요청의 owner_id 조건입니다.
    const owned = rows.filter(row => row?.owner_id === identity.userId);
    if (owned.length !== rows.length) logDenied(RESOURCE_IDS.notes, 'OWNER_MISMATCH');
    if (single && owned.length === 0) {
      // 남의 메모와 없는 메모는 응답을 같게 두어 존재 여부를 알려 주지 않습니다.
      return denied(response, RESOURCE_IDS.notes, 404, 'NOTE_NOT_FOUND', 'NOT_OWNER_OR_MISSING');
    }
    if (request.method === 'DELETE') return response.status(204).end();
    if (owned.some(row => typeof row?.id !== 'string' || !UUID.test(row.id)
        || typeof row?.title !== 'string' || typeof row?.content !== 'string')) throw new Error();
    if (request.method === 'POST') {
      if (owned.length !== 1) throw new Error();
      return response.status(201).json({ id: owned[0].id });
    }
    const notes = owned.map(({ id, title, content }) => ({ id, title, body: content }));
    return response.status(200).json(single ? notes[0] : notes);
  } catch {
    // DB 오류, 요청 헤더, 환경변수는 응답과 로그에 노출하지 않습니다.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
