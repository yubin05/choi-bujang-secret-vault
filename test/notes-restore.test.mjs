import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import handler from '../api/notes.js';

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

test('B의 사본 메모 한 건만 ID·소유자·내용 해시를 대조해 되살리고 다른 메모와 사본은 그대로 둡니다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
  const routing = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  assert.deepEqual(routing.rewrites[0], { source: '/api/notes/:id/restore', destination: '/api/notes?id=:id&restore=1' });
  const originalFetch = globalThis.fetch;
  const originalLog = { warn: console.warn, info: console.info };
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const fakeSecret = 'sb_secret_' + 'restore-test-sentinel';
  // 테스트 전용 임시 키·토큰·가상 메모만 메모리에서 씁니다.
  const pair = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'restore-test-key', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const aId = '11111111-1111-4111-8111-111111111111';
  const bId = '55555555-5555-4555-8555-555555555555';
  const sign = sub => new SignJWT({ iss: config.identityProvider.issuer, aud: 'authenticated', sub,
    role: 'authenticated', iat: now, exp: now + 300 }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const aToken = await sign(aId);
  const bToken = await sign(bId);
  const target = '77777777-7777-4777-8777-777777777777';
  const bOther = '77777777-7777-4777-8777-000000000002';
  const aNote = '22222222-2222-4222-8222-000000000001';
  const original = { title: 'B 공개 시험 메모', content: 'B 가상 본문' };
  const backup = new Map([[target, { id: target, owner_id: bId, ...original, content_sha256: sha256(original.content) }]]);
  const backupBefore = JSON.stringify([...backup]);
  const notes = new Map([
    [aNote, { id: aNote, owner_id: aId, title: 'A 가상', content: 'A 가상 본문' }],
    [bOther, { id: bOther, owner_id: bId, title: 'B 다른 메모', content: 'B 다른 본문' }],
  ]);
  const others = () => JSON.stringify([notes.get(aNote), notes.get(bOther)]);
  const othersBefore = others();
  let databaseCalls = 0;
  const logs = [];
  const call = async (authorization, method = 'POST', id = target, extraHeaders = {}) => {
    const result = { headers: {} };
    await handler({ method, headers: { cookie: `__Host-aleph-device=${'a'.repeat(43)}`,
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), ...extraHeaders },
      query: { id, restore: '1', owner_id: bId }, body: { owner_id: aId, title: '위조', body: '위조' } }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return { json: body => { result.body = body; }, end: () => {} }; },
    });
    assert.equal(result.headers['X-Resource-Id'], 'notes.own');
    return result;
  };
  try {
    console.warn = message => logs.push(String(message));
    console.info = message => logs.push(String(message));
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    globalThis.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
      assert.equal(options.headers.apikey, fakeSecret);
      // 복원도 승인된 기기에서만 합니다. 이 시험의 기기는 승인된 상태입니다.
      if (url.pathname === '/rest/v1/aleph_defense_devices') return Response.json([{ code: 'APPROVED', approved_at: '2026-11-12T00:00:00Z' }]);
      databaseCalls++;
      const table = url.pathname.replace('/rest/v1/', '');
      const store = { aleph_defense_notes_backup: backup, aleph_defense_notes: notes }[table];
      assert.ok(store, table);
      const id = url.searchParams.get('id')?.slice(3);
      const owner = url.searchParams.get('owner_id')?.slice(3);
      if (options.method === 'GET') {
        return Response.json([...store.values()].filter(row => (!id || row.id === id) && (!owner || row.owner_id === owner)));
      }
      assert.equal(store, notes, '사본 표는 읽기만 합니다');
      if (options.method === 'POST') {
        const row = JSON.parse(options.body);
        if (store.has(row.id)) return Response.json({}, { status: 409 });
        store.set(row.id, row);
        return Response.json([row]);
      }
      assert.equal(options.method, 'PATCH');
      const row = store.get(id);
      if (!row || row.owner_id !== owner) return Response.json([]);
      Object.assign(row, JSON.parse(options.body));
      return Response.json([row]);
    };

    assert.equal((await call(undefined)).status, 401);
    assert.equal((await call(undefined, 'POST', target, { cookie: `__Host-aleph-access=${bToken}`,
      origin: 'https://other.example' })).status, 403);
    assert.equal((await call(bToken, 'GET')).status, 405);
    assert.equal((await call(bToken, 'POST', 'bad-id')).status, 400);
    assert.equal(databaseCalls, 0);

    // A는 B의 사본을 되살릴 수 없고, B는 사본에 없는 메모를 되살릴 수 없습니다.
    for (const [token, id] of [[aToken, target], [bToken, bOther], [bToken, aNote]]) {
      assert.deepEqual([(await call(token, 'POST', id)).status, notes.has(target)], [404, false]);
    }

    // 삭제된 대상 한 건을 되살립니다.
    const restored = await call(bToken);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body, { id: target, ownerMatches: true, contentSha256: backup.get(target).content_sha256 });
    assert.deepEqual(notes.get(target), { id: target, owner_id: bId, ...original });

    // 내용이 바뀐 대상도 사본 내용으로 되돌립니다.
    notes.get(target).content = '침공으로 바뀐 가상 본문';
    assert.equal((await call(bToken)).status, 200);
    assert.equal(sha256(notes.get(target).content), backup.get(target).content_sha256);
    assert.equal(others(), othersBefore);
    assert.equal(JSON.stringify([...backup]), backupBefore);

    // 같은 ID를 A의 메모가 차지하면 덮어쓰지 않습니다.
    notes.set(target, { id: target, owner_id: aId, title: 'A 선점', content: 'A 선점 본문' });
    const squatted = await call(bToken);
    assert.deepEqual([squatted.status, squatted.body], [409, { error: 'NOTE_CONFLICT' }]);
    assert.equal(notes.get(target).owner_id, aId);
    notes.delete(target);

    // 사본의 내용 해시가 맞지 않으면 쓰지 않습니다.
    backup.get(target).content = '사본 위조';
    const tampered = await call(bToken);
    assert.deepEqual([tampered.status, tampered.body], [409, { error: 'BACKUP_HASH_MISMATCH' }]);
    assert.equal(notes.has(target), false);
    assert.equal(others(), othersBefore);

    assert.equal(logs.filter(line => line === `aleph.restored resource=notes.own note=${target} sha256=${sha256(original.content)}`).length, 2);
    for (const reason of ['NOT_IN_BACKUP', 'ID_OWNED_BY_OTHER', 'BACKUP_HASH_MISMATCH']) {
      assert.ok(logs.includes(`aleph.denied resource=notes.own reason=${reason}`), reason);
    }
    assert.ok(logs.every(line => ![aId, bId, aToken, bToken, fakeSecret, original.content].some(value => line.includes(value))));
  } finally {
    Object.assign(console, originalLog);
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
