import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import handler from '../api/notes.js';

test('기존 검증 도우미로 정상 서명을 허용하고 누락·위조·만료·다른 발급자 토큰은 DB 조회 전에 거부한다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
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
  const expired = await new SignJWT({ ...claims, exp: now - 60 }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const wrongIssuer = await new SignJWT({ ...claims, iss: 'https://other.supabase.co/auth/v1' })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const otherPair = await generateKeyPair('ES256');
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(otherPair.privateKey);
  let databaseReads = 0;
  let databaseFailure = false;
  const call = async (authorization, method = 'GET') => {
    const result = { headers: {} };
    await handler({ method, headers: authorization ? { authorization } : {},
      query: { userId: claims.sub, role: 'authenticated' }, body: { userId: claims.sub, role: 'admin' } }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return { json: body => { result.body = body; } }; },
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
      assert.equal(url.searchParams.get('select'), 'title,content');
      assert.equal(options.headers.apikey, fakeSecret);
      if (databaseFailure) throw new Error(fakeSecret);
      return Response.json(Array.from({ length: 4 }, (_, i) => ({ title: `가상 ${i + 1}`,
        content: `테스트 ${i + 1}`, owner_id: claims.sub, extra: fakeSecret })));
    };
    for (const authorization of [undefined, 'Bearer invalid', `Bearer ${forged}`, `Bearer ${expired}`, `Bearer ${wrongIssuer}`]) {
      const result = await call(authorization);
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
      assert.equal(databaseReads, 0);
    }
    const result = await call(`Bearer ${valid}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.notes.length, 4);
    assert.deepEqual(Object.keys(result.body.notes[0]), ['title', 'content']);
    assert.equal(databaseReads, 1);
    databaseFailure = true;
    assert.equal((await call(`Bearer ${valid}`)).status, 502);
    assert.equal((await call(undefined, 'POST')).status, 405);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
