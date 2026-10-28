(() => {
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const login = document.querySelector('#login-button');
  const logout = document.querySelector('#logout-button');
  const state = document.querySelector('#auth-state');
  const message = document.querySelector('#auth-message');
  const list = document.querySelector('#notes');
  const workspace = document.querySelector('#note-workspace');
  const noteForm = document.querySelector('#note-form');
  const noteTitle = document.querySelector('#note-title');
  const noteBody = document.querySelector('#note-body');
  const save = document.querySelector('#note-save');
  const cancel = document.querySelector('#note-cancel');
  const noteMessage = document.querySelector('#note-message');
  let client;
  let requestVersion = 0;
  let activeSession = null;
  let editingId = null;
  let busy = false;

  const resetEditor = () => {
    editingId = null;
    noteTitle.value = '';
    noteBody.value = '';
    save.textContent = '메모 추가';
    cancel.hidden = true;
  };

  const noteRequest = async (session, path, method = 'GET', body) => {
    const response = await fetch(path, {
      method, credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) throw new Error('로그인 확인에 실패했습니다. 다시 로그인하세요.');
    if (response.status === 404) throw new Error('메모가 없거나 이미 삭제되었습니다.');
    if (response.status === 409) throw new Error('같은 ID의 메모가 이미 있습니다.');
    if (response.status === 400) throw new Error('제목·내용과 메모 ID 형식을 확인하세요.');
    if (!response.ok) throw new Error('메모 요청에 실패했습니다. 잠시 후 다시 시도하세요.');
    return response.status === 204 ? null : response.json();
  };

  const changeNote = async (action, id) => {
    if (!activeSession || busy) return;
    const session = activeSession;
    const version = requestVersion;
    busy = true;
    save.disabled = true;
    noteMessage.textContent = action === 'edit' ? '메모를 읽는 중…' : '삭제 중…';
    try {
      const note = await noteRequest(session, `/api/notes/${encodeURIComponent(id)}`,
        action === 'edit' ? 'GET' : 'DELETE');
      if (version !== requestVersion) return;
      if (action === 'edit') {
        editingId = note.id;
        noteTitle.value = note.title;
        noteBody.value = note.body;
        save.textContent = '수정 저장';
        cancel.hidden = false;
        noteMessage.textContent = '내용을 고친 뒤 수정 저장을 누르세요.';
      } else {
        if (editingId === id) resetEditor();
        noteMessage.textContent = '삭제했습니다.';
        await loadNotes(session, ++requestVersion);
      }
    } catch (error) {
      if (version === requestVersion) noteMessage.textContent = error.message;
    } finally {
      busy = false;
      save.disabled = false;
    }
  };

  const loadNotes = async (session, version) => {
    try {
      const notes = await noteRequest(session, '/api/notes');
      if (version !== requestVersion) return;
      if (!Array.isArray(notes)) throw new Error('자료 형식이 맞지 않습니다.');
      if (notes.length === 0) { list.textContent = '내 메모가 없습니다. 위에서 가상 메모를 추가하세요.'; return; }
      list.replaceChildren(...notes.map(note => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const content = document.createElement('span');
        title.textContent = note.title;
        content.textContent = note.body;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '수정';
        edit.addEventListener('click', () => changeNote('edit', note.id));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '삭제';
        remove.addEventListener('click', () => changeNote('delete', note.id));
        item.append(title, content, edit, remove);
        return item;
      }));
    } catch (error) {
      if (version !== requestVersion) return;
      list.textContent = error instanceof Error ? error.message : '자료를 읽지 못했습니다.';
    }
  };

  const render = session => {
    const accountChanged = activeSession?.user?.id !== session?.user?.id;
    activeSession = session;
    const signedIn = Boolean(session?.user);
    state.textContent = signedIn ? '로그인됨' : '로그인하지 않음';
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    const version = ++requestVersion;
    list.replaceChildren();
    list.hidden = !signedIn;
    workspace.hidden = !signedIn;
    if (accountChanged || !signedIn) {
      resetEditor();
      noteMessage.textContent = '';
    }
    if (signedIn) {
      list.textContent = '가상 자료를 불러오는 중입니다.';
      void loadNotes(session, version);
    }
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
    list.replaceChildren();
    list.hidden = true;
    workspace.hidden = true;
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
      message.textContent = '로그인했습니다.';
    } catch (error) {
      showError(error, '로그인');
    } finally {
      password.value = '';
      login.disabled = false;
    }
  });

  cancel.addEventListener('click', () => {
    if (busy) return;
    resetEditor();
    noteMessage.textContent = '수정을 취소했습니다.';
  });

  noteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!activeSession || busy) return;
    const session = activeSession;
    const version = requestVersion;
    const id = editingId;
    busy = true;
    save.disabled = true;
    noteMessage.textContent = '저장 중…';
    try {
      await noteRequest(session, id ? `/api/notes/${encodeURIComponent(id)}` : '/api/notes',
        id ? 'PUT' : 'POST', { title: noteTitle.value, body: noteBody.value });
      if (version !== requestVersion) return;
      resetEditor();
      noteMessage.textContent = id ? '수정했습니다.' : '추가했습니다.';
      await loadNotes(session, ++requestVersion);
    } catch (error) {
      if (version === requestVersion) noteMessage.textContent = error.message;
    } finally {
      busy = false;
      save.disabled = false;
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
