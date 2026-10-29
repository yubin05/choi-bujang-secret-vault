import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import handler from '../api/notes.js';

test('A/B의 본인 CRUD는 유지하고 타인 접근·소유자 변경·위조 토큰을 거부한다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
  const routing = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  assert.ok(routing.rewrites.some(route => route.source === '/api/notes/:id'
    && route.destination === '/api/notes?id=:id'));
  assert.deepEqual(config.allowedRoutes.map(route => `${route.method} ${route.pathPattern}`).sort(), [
    'GET /api/notes', 'POST /api/notes', 'GET /api/notes/:id', 'PUT /api/notes/:id', 'DELETE /api/notes/:id',
  ].sort());
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const fakeSecret = 'sb_secret_' + 'test-only-sentinel';
  const pair = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-signing-key', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.identityProvider.issuer, aud: 'authenticated',
    sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', iat: now, exp: now + 300 };
  // 테스트 전용 임시 키와 토큰은 메모리에서만 사용하며 실제 계정·키를 사용하지 않습니다.
  const valid = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const bId = '55555555-5555-4555-8555-555555555555';
  const validB = await new SignJWT({ ...claims, sub: bId })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const expired = await new SignJWT({ ...claims, exp: now - 60 }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const wrongIssuer = await new SignJWT({ ...claims, iss: 'https://other.supabase.co/auth/v1' })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const otherPair = await generateKeyPair('ES256');
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(otherPair.privateKey);
  let databaseReads = 0;
  let databaseFailure = false;
  const store = new Map(Array.from({ length: 4 }, (_, i) => {
    const id = `22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`;
    return [id, { id, title: `가상 ${i + 1}`, content: `테스트 ${i + 1}`,
      owner_id: claims.sub, extra: fakeSecret }];
  }));
  const call = async (authorization, method = 'GET', body, id, extraHeaders = {}) => {
    const result = { headers: {} };
    await handler({ method, headers: { ...(authorization ? { authorization } : {}), ...extraHeaders },
      query: { owner_id: claims.sub, userId: claims.sub, role: 'authenticated', ...(id !== undefined ? { id } : {}) },
      body: body ?? { userId: claims.sub, role: 'admin' } }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return {
        json: body => { result.body = body; }, end: () => { result.body = null; },
      }; },
    });
    assert.ok(!JSON.stringify(result).includes(fakeSecret));
    assert.equal(result.headers['Cache-Control'], 'no-store');
    return result;
  };
  try {
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    globalThis.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
      assert.equal(url.origin, process.env.SUPABASE_URL);
      assert.equal(url.pathname, '/rest/v1/aleph_defense_notes');
      databaseReads++;
      assert.equal(url.searchParams.get('select'), 'id,title,content');
      assert.equal(options.headers.apikey, fakeSecret);
      if (databaseFailure) throw new Error(fakeSecret);
      const id = url.searchParams.get('id')?.slice(3);
      const owner = url.searchParams.get('owner_id')?.slice(3);
      if (options.method !== 'POST') assert.ok([claims.sub, bId].includes(owner));
      if (options.method === 'POST') {
        const row = JSON.parse(options.body);
        assert.ok([claims.sub, bId].includes(row.owner_id));
        if (store.has(row.id)) return Response.json({}, { status: 409 });
        store.set(row.id, row);
        return Response.json([row]);
      }
      if (options.method === 'PATCH') {
        const row = store.get(id);
        if (!row || row.owner_id !== owner) return Response.json([]);
        const changes = JSON.parse(options.body);
        assert.deepEqual(Object.keys(changes).sort(), ['content', 'owner_id', 'title']);
        assert.equal(changes.owner_id, row.owner_id);
        Object.assign(row, changes);
        return Response.json([row]);
      }
      if (options.method === 'DELETE') {
        const row = store.get(id);
        if (!row || row.owner_id !== owner) return Response.json([]);
        store.delete(id);
        return Response.json(row ? [row] : []);
      }
      if (id) {
        const row = store.get(id);
        return Response.json(row && row.owner_id === owner ? [row] : []);
      }
      return Response.json([...store.values()].filter(row => row.owner_id === owner));
    };
    for (const authorization of [undefined, 'Bearer invalid', `Bearer ${forged}`, `Bearer ${expired}`, `Bearer ${wrongIssuer}`]) {
      const result = await call(authorization);
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
      assert.equal(databaseReads, 0);
    }
    const explicitId = '33333333-3333-4333-8333-333333333333';
    for (const [method, id] of [['POST', undefined], ['GET', explicitId], ['PUT', explicitId], ['DELETE', explicitId]]) {
      assert.equal((await call(undefined, method, { title: '가상', body: '테스트' }, id)).status, 401);
      assert.equal(databaseReads, 0);
    }
    const result = await call(`Bearer ${valid}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 4);
    assert.deepEqual(Object.keys(result.body[0]), ['id', 'title', 'body']);
    assert.equal(databaseReads, 1);
    const cookie = `__Host-aleph-access=${encodeURIComponent(valid)}`;
    assert.equal((await call(undefined, 'GET', undefined, undefined, { cookie })).status, 200);
    const beforeCsrf = databaseReads;
    assert.equal((await call(undefined, 'POST', { title: '가상', body: '시험' }, undefined,
      { cookie, origin: 'https://other.example' })).status, 403);
    assert.equal((await call('Bearer invalid', 'GET', undefined, undefined, { cookie })).status, 401);
    assert.equal((await call(undefined, 'GET', undefined, undefined, { cookie: `${cookie}; ${cookie}` })).status, 401);
    assert.equal(databaseReads, beforeCsrf);
    const cookieCreated = await call(undefined, 'POST', { title: '쿠키 시험', body: '가상 시험' }, undefined,
      { cookie, origin: new URL(config.publicAppUrl).origin });
    assert.equal(cookieCreated.status, 201);
    assert.equal(store.get(cookieCreated.body.id).owner_id, claims.sub);
    assert.equal((await call(undefined, 'DELETE', undefined, cookieCreated.body.id,
      { cookie, origin: new URL(config.publicAppUrl).origin })).status, 204);
    const token = `Bearer ${valid}`;
    const created = await call(token, 'POST', { title: '가상 추가', body: '가상 본문', owner_id: 'untrusted-user', role: 'admin' });
    assert.equal(created.status, 201);
    assert.match(created.body.id, /^[a-f0-9-]{36}$/u);
    const id = created.body.id;
    assert.equal(store.get(id).owner_id, claims.sub);
    assert.deepEqual((await call(token, 'GET', undefined, id)).body, { id, title: '가상 추가', body: '가상 본문' });
    const beforeOwnerChange = databaseReads;
    const transfer = await call(token, 'PUT', { title: '수정', body: '수정 본문', owner_id: bId }, id);
    assert.equal(transfer.status, 400);
    assert.equal(databaseReads, beforeOwnerChange);
    assert.equal(store.get(id).owner_id, claims.sub);
    const edited = await call(token, 'PUT', { title: '수정', body: '수정 본문' }, id);
    assert.equal(edited.status, 200);
    assert.equal(edited.body.body, '수정 본문');
    assert.equal(store.get(id).owner_id, claims.sub);
    assert.equal((await call(token, 'DELETE', undefined, id)).status, 204);
    assert.equal((await call(token, 'GET', undefined, id)).status, 404);
    assert.equal((await call(token, 'POST', { id: explicitId, title: '지정 ID', body: '가상' })).body.id, explicitId);
    assert.equal((await call(token, 'POST', { id: explicitId, title: '중복', body: '가상' })).status, 409);
    assert.equal((await call(token, 'POST', { id: 'bad-id', title: '가상', body: '가상' })).status, 400);
    assert.equal((await call(token, 'PUT', { title: '', body: '가상' }, explicitId)).status, 400);
    assert.equal((await call(token, 'GET', undefined, 'bad-id')).status, 400);
    const unowned = '44444444-4444-4444-8444-444444444444';
    store.set(unowned, { id: unowned, title: '기존', content: '가상', owner_id: null });
    assert.ok(!(await call(token)).body.some(note => note.id === unowned));
    const bToken = `Bearer ${validB}`;
    const bCreated = await call(bToken, 'POST', { title: 'B 시험', body: 'B 가상', owner_id: claims.sub });
    assert.equal(bCreated.status, 201);
    const bNoteId = bCreated.body.id;
    assert.equal(store.get(bNoteId).owner_id, bId);
    const aNoteId = explicitId;
    const beforeCrossAccess = JSON.stringify([...store]);
    for (const [actor, target] of [[token, bNoteId], [bToken, aNoteId]]) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const result = await call(actor, method, { title: '변경 시도', body: '가상' }, target);
        assert.equal(result.status, 404);
        assert.deepEqual(result.body, { error: 'NOTE_NOT_FOUND' });
      }
    }
    assert.equal(JSON.stringify([...store]), beforeCrossAccess);
    assert.ok(!(await call(token)).body.some(note => note.id === bNoteId));
    assert.deepEqual((await call(bToken)).body.map(note => note.id), [bNoteId]);
    assert.equal((await call(bToken, 'GET', undefined, bNoteId)).status, 200);
    assert.equal((await call(bToken, 'PUT', { title: 'B 수정', body: 'B 수정 본문' }, bNoteId)).status, 200);
    const beforeBTransfer = databaseReads;
    assert.equal((await call(bToken, 'PUT', { title: '이전', body: '가상', owner_id: claims.sub }, bNoteId)).status, 400);
    assert.equal(databaseReads, beforeBTransfer);
    assert.equal(store.get(bNoteId).owner_id, bId);
    assert.equal((await call(bToken, 'DELETE', undefined, bNoteId)).status, 204);
    assert.equal((await call(bToken, 'GET', undefined, bNoteId)).status, 404);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await call(token, method, { title: '가상', body: '가상' }, unowned)).status, 404);
    }
    databaseFailure = true;
    assert.equal((await call(`Bearer ${valid}`)).status, 502);
    assert.equal((await call(undefined, 'PATCH')).status, 405);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
