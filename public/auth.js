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
  let requestVersion = 0;
  let activeSession = null;
  let editingId = null;
  let busy = false;
  let signingOut = false;

  const resetEditor = () => {
    editingId = null;
    noteTitle.value = '';
    noteBody.value = '';
    save.textContent = '메모 추가';
    cancel.hidden = true;
  };

  const authRequest = async (action, body) => {
    const response = await fetch(`/api/auth/${action}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || (action === 'login'
      ? '로그인 정보를 확인하세요.' : '로그인 요청에 실패했습니다. 잠시 후 다시 시도하세요.'));
    return result;
  };
  // 여러 메모 요청이 동시에 만료되어도 갱신 요청은 하나만 보냅니다.
  let checkingSession;
  const checkSession = () => checkingSession ??= authRequest('session')
    .finally(() => { checkingSession = null; });

  const noteRequest = async (session, path, method = 'GET', body, retry = true) => {
    const response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      if (retry && !signingOut && activeSession === session) {
        const restored = await checkSession();
        if (activeSession === session && restored.user?.id === session.user.id) {
          return noteRequest(session, path, method, body, false);
        }
        if (activeSession === session) render(null);
      }
      throw new Error('로그인 확인에 실패했습니다. 다시 로그인하세요.');
    }
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
    message.textContent = error?.message || `${action}하지 못했습니다. 연결 상태를 확인하세요.`;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    login.disabled = true;
    message.textContent = '로그인 중…';
    try {
      await authRequest('login', { email: email.value.trim(), password: password.value });
      const session = await checkSession();
      if (!session.user) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 로그인하세요.');
      render(session);
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
    signingOut = true;
    logout.disabled = true;
    message.textContent = '로그아웃 중…';
    try {
      if (checkingSession) await checkingSession;
      await authRequest('logout');
      render(null);
      message.textContent = '로그아웃했습니다.';
    } catch (error) {
      showError(error, '로그아웃');
    } finally {
      signingOut = false;
      logout.disabled = false;
    }
  });

  render(null);
  state.textContent = '로그인 상태 확인 중…';
  void checkSession().then(session => render(session.user ? session : null))
    .catch(error => { render(null); showError(error, '로그인 상태를 확인'); })
    .finally(() => { login.disabled = false; });
})();
