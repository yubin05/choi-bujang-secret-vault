import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import noticesHandler from '../api/notices.js';
import notesHandler from '../api/notes.js';

test('메모와 강사 공지는 요청마다 서버가 정한 다른 자원 ID를 가진다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
  const pair = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-signing-key', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.identityProvider.issuer, aud: 'authenticated',
    sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated', iat: now, exp: now + 300 };
  // 테스트 전용 임시 키와 토큰은 메모리에서만 사용하며 실제 계정·키를 사용하지 않습니다.
  const valid = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .sign((await generateKeyPair('ES256')).privateKey);
  const call = async (handler, method, headers = {}, query = {}) => {
    const result = { headers: {} };
    await handler({ method, headers, query, body: { resource: 'notes.own', role: 'instructor' } }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return {
        json: body => { result.body = body; }, end: () => { result.body = null; },
      }; },
    });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    return result;
  };
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const logs = [];
  const originalWarn = console.warn;
  try {
    console.warn = message => logs.push(String(message));
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_' + 'test-only-sentinel';
    globalThis.fetch = async input => {
      const url = new URL(input instanceof Request ? input.url : input);
      // 공지는 메모 DB를 읽지 않고, 로그인한 기기의 승인 여부만 확인합니다.
      if (url.pathname === '/rest/v1/aleph_defense_devices') return Response.json([{ code: 'APPROVED', approved_at: '2026-11-12T00:00:00Z' }]);
      assert.equal(url.href, config.identityProvider.jwksUrl, '공지는 메모 DB에 요청하지 않습니다.');
      return Response.json({ keys: [jwk] });
    };

    // 같은 무로그인 요청이라도 서버 함수가 자원 ID를 정하고, query·body의 자원 이름은 무시합니다.
    const notesAnon = await call(notesHandler, 'GET', {}, { resource: 'notices.instructor' });
    const noticesAnon = await call(noticesHandler, 'GET', {}, { resource: 'notes.own' });
    assert.equal(notesAnon.headers['X-Resource-Id'], 'notes.own');
    assert.equal(noticesAnon.headers['X-Resource-Id'], 'notices.instructor');
    assert.deepEqual([notesAnon.status, noticesAnon.status], [401, 401]);
    assert.deepEqual(noticesAnon.body, { error: 'UNAUTHORIZED' });

    const forgedResult = await call(noticesHandler, 'GET', { authorization: `Bearer ${forged}` });
    assert.deepEqual([forgedResult.status, forgedResult.body], [401, { error: 'UNAUTHORIZED' }]);

    // 기기 쿠키가 없으면 로그인했어도 공지를 주지 않습니다.
    const locked = await call(noticesHandler, 'GET', { authorization: `Bearer ${valid}` });
    assert.deepEqual([locked.status, locked.body], [403, { error: 'DEVICE_NOT_APPROVED' }]);
    const device = `__Host-aleph-device=${'a'.repeat(43)}`;
    const read = await call(noticesHandler, 'GET', { authorization: `Bearer ${valid}`, cookie: device });
    assert.equal(read.status, 200);
    assert.equal(read.headers['X-Resource-Id'], 'notices.instructor');
    assert.ok(read.body.length > 0 && read.body.every(item =>
      Object.keys(item).sort().join(',') === 'body,id,title'));

    // 메뉴를 우회해 쿼리·본문에 다른 구역과 강사 역할을 넣어도 공지만 돌려줍니다.
    const bypass = await call(noticesHandler, 'GET', { authorization: `Bearer ${valid}`, cookie: device },
      { id: '22222222-2222-4222-8222-000000000001', resource: 'notes.own', zone: 'notes', role: 'instructor' });
    assert.deepEqual([bypass.status, bypass.body], [200, read.body]);

    // 강사 권한을 저장한 곳이 없으므로 role을 보내도 쓰기는 누구에게나 405입니다.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const write = await call(noticesHandler, method, { authorization: `Bearer ${valid}` }, { role: 'instructor' });
      assert.deepEqual([write.status, write.headers.Allow, write.body],
        [405, 'GET', { error: 'METHOD_NOT_ALLOWED' }]);
      assert.equal(write.headers['X-Resource-Id'], 'notices.instructor');
    }
    for (const reason of ['UNAUTHORIZED', 'NOTICES_READ_ONLY']) {
      assert.ok(logs.includes(`aleph.denied resource=notices.instructor reason=${reason}`), reason);
    }
    assert.ok(logs.every(line => !line.includes(valid) && !line.includes(claims.sub)));
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
