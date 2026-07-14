// SnapSort — sign-in gate.
// With the backend configured and reachable, accounts are real Supabase Auth
// accounts (username → synthetic email) that work on any device; passwords are
// hashed server-side and never stored. When the backend can't be reached
// (offline, file://), it falls back to the original on-device accounts:
// PBKDF2 (SHA-256) hashes in IndexedDB, never plaintext.
(() => {
  const SESSION_KEY = 'snapsort.session';
  const CLOUD_FLAG = 'snapsort.cloudAccount'; // set once a cloud login/signup succeeds here
  const EMAIL_DOMAIN = '@snapsort.local';     // usernames become synthetic emails
  const ITERATIONS = 150000;
  const $ = (id) => document.getElementById(id);
  let cloud = null; // Supabase client in cloud mode, null in on-device mode

  const screen = $('authScreen');
  const sub = $('authSub');
  const toggle = $('authToggle');
  const note = $('authNote');

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
      // Cloud mode can only detect a taken username at account creation, so
      // the availability check here is on-device mode only.
      if (!cloud && await DB.userGet(norm(suUser.value))) {
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

      if (cloud) {
        const { error } = await cloud.auth.signUp({
          email: username + EMAIL_DOMAIN,
          password: suPass.value,
          options: { data: { username: chosenName.trim() } },
        });
        if (error) {
          const m = (error.message || '').toLowerCase();
          if (m.includes('already registered') || m.includes('database error')) {
            showErr(suErr2, 'That username is already taken — try another.');
          } else if (m.includes('fetch') || m.includes('network')) {
            showErr(suErr2, 'No connection — check your internet and try again.');
          } else {
            showErr(suErr2, 'Could not create the account — please try again.');
          }
          busy(suSubmit);
          return;
        }
        try { localStorage.setItem(CLOUD_FLAG, '1'); } catch (e3) { /* ignore */ }
        finish(username);
        return;
      }

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
      if (cloud) {
        const { error } = await cloud.auth.signInWithPassword({
          email: norm(liUser.value) + EMAIL_DOMAIN,
          password: liPass.value,
        });
        if (error) {
          const m = (error.message || '').toLowerCase();
          if (m.includes('invalid login')) showErr(liErr, 'Wrong username or password.');
          else if (m.includes('fetch') || m.includes('network')) showErr(liErr, 'No connection — check your internet and try again.');
          else showErr(liErr, 'Something went wrong — please try again.');
          return;
        }
        try { localStorage.setItem(CLOUD_FLAG, '1'); } catch (e3) { /* ignore */ }
        finish(norm(liUser.value));
        return;
      }

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

    async init(cb) {
      onAuthed = cb;
      // Anyone already signed in on this device (cloud or on-device account)
      // goes straight in — no network needed to open your own photos.
      if (this.currentUser()) {
        document.body.classList.remove('auth-locked');
        cb();
        return;
      }

      document.body.classList.add('auth-locked');
      cloud = Backend.configured() ? await Backend.getClient() : null;

      if (cloud) {
        // A previous cloud session may still be valid (supabase-js persists it).
        try {
          const { data } = await cloud.auth.getSession();
          const user = data && data.session && data.session.user;
          if (user) {
            const name = (user.user_metadata && user.user_metadata.username) ||
              (user.email || '').replace(EMAIL_DOMAIN, '');
            finish(norm(name || 'me'));
            return;
          }
        } catch (e) { /* fall through to the gate */ }
        note.textContent = '🔒 Your account works on any device. Photos stay on this device unless you share them.';
        let hasCloud = false;
        try { hasCloud = !!localStorage.getItem(CLOUD_FLAG); } catch (e) { /* ignore */ }
        setMode(hasCloud ? 'login' : 'signup');
        // Existing on-device accounts can't log in to the cloud — say so once.
        if (!hasCloud) {
          DB.userCount().then((n) => {
            if (n > 0) sub.textContent = 'Accounts now work on any device — create yours once more. The photos on this device are untouched.';
          }).catch(() => { /* ignore */ });
        }
      } else {
        note.textContent = '🔒 No connection — this account will work on this device only.';
        // Returning device with accounts → default to Log in; brand new → Sign up.
        setMode('signup');
        DB.userCount()
          .then((n) => setMode(n > 0 ? 'login' : 'signup'))
          .catch(() => { /* keep signup */ });
      }

      screen.hidden = false;
      suUser.focus();
      console.log('SnapSort auth gate shown');
    },

    logOut() {
      const done = () => {
        try {
          localStorage.removeItem(SESSION_KEY);
          // Belt and braces: drop any supabase-js session token too, so a
          // logged-out device never auto-logs back in on the next load.
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith('sb-')) localStorage.removeItem(k);
          }
        } catch (e) { /* ignore */ }
        location.reload();
      };
      const c = cloud ? Promise.resolve(cloud)
        : (Backend.configured() ? Backend.getClient() : Promise.resolve(null));
      c.then((cl) => (cl ? cl.auth.signOut() : null)).then(done, done);
    },
  };
})();
