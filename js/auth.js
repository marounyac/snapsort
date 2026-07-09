// SnapSort — sign-in gate. Accounts live in IndexedDB on this device only;
// passwords are never stored — only a PBKDF2 (SHA-256) hash with a per-user salt.
(() => {
  const SESSION_KEY = 'snapsort.session';
  const ITERATIONS = 150000;
  const $ = (id) => document.getElementById(id);

  const screen = $('authScreen');
  const sub = $('authSub');
  const toggle = $('authToggle');

  const loginForm = $('loginForm');
  const liUser = $('liUser'), liPass = $('liPass'), liErr = $('liErr'), liSubmit = $('liSubmit');

  const suStep1 = $('suStep1');
  const suUser = $('suUser'), suErr1 = $('suErr1'), suNext = $('suNext');

  const suStep2 = $('suStep2');
  const suHello = $('suHello'), suPass = $('suPass'), suPass2 = $('suPass2');
  const suErr2 = $('suErr2'), suBack = $('suBack'), suSubmit = $('suSubmit');

  let mode = 'signup';
  let onAuthed = null;
  let chosenName = '';

  // ---------- crypto ----------
  const enc = new TextEncoder();
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  function newSalt() {
    const s = new Uint8Array(16);
    crypto.getRandomValues(s);
    return toHex(s);
  }

  async function hashPassword(password, saltHex, iterations) {
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return toHex(bits);
  }

  // ---------- validation ----------
  const norm = (name) => name.trim().toLowerCase();

  function usernameError(name) {
    const n = name.trim();
    if (!n) return 'Please enter a username.';
    if (n.length < 3) return 'Username must be at least 3 characters.';
    if (n.length > 20) return 'Username must be 20 characters or fewer.';
    if (!/^[a-zA-Z0-9_]+$/.test(n)) return 'Only letters, numbers, and _ are allowed.';
    return null;
  }

  // ---------- UI helpers ----------
  function showErr(el, msg) { el.textContent = msg; el.hidden = false; }
  function clearErr() { [liErr, suErr1, suErr2].forEach((el) => { el.hidden = true; el.textContent = ''; }); }

  function busy(btn, label) {
    if (label) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function setMode(m) {
    mode = m;
    clearErr();
    loginForm.hidden = m !== 'login';
    suStep1.hidden = m !== 'signup';
    suStep2.hidden = true;
    if (m === 'login') {
      sub.textContent = 'Welcome back — log in to see your photos.';
      toggle.textContent = 'Need an account? Sign up';
    } else {
      sub.textContent = 'Create an account to start sorting your photos.';
      toggle.textContent = 'Already have an account? Log in';
    }
  }

  toggle.addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

  function finish(username) {
    try { localStorage.setItem(SESSION_KEY, username); } catch (e) { /* private mode */ }
    liUser.value = ''; liPass.value = ''; suUser.value = ''; suPass.value = ''; suPass2.value = '';
    screen.hidden = true;
    document.body.classList.remove('auth-locked');
    if (onAuthed) onAuthed();
  }

  // ---------- sign up, step 1: username ----------
  suStep1.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    const err = usernameError(suUser.value);
    if (err) { showErr(suErr1, err); return; }
    busy(suNext, 'Checking…');
    try {
      if (await DB.userGet(norm(suUser.value))) {
        showErr(suErr1, 'That username is already taken on this device.');
        return;
      }
      chosenName = suUser.value.trim();
      suHello.textContent = 'Hi ' + chosenName + '! Now choose a password.';
      suStep1.hidden = true;
      suStep2.hidden = false;
      suPass.value = ''; suPass2.value = '';
      suPass.focus();
    } catch (e2) {
      showErr(suErr1, 'Something went wrong — please try again.');
    } finally {
      busy(suNext);
    }
  });

  // ---------- sign up, step 2: password ----------
  suBack.addEventListener('click', () => {
    clearErr();
    suStep2.hidden = true;
    suStep1.hidden = false;
    suUser.focus();
  });

  suStep2.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    if (suPass.value.length < 6) { showErr(suErr2, 'Password must be at least 6 characters.'); return; }
    if (suPass.value !== suPass2.value) { showErr(suErr2, 'Passwords don’t match.'); return; }
    busy(suSubmit, 'Creating account…');
    try {
      const username = norm(chosenName);
      if (await DB.userGet(username)) {
        showErr(suErr2, 'That username is already taken on this device.');
        busy(suSubmit);
        return;
      }
      const salt = newSalt();
      const hash = await hashPassword(suPass.value, salt, ITERATIONS);
      await DB.userPut({ username, display: chosenName, salt, hash, iterations: ITERATIONS, createdAt: Date.now() });
      finish(username);
    } catch (e2) {
      showErr(suErr2, 'Could not create the account — please try again.');
      busy(suSubmit);
    }
  });

  // ---------- log in ----------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    if (!liUser.value.trim() || !liPass.value) {
      showErr(liErr, 'Please enter your username and password.');
      return;
    }
    busy(liSubmit, 'Logging in…');
    try {
      const rec = await DB.userGet(norm(liUser.value));
      // Hash even when the user doesn't exist so both failures take the same time.
      const hash = await hashPassword(liPass.value, rec ? rec.salt : newSalt(), rec ? rec.iterations : ITERATIONS);
      if (!rec || hash !== rec.hash) { showErr(liErr, 'Wrong username or password.'); return; }
      finish(rec.username);
    } catch (e2) {
      showErr(liErr, 'Something went wrong — please try again.');
    } finally {
      busy(liSubmit);
    }
  });

  // ---------- public API ----------
  window.Auth = {
    currentUser() {
      try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
    },

    init(cb) {
      onAuthed = cb;
      if (this.currentUser()) {
        document.body.classList.remove('auth-locked');
        cb();
        return;
      }
      // Returning device with accounts → default to Log in; brand new → Sign up.
      DB.userCount()
        .then((n) => setMode(n > 0 ? 'login' : 'signup'))
        .catch(() => setMode('signup'));
      setMode('signup');
      document.body.classList.add('auth-locked');
      screen.hidden = false;
      suUser.focus();
      console.log('SnapSort auth gate shown');
    },

    logOut() {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
      location.reload();
    },
  };
})();
