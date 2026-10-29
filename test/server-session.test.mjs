import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import sessionHandler from '../api/auth/session.js';
import logoutHandler from '../api/auth/logout.js';
import { authConfig as config } from '../src/auth-session.mjs';

test('서버 세션 검증·SDK 갱신·현재 세션 로그아웃과 실패 시 쿠키 보존', async () => {
  const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
  const saved = names.map(name => process.env[name]);
  const originalFetch = globalThis.fetch;
  const pair = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'session-test', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const claims = { sub: user.id, iss: config.identityProvider.issuer, aud: 'authenticated',
    role: 'authenticated', iat: now, exp: now + 3600 };
  const sign = payload => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const access = await sign(claims);
  const expired = await sign({ ...claims, exp: now - 60 });
  let refreshCalls = 0;
  let logoutCalls = 0;
  let failure;
  const cookie = token => `__Host-aleph-access=${encodeURIComponent(token)}; __Host-aleph-refresh=test-refresh`;
  const call = async (handler, cookies, method = 'POST', origin = new URL(config.publicAppUrl).origin) => {
    const result = { headers: {} };
    await handler({ method, headers: { origin, cookie: cookies } }, {
      setHeader: (name, value) => { result.headers[name] = value; },
      status: status => { result.status = status; return { json: value => { result.body = value; } }; },
    });
    const json = JSON.stringify(result.body);
    assert.ok(!json.includes(access) && !json.includes('test-refresh'));
    assert.equal(result.headers['Cache-Control'], 'no-store');
    return result;
  };
  try {
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
    globalThis.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
      if (url.pathname === '/auth/v1/token') {
        refreshCalls++;
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
        assert.equal(JSON.parse(options.body).refresh_token, 'test-refresh');
        if (failure) return Response.json({ msg: 'Unavailable', code: 'refresh_token_not_found' }, { status: failure });
        return Response.json({ access_token: access, refresh_token: 'test-rotated',
          expires_in: 3600, token_type: 'bearer', user });
      }
      assert.equal(url.pathname, '/auth/v1/logout');
      assert.equal(url.searchParams.get('scope'), 'local');
      assert.equal(options.headers.Authorization, `Bearer ${access}`);
      logoutCalls++;
      return new Response(null, { status: 204 });
    };
    for (const handler of [sessionHandler, logoutHandler]) {
      assert.equal((await call(handler, undefined, 'GET')).status, 405);
      assert.equal((await call(handler, cookie(access), 'POST', 'https://other.example')).status, 403);
    }
    assert.equal(refreshCalls, 0);
    assert.deepEqual((await call(sessionHandler)).body, { user: null });
    const restored = await call(sessionHandler, cookie(access));
    assert.deepEqual(restored.body, { user });
    assert.equal(restored.headers['Set-Cookie'], undefined);
    assert.equal(refreshCalls, 0);
    const renewed = await call(sessionHandler, cookie(expired));
    assert.deepEqual(renewed.body, { user });
    assert.equal(renewed.headers['Set-Cookie'].length, 2);
    assert.equal(refreshCalls, 1);
    const loggedOut = await call(logoutHandler, cookie(access));
    assert.deepEqual(loggedOut.body, { ok: true });
    assert.equal(logoutCalls, 1);
    assert.ok(loggedOut.headers['Set-Cookie'].every(value => value.endsWith('; Max-Age=0')));
    failure = 400;
    const invalid = await call(sessionHandler, cookie(expired));
    assert.deepEqual(invalid.body, { user: null });
    assert.ok(invalid.headers['Set-Cookie'].every(value => value.endsWith('; Max-Age=0')));
    failure = 429;
    for (const handler of [sessionHandler, logoutHandler]) {
      const unavailable = await call(handler, cookie(expired));
      assert.equal(unavailable.status, 502);
      assert.equal(unavailable.headers['Set-Cookie'], undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
  }
});
