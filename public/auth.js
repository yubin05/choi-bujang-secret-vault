(() => {
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const login = document.querySelector('#login-button');
  const logout = document.querySelector('#logout-button');
  const state = document.querySelector('#auth-state');
  const message = document.querySelector('#auth-message');
  let client;

  const render = session => {
    const signedIn = Boolean(session?.user);
    state.textContent = signedIn ? '로그인됨' : '로그인하지 않음';
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    if (!signedIn) password.value = '';
  };
  const showError = (error, action) => {
    const reasons = {
      invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
      invalid_login_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
      email_not_confirmed: '이메일 인증이 완료되지 않았습니다.',
      email_provider_disabled: '이 프로젝트에서 이메일 로그인이 비활성화되어 있습니다.',
      over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
      over_email_send_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
      user_banned: '사용이 제한된 계정입니다.',
    };
    message.textContent = reasons[error?.code]
      || (error?.status === 429 ? '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'
        : error?.status === 400 ? '로그인 정보를 확인하세요. 이메일·비밀번호 또는 이메일 인증 상태가 올바르지 않습니다.'
          : `${action}하지 못했습니다. 네트워크와 Supabase Auth 설정을 확인하세요.`);
  };

  try {
    const config = globalThis.SUPABASE_PUBLIC_CONFIG;
    if (!globalThis.supabase?.createClient || !config?.url
        || !config.publishableKey?.startsWith('sb_publishable_')) throw new Error();
    client = globalThis.supabase.createClient(config.url, config.publishableKey);
    // 세션과 토큰은 공식 SDK에 맡기며 화면·로그에 출력하지 않습니다.
    client.auth.onAuthStateChange((_event, session) => render(session));
    login.disabled = false;
  } catch {
    state.textContent = '로그인을 사용할 수 없음';
    message.textContent = '로그인 SDK를 불러오지 못했거나 공개 연결 설정이 올바르지 않습니다. 새로고침 후 다시 확인하세요.';
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    login.disabled = true;
    message.textContent = '로그인 중…';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) { showError(error, '로그인'); return; }
      render(data.session);
      message.textContent = '로그인했습니다.';
    } catch (error) {
      showError(error, '로그인');
    } finally {
      password.value = '';
      login.disabled = false;
    }
  });

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    message.textContent = '로그아웃 중…';
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { showError(error, '로그아웃'); return; }
      render(null);
      message.textContent = '로그아웃했습니다.';
    } catch (error) {
      showError(error, '로그아웃');
    } finally {
      logout.disabled = false;
    }
  });
})();
