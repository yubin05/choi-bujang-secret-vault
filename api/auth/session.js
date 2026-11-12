import { authClient, authConfig, dataConfig, deviceStatus, requestDevice, sameOrigin, sessionCookie,
  setSessionCookies } from '../../src/auth-session.mjs';
import { createLoginVerifier } from '../../src/verify-login.mjs';

let verifyAuthorization;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!sameOrigin(request)) return response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  const access = sessionCookie(request, 'access');
  const refresh = sessionCookie(request, 'refresh');
  if (!access && !refresh) return response.status(200).json({ user: null });
  let client;
  let db;
  try {
    client = authClient();
    db = dataConfig();
    verifyAuthorization ??= createLoginVerifier({ config: authConfig, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  } catch { return response.status(503).json({ error: 'AUTH_NOT_CONFIGURED' }); }
  // 로그인한 사용자에게 서버가 DB에서 확인한 기기 승인 상태를 함께 알려 줍니다.
  // POST /api/auth/device(?device=request)는 승인 '대기'만 만들며 승인 권한을 주지 않습니다.
  const signedIn = async id => {
    if (request.query?.device === 'request') {
      try {
        return response.status(200).json({ user: { id }, ...await requestDevice(request, response, id, db) });
      } catch {
        return response.status(502).json({ error: 'DEVICE_UNAVAILABLE', message: '기기 승인 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.' });
      }
    }
    let device;
    try { device = await deviceStatus(request, id, db); } catch { device = { deviceApproval: 'unknown' }; }
    return response.status(200).json({ user: { id }, ...device });
  };
  try {
    let identity = access ? await verifyAuthorization(`Bearer ${access}`) : null;
    if (identity?.kind === 'student') return await signedIn(identity.userId);
    if (refresh) {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
      if (error && (!error.status || error.status >= 500 || error.status === 429)) throw new Error();
      const session = data?.session;
      identity = session?.access_token ? await verifyAuthorization(`Bearer ${session.access_token}`) : null;
      if (!error && identity?.kind === 'student' && session.refresh_token) {
        setSessionCookies(response, session);
        return await signedIn(identity.userId);
      }
    }
    setSessionCookies(response, null);
    return response.status(200).json({ user: null });
  } catch {
    return response.status(502).json({ error: 'SESSION_UNAVAILABLE', message: '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
}
