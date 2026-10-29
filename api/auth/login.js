import { authClient, sameOrigin, setSessionCookies } from '../../src/auth-session.mjs';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!sameOrigin(request)) {
    return response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  }

  let email;
  let password;
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    ({ email, password } = body ?? {});
    if (typeof email !== 'string' || !email.trim() || email.length > 254
        || typeof password !== 'string' || !password || password.length > 1024) throw new Error();
  } catch {
    return response.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
  }

  let client;
  try {
    client = authClient();
  } catch {
    return response.status(503).json({ error: 'LOGIN_NOT_CONFIGURED' });
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      if (error.status === 429) {
        return response.status(429).json({ error: 'RATE_LIMITED', message: '잠시 후 다시 로그인하세요.' });
      }
      if (error.code === 'email_not_confirmed') {
        return response.status(403).json({ error: 'EMAIL_NOT_CONFIRMED', message: '이메일 인증을 완료하세요.' });
      }
      if (error.status >= 500 || !error.status) throw new Error();
      return response.status(401).json({ error: 'LOGIN_FAILED', message: '이메일·비밀번호 또는 계정 상태를 확인하세요.' });
    }
    const session = data?.session;
    if (!session?.access_token || !session.refresh_token) throw new Error();
    setSessionCookies(response, session);
    return response.status(200).json({ ok: true });
  } catch {
    // 비밀번호·토큰·SDK 오류 객체는 응답과 로그에 출력하지 않습니다.
    return response.status(502).json({ error: 'LOGIN_UNAVAILABLE', message: '로그인 서버에 연결하지 못했습니다.' });
  }
}
