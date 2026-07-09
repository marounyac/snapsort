// SnapSort — app shell: import, AI sorting queue, navigation, grids, sheets.
(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  const toastsEl = $('toasts');
  const fileInput = $('fileInput');
  const tbBack = $('tbBack');
  const tbTitle = $('tbTitle');
  const progressDock = $('progressDock');
  const pdText = $('pdText');
  const pdBar = $('pdBar');
  const pdRetry = $('pdRetry');
  const sheetHost = $('sheetHost');
  const dropOverlay = $('dropOverlay');

  let photos = [];            // all records, newest first
  const urls = new Map();     // id -> { thumb, full } object URLs
  let sorting = false;
  let modelLoadedOnce = false;

  const App = {};
  window.App = App;

  // ---------- tiny DOM helper ----------

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2));

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---------- toasts ----------

  App.toast = (msg) => {
    const el = h('div', 'toast', msg);
    toastsEl.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, 3200);
  };

  // ---------- overlay / history management ----------

  const overlayStack = [];
  App.pushOverlay = (name, closeFn) => {
    overlayStack.push({ name, close: closeFn });
    history.pushState({ overlay: overlayStack.length }, '');
  };

  window.addEventListener('popstate', () => {
    if (sheetOpen()) {
      closeSheet();
      // The back press consumed an overlay/route entry — restore it so the
      // overlay underneath stays open.
      if (overlayStack.length) history.pushState({ overlay: overlayStack.length }, '');
      return;
    }
    const top = overlayStack.pop();
    if (top) top.close();
  });

  // ---------- bottom sheets ----------

  let sheetResult;
  let sheetOnClose = null;

  function sheetOpen() { return !sheetHost.hidden; }

  function openSheet(node, onClose) {
    if (sheetOpen()) closeSheet(true);
    sheetOnClose = onClose || null;
    sheetResult = undefined;
    sheetHost.innerHTML = '';
    const backdrop = h('div', 'sheet-backdrop');
    const panel = h('div', 'sheet-panel');
    panel.append(node);
    sheetHost.append(backdrop, panel);
    sheetHost.hidden = false;
    requestAnimationFrame(() => sheetHost.classList.add('open'));
    backdrop.addEventListener('click', () => closeSheet());
  }

  function closeSheet(immediate) {
    if (!sheetOpen()) return;
    const cb = sheetOnClose;
    sheetOnClose = null;
    sheetHost.classList.remove('open');
    const finish = () => { sheetHost.hidden = true; sheetHost.innerHTML = ''; };
    if (immediate) finish(); else setTimeout(finish, 220);
    if (cb) cb(sheetResult);
  }

  App.confirm = (message, actionLabel) => new Promise((resolve) => {
    const box = h('div', 'sheet-content');
    box.append(h('p', 'sheet-msg', message));
    const row = h('div', 'sheet-actions');
    const cancel = h('button', 'btn ghost', 'Cancel');
    const okBtn = h('button', 'btn danger', actionLabel || 'Delete');
    cancel.onclick = () => closeSheet();
    okBtn.onclick = () => { sheetResult = true; closeSheet(); };
    row.append(cancel, okBtn);
    box.append(row);
    openSheet(box, (r) => resolve(!!r));
  });

  // ---------- object URLs ----------

  App.urlFor = (rec, kind) => {
    let u = urls.get(rec.id);
    if (!u) { u = {}; urls.set(rec.id, u); }
    if (kind === 'thumb') {
      if (!u.thumb) u.thumb = URL.createObjectURL(rec.thumb);
      return u.thumb;
    }
    if (!u.full) u.full = URL.createObjectURL(rec.blob);
    return u.full;
  };

  function invalidateUrls(id) {
    const u = urls.get(id);
    if (!u) return;
    if (u.thumb) URL.revokeObjectURL(u.thumb);
    if (u.full) URL.revokeObjectURL(u.full);
    urls.delete(id);
  }

  // ---------- photo lookups ----------

  App.getPhoto = (id) => photos.find((p) => p.id === id);

  const sorted = (list) => list.slice().sort((a, b) => b.addedAt - a.addedAt);
  const photosInMain = (mainId) => sorted(photos.filter((p) => p.mainCat === mainId));
  const photosInMini = (miniId) => sorted(photos.filter((p) => p.miniCat === miniId));

  function refreshSoft() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ---------- import ----------

  async function makeThumb(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      const w = img.naturalWidth, hgt = img.naturalHeight;
      if (!w || !hgt) throw new Error('empty image');
      const scale = Math.min(1, 480 / Math.min(w, hgt), 2200 / Math.max(w, hgt));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(hgt * scale));
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      c.getContext('2d').drawImage(img, 0, 0, tw, th);
      const tblob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('thumbnail failed'))), 'image/jpeg', 0.82));
      return { blob: tblob, w, h: hgt };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type && f.type.startsWith('image/'));
    if (!files.length) { App.toast('No images found in that selection'); return; }
    App.toast('Importing ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + '…');
    let added = 0, failed = 0;
    for (const f of files) {
      try {
        const t = await makeThumb(f);
        const rec = {
          id: uid(), name: f.name || 'photo', type: f.type, size: f.size,
          addedAt: Date.now(), w: t.w, h: t.h,
          blob: f, thumb: t.blob,
          status: 'pending', mainCat: null, miniCat: null, aiTop: null, edited: false,
        };
        await DB.putPhoto(rec);
        photos.unshift(rec);
        added++;
      } catch (e) {
        console.warn('Could not import', f.name, e);
        failed++;
      }
    }
    if (failed) App.toast('⚠️ ' + failed + ' photo' + (failed > 1 ? 's' : '') + " couldn't be read (unsupported format)");
    refreshSoft();
    if (added) runQueue();
  }

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // Camera capture — on phones this opens the camera app directly;
  // on desktop it falls back to a normal file picker.
  const cameraInput = $('cameraInput');
  cameraInput.addEventListener('change', () => {
    handleFiles(cameraInput.files);
    cameraInput.value = '';
  });

  $('tbLogout').addEventListener('click', async () => {
    if (await App.confirm('Log out of SnapSort?', 'Log out')) Auth.logOut();
  });

  // Drag & drop (desktop)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // ---------- AI sorting queue ----------

  function setProgress(text, pct, showRetry) {
    progressDock.hidden = false;
    pdText.textContent = text;
    pdRetry.hidden = !showRetry;
    if (pct == null) {
      pdBar.parentElement.classList.add('indeterminate');
    } else {
      pdBar.parentElement.classList.remove('indeterminate');
      pdBar.style.width = Math.max(2, Math.min(100, pct)) + '%';
    }
  }
  function hideProgress() { progressDock.hidden = true; }
  pdRetry.onclick = () => { hideProgress(); runQueue(); };

  async function runQueue() {
    if (sorting) return;
    const pendingCount = () => photos.filter((p) => p.status === 'pending').length;
    if (!pendingCount()) return;
    sorting = true;
    try {
      const dlLabel = modelLoadedOnce
        ? 'Loading AI…'
        : 'Downloading AI model (one-time, ~150 MB — Wi-Fi recommended)…';
      await Classifier.ensureReady((pct) => setProgress(dlLabel + ' ' + pct + '%', pct));
      if (!modelLoadedOnce) {
        modelLoadedOnce = true;
        DB.setMeta({ key: 'modelLoadedOnce', value: true }).catch(() => {});
      }

      let done = 0;
      for (;;) {
        const rec = photos.find((p) => p.status === 'pending');
        if (!rec) break;
        const total = done + pendingCount();
        setProgress('✨ Sorting photos… ' + (done + 1) + ' of ' + total, (done / total) * 100);
        try {
          const top = await Classifier.classify(rec.thumb);
          rec.aiTop = top;
          rec.miniCat = top[0].miniId;
          rec.mainCat = CATS.byMini[top[0].miniId].mainId;
        } catch (e) {
          console.error('Could not classify', rec.name, e);
          rec.aiTop = null;
          rec.miniCat = 'daily_other';
          rec.mainCat = 'daily';
        }
        rec.status = 'sorted';
        await DB.putPhoto(rec);
        done++;
        refreshSoft();
        if (Viewer.isOpen() && Viewer.currentId() === rec.id) Viewer.refreshChrome();
        await sleep(30);
      }
      hideProgress();
      if (done) App.toast('✨ Sorted ' + done + ' photo' + (done > 1 ? 's' : ''));
    } catch (e) {
      console.error(e);
      setProgress("⚠️ The AI model couldn't load — check your internet connection", 100, true);
    } finally {
      sorting = false;
    }
  }

  // ---------- photo actions ----------

  App.downloadPhoto = (id) => {
    const rec = App.getPhoto(id);
    if (!rec) return;
    const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const ext = extMap[rec.blob.type || rec.type] || 'jpg';
    const base = (rec.name || 'photo').replace(/\.[a-z0-9]+$/i, '');
    const a = document.createElement('a');
    a.href = App.urlFor(rec, 'full');
    a.download = base + (rec.edited ? '-edited' : '') + '.' + ext;
    document.body.append(a);
    a.click();
    a.remove();
  };

  App.confirmDelete = async (id) => {
    const rec = App.getPhoto(id);
    if (!rec) return false;
    const ok = await App.confirm('Delete "' + rec.name + '"? This cannot be undone.', 'Delete');
    if (!ok) return false;
    await DB.deletePhoto(id);
    DB.fileDel('orig:' + id).catch(() => {});
    photos = photos.filter((p) => p.id !== id);
    invalidateUrls(id);
    refreshSoft();
    App.toast('🗑️ Photo deleted');
    return true;
  };

  App.openMoveSheet = (id, onMoved) => {
    const rec = App.getPhoto(id);
    if (!rec) return;
    const box = h('div', 'sheet-content');
    box.append(h('h3', 'sheet-title', 'Move to…'));
    for (const main of CATS.mains) {
      const row = h('button', 'mrow');
      row.append(h('span', 'mrow-emoji', main.emoji), h('span', 'mrow-name', main.name), h('span', 'mrow-arrow', '▾'));
      const minisBox = h('div', 'mminis');
      minisBox.hidden = main.id !== rec.mainCat;
      if (!minisBox.hidden) row.classList.add('open');
      for (const mini of main.minis) {
        const count = photos.filter((p) => p.miniCat === mini.id).length;
        const mbtn = h('button', 'mini-btn' + (rec.miniCat === mini.id ? ' current' : ''));
        mbtn.append(h('span', '', mini.emoji + ' ' + mini.name), h('span', 'mini-count', String(count)));
        mbtn.onclick = async () => {
          rec.mainCat = main.id;
          rec.miniCat = mini.id;
          await DB.putPhoto(rec);
          closeSheet();
          refreshSoft();
          App.toast('Moved to ' + main.emoji + ' ' + main.name + ' ▸ ' + mini.name);
          if (onMoved) onMoved();
        };
        minisBox.append(mbtn);
      }
      row.onclick = () => { minisBox.hidden = !minisBox.hidden; row.classList.toggle('open', !minisBox.hidden); };
      box.append(row, minisBox);
    }
    openSheet(box);
  };

  App.openInfoSheet = (id) => {
    const rec = App.getPhoto(id);
    if (!rec) return;
    const box = h('div', 'sheet-content');
    box.append(h('h3', 'sheet-title', 'Photo info'));
    const dl = h('div', 'info-grid');
    const addRow = (k, v) => { dl.append(h('div', 'info-k', k), h('div', 'info-v', v)); };
    addRow('Name', rec.name + (rec.edited ? '  (edited)' : ''));
    addRow('Added', new Date(rec.addedAt).toLocaleString('en-US'));
    addRow('Size', (rec.w && rec.h ? rec.w + ' × ' + rec.h + ' — ' : '') + fmtSize(rec.size));
    if (rec.miniCat && CATS.byMini[rec.miniCat]) {
      const mini = CATS.byMini[rec.miniCat];
      const main = CATS.mainById[mini.mainId];
      addRow('Category', main.emoji + ' ' + main.name + ' ▸ ' + mini.emoji + ' ' + mini.name);
    } else {
      addRow('Category', '⏳ Waiting for AI…');
    }
    box.append(dl);
    if (rec.aiTop && rec.aiTop.length) {
      box.append(h('h4', 'sheet-sub', 'AI match'));
      for (const t of rec.aiTop) {
        const mini = CATS.byMini[t.miniId];
        if (!mini) continue;
        const line = h('div', 'ai-line');
        line.append(h('span', 'ai-name', mini.emoji + ' ' + mini.name));
        const track = h('div', 'ai-track');
        const fill = h('div', 'ai-fill');
        fill.style.width = Math.max(3, Math.round(t.p * 100)) + '%';
        track.append(fill);
        line.append(track, h('span', 'ai-pct', Math.round(t.p * 100) + '%'));
        box.append(line);
      }
    } else if (rec.status === 'sorted') {
      box.append(h('p', 'sheet-msg dim', "The AI couldn't identify this one — it was placed in Daily Life & Home ▸ Other."));
    }
    openSheet(box);
  };

  App.applyEdit = async (id, blob) => {
    const rec = App.getPhoto(id);
    if (!rec) return;
    if (!rec.edited) {
      try { await DB.filePut('orig:' + id, rec.blob); }
      catch (e) { console.warn('backup failed', e); }
    }
    const t = await makeThumb(blob);
    rec.blob = blob;
    rec.thumb = t.blob;
    rec.w = t.w;
    rec.h = t.h;
    rec.type = blob.type || rec.type;
    rec.edited = true;
    await DB.putPhoto(rec);
    invalidateUrls(id);
    refreshSoft();
    App.toast('✅ Edits saved');
  };

  App.revertEdit = async (id) => {
    const rec = App.getPhoto(id);
    if (!rec) return false;
    let orig;
    try { orig = await DB.fileGet('orig:' + id); } catch (e) { orig = null; }
    if (!orig) { App.toast('⚠️ Original not found'); return false; }
    const t = await makeThumb(orig);
    rec.blob = orig;
    rec.thumb = t.blob;
    rec.w = t.w;
    rec.h = t.h;
    rec.type = orig.type || rec.type;
    rec.edited = false;
    await DB.putPhoto(rec);
    DB.fileDel('orig:' + id).catch(() => {});
    invalidateUrls(id);
    refreshSoft();
    App.toast('↩️ Original restored');
    return true;
  };

  // ---------- routing & rendering ----------

  function route() {
    const parts = location.hash.slice(1).split('/').filter(Boolean);
    if (parts[0] === 'all') return { name: 'all' };
    if (parts[0] === 'cat' && CATS.mainById[parts[1]]) return { name: 'cat', main: parts[1] };
    if (parts[0] === 'mini' && CATS.byMini[parts[1]]) return { name: 'mini', mini: parts[1] };
    return { name: 'home' };
  }

  function setTopbar(title) {
    if (title === null) {
      tbBack.hidden = true;
      tbTitle.innerHTML = '';
      const brand = h('span', 'brand');
      brand.append(h('span', 'brand-icon', '📸'), h('span', '', ' SnapSort'));
      tbTitle.append(brand);
    } else {
      tbBack.hidden = false;
      tbTitle.innerHTML = '';
      tbTitle.append(h('span', 'tb-text', title));
    }
  }
  tbBack.onclick = () => history.back();

  function tile(rec, listIds, index, showMainEmoji) {
    const b = h('button', 'tile');
    b.dataset.id = rec.id;
    const img = h('img');
    img.loading = 'lazy';
    img.alt = rec.name || 'photo';
    img.src = App.urlFor(rec, 'thumb');
    b.append(img);
    if (rec.status === 'pending') {
      b.classList.add('pending');
      b.append(h('span', 'tchip', '⏳'));
    } else if (showMainEmoji && rec.miniCat && CATS.byMini[rec.miniCat]) {
      b.append(h('span', 'tchip', CATS.byMini[rec.miniCat].emoji));
    }
    if (rec.edited) b.append(h('span', 'tedit', '✏️'));
    b.onclick = () => Viewer.open(listIds, index);
    return b;
  }

  function grid(list, showMainEmoji) {
    const g = h('div', 'grid');
    const listIds = list.map((p) => p.id);
    list.forEach((rec, i) => g.append(tile(rec, listIds, i, showMainEmoji)));
    return g;
  }

  function emptyNote(text) {
    return h('p', 'empty-note', text);
  }

  function renderHome() {
    setTopbar(null);
    const frag = document.createDocumentFragment();

    if (!photos.length) {
      const hero = h('div', 'hero');
      hero.append(h('div', 'hero-emoji', '📸'));
      hero.append(h('h1', 'hero-title', 'Your photos, sorted by AI'));
      hero.append(h('p', 'hero-sub', 'Import pictures from your gallery — or take one with your camera — and SnapSort files each one into the right category automatically: Nature, Friends & Family, School, Food, and Daily Life.'));
      const btns = h('div', 'hero-btns');
      const btn = h('label', 'btn primary big');
      btn.htmlFor = 'fileInput';
      btn.textContent = '＋ Import photos';
      const camBtn = h('label', 'btn ghost big');
      camBtn.htmlFor = 'cameraInput';
      camBtn.textContent = '📷 Take a photo';
      btns.append(btn, camBtn);
      hero.append(btns);
      hero.append(h('p', 'hero-note', '🔒 Private: photos never leave your device.\n📥 The first import downloads the AI model (~150 MB, one time) — Wi-Fi recommended.'));
      frag.append(hero);
      view.replaceChildren(frag);
      return;
    }

    const allBar = h('button', 'allbar');
    allBar.append(h('span', '', '🖼️ All Photos'), h('span', 'allbar-count', photos.length + ' ›'));
    allBar.onclick = () => { location.hash = '#all'; };
    frag.append(allBar);

    const cards = h('div', 'cards');
    for (const main of CATS.mains) {
      const inMain = photosInMain(main.id);
      const card = h('button', 'card tint-' + main.id);
      const head = h('div', 'card-head');
      head.append(h('span', 'card-emoji', main.emoji), h('span', 'card-name', main.name), h('span', 'card-count', String(inMain.length)));
      card.append(head);
      const mosaic = h('div', 'mosaic');
      if (inMain.length) {
        inMain.slice(0, 4).forEach((p) => {
          const im = h('img');
          im.loading = 'lazy';
          im.alt = '';
          im.src = App.urlFor(p, 'thumb');
          mosaic.append(im);
        });
      } else {
        const ph = h('div', 'mosaic-empty', main.emoji);
        mosaic.append(ph);
      }
      card.append(mosaic);
      card.onclick = () => { location.hash = '#cat/' + main.id; };
      cards.append(card);
    }
    frag.append(cards);
    view.replaceChildren(frag);
  }

  function renderCat(mainId) {
    const main = CATS.mainById[mainId];
    setTopbar(main.emoji + ' ' + main.name);
    const frag = document.createDocumentFragment();
    for (const mini of main.minis) {
      const inMini = photosInMini(mini.id);
      const sec = h('section', 'mini-sec');
      const head = h('button', 'mini-head');
      head.append(
        h('span', 'mini-head-name', mini.emoji + ' ' + mini.name),
        h('span', 'mini-head-count', inMini.length ? inMini.length + ' ›' : '›'),
      );
      head.onclick = () => { location.hash = '#mini/' + mini.id; };
      sec.append(head);
      if (inMini.length) {
        const strip = h('div', 'strip');
        const ids = inMini.map((p) => p.id);
        inMini.slice(0, 12).forEach((rec, i) => {
          const t = tile(rec, ids, i, false);
          t.classList.add('stile');
          strip.append(t);
        });
        sec.append(strip);
      } else {
        sec.append(emptyNote('Nothing here yet'));
      }
      frag.append(sec);
    }
    view.replaceChildren(frag);
  }

  function renderMini(miniId) {
    const mini = CATS.byMini[miniId];
    setTopbar(mini.emoji + ' ' + mini.name);
    const inMini = photosInMini(miniId);
    const frag = document.createDocumentFragment();
    if (inMini.length) frag.append(grid(inMini, false));
    else frag.append(emptyNote('No photos in this mini-category yet. The AI adds them here automatically, or use Move on any photo.'));
    view.replaceChildren(frag);
  }

  function renderAll() {
    setTopbar('🖼️ All Photos');
    const all = sorted(photos);
    const frag = document.createDocumentFragment();
    if (all.length) frag.append(grid(all, true));
    else frag.append(emptyNote('No photos yet — tap Import to add some!'));
    view.replaceChildren(frag);
  }

  function render() {
    const r = route();
    if (r.name === 'cat') renderCat(r.main);
    else if (r.name === 'mini') renderMini(r.mini);
    else if (r.name === 'all') renderAll();
    else renderHome();
  }

  window.addEventListener('hashchange', render);

  // ---------- boot ----------

  function showFatal(msg) {
    view.replaceChildren(h('p', 'empty-note', '⚠️ ' + msg));
  }

  async function boot() {
    try {
      photos = await DB.getAllPhotos();
    } catch (e) {
      console.error(e);
      showFatal('SnapSort could not open local storage. If you are in private/incognito mode, try a normal window.');
      return;
    }
    photos.sort((a, b) => b.addedAt - a.addedAt);
    // Migrate photos saved under mini-categories that no longer exist
    // (e.g. the old Study sub-categories) to their replacement, or to the
    // main category's "Other".
    for (const rec of photos) {
      if (rec.miniCat && !CATS.byMini[rec.miniCat]) {
        const fallback = CATS.mainById[rec.mainCat] ? rec.mainCat + '_other' : 'daily_other';
        rec.miniCat = CATS.legacy[rec.miniCat] || fallback;
        rec.mainCat = CATS.byMini[rec.miniCat].mainId;
        try { await DB.putPhoto(rec); } catch (e) { /* keep the in-memory fix */ }
      }
    }
    try {
      const flag = await DB.getMeta('modelLoadedOnce');
      modelLoadedOnce = !!(flag && flag.value);
    } catch (e) { /* default false */ }
    Auth.init(startApp);
  }

  function startApp() {
    render();
    console.log('SnapSort ready —', photos.length, 'photos in library');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (photos.some((p) => p.status === 'pending')) setTimeout(runQueue, 500);
  }

  boot();
})();
