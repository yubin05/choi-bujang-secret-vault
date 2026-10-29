import { authClient, sameOrigin, sessionCookie, setSessionCookies } from '../../src/auth-session.mjs';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!sameOrigin(request)) return response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  const refresh = sessionCookie(request, 'refresh');
  if (refresh) {
    let client;
    try { client = authClient(); }
    catch { return response.status(503).json({ error: 'AUTH_NOT_CONFIGURED' }); }
    try {
      // SDK로 현재 세션을 복원한 뒤 이 세션의 갱신 토큰을 폐기합니다.
      const { error } = await client.auth.refreshSession({ refresh_token: refresh });
      if (error && (!error.status || error.status >= 500 || error.status === 429)) throw new Error();
      if (!error) {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw new Error();
      }
    } catch {
      return response.status(502).json({ error: 'LOGOUT_UNAVAILABLE', message: '로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.' });
    }
  }
  setSessionCookies(response, null);
  return response.status(200).json({ ok: true });
}
