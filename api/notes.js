import { createHash, randomUUID } from 'node:crypto';
import { authenticateDataRequest, denied, logDenied } from '../src/auth-session.mjs';
import { RESOURCE_IDS } from '../src/resources.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// POST /api/notes/:id/restore: 비공개 사본 표(서버 키로만 읽힘)에 있는 본인 메모 한 건만 되살립니다.
// 사본의 ID·소유자·내용 해시를 먼저 대조하고, 쓴 뒤 다시 읽어 같은지 확인합니다. 다른 메모와 사본 표는 바꾸지 않습니다.
async function restoreNote(response, id, { identity, base, secret }) {
  const owner = identity.userId;
  const rest = async (table, params, method = 'GET', body) => {
    const url = new URL(`/rest/v1/${table}`, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const upstream = await fetch(url, {
      method,
      headers: { apikey: secret, Accept: 'application/json', Prefer: 'return=representation',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 409) return null;
    if (!upstream.ok) throw new Error();
    const rows = await upstream.json();
    if (!Array.isArray(rows)) throw new Error();
    return rows;
  };
  try {
    const copies = (await rest('aleph_defense_notes_backup',
      { select: 'id,owner_id,title,content,content_sha256', id: `eq.${id}`, owner_id: `eq.${owner}` }))
      .filter(row => row?.id === id && row?.owner_id === owner);
    // 사본이 없거나 남의 사본이면 일반 메모와 같은 404로 답해 존재 여부를 알려 주지 않습니다.
    if (copies.length !== 1) return denied(response, RESOURCE_IDS.notes, 404, 'NOTE_NOT_FOUND', 'NOT_IN_BACKUP');
    const [copy] = copies;
    if (typeof copy.title !== 'string' || typeof copy.content !== 'string' || sha256(copy.content) !== copy.content_sha256) {
      return denied(response, RESOURCE_IDS.notes, 409, 'BACKUP_HASH_MISMATCH');
    }
    // 같은 ID를 다른 사용자의 메모가 쓰고 있으면 덮어쓰지 않습니다.
    const current = await rest('aleph_defense_notes', { select: 'id,owner_id', id: `eq.${id}` });
    if (current.some(row => row?.owner_id !== owner)) {
      return denied(response, RESOURCE_IDS.notes, 409, 'NOTE_CONFLICT', 'ID_OWNED_BY_OTHER');
    }
    const values = { title: copy.title, content: copy.content, owner_id: owner };
    const written = current.length
      ? await rest('aleph_defense_notes', { select: 'id', id: `eq.${id}`, owner_id: `eq.${owner}` }, 'PATCH', values)
      : await rest('aleph_defense_notes', { select: 'id' }, 'POST', { id, ...values });
    if (written === null) return denied(response, RESOURCE_IDS.notes, 409, 'NOTE_CONFLICT', 'ID_OWNED_BY_OTHER');
    const [restored] = await rest('aleph_defense_notes',
      { select: 'id,title,content,owner_id', id: `eq.${id}`, owner_id: `eq.${owner}` });
    const contentSha256 = typeof restored?.content === 'string' ? sha256(restored.content) : null;
    if (restored?.id !== id || restored.owner_id !== owner || restored.title !== copy.title
        || contentSha256 !== copy.content_sha256) throw new Error();
    // 감사 기록: 메모 ID와 내용 해시만 남깁니다. 사용자 ID·토큰·본문은 기록하지 않습니다.
    console.info(`aleph.restored resource=${RESOURCE_IDS.notes} note=${id} sha256=${contentSha256}`);
    return response.status(200).json({ id, ownerMatches: true, contentSha256 });
  } catch {
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  // 이 함수의 모든 요청은 내 메모 자원입니다. 강사 공지(notices.instructor)와 섞지 않습니다.
  response.setHeader('X-Resource-Id', RESOURCE_IDS.notes);
  const id = request.query?.id;
  const single = id !== undefined;
  const restore = single && request.query?.restore === '1';
  const allowed = restore ? ['POST'] : single ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
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
  if (restore) return restoreNote(response, id, auth);
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
