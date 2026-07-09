// SnapSort — fullscreen photo viewer. Pinch-zoom / double-tap / wheel zoom,
// pan, swipe left-right to navigate, swipe down to close (like a phone gallery).
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const vStage = $('vStage');
  const vImg = $('vImg');
  const vBack = $('vBack');
  const vChip = $('vChip');
  const vCount = $('vCount');
  const vInfoBtn = $('vInfoBtn');
  const vPrevBtn = $('vPrevBtn');
  const vNextBtn = $('vNextBtn');
  const vEditBtn = $('vEditBtn');
  const vMoveBtn = $('vMoveBtn');
  const vSaveBtn = $('vSaveBtn');
  const vDeleteBtn = $('vDeleteBtn');

  const MAX_SCALE = 6;
  let ids = [];
  let idx = 0;
  let isOpen = false;

  let scale = 1, tx = 0, ty = 0; // current transform (translate in screen px, scale around center)
  let fitW = 0, fitH = 0;        // image size at scale 1

  const cur = () => App.getPhoto(ids[idx]);

  // ---------- open / close ----------

  function open(list, index) {
    ids = list.slice();
    idx = Math.max(0, Math.min(index, ids.length - 1));
    isOpen = true;
    viewer.hidden = false;
    viewer.classList.remove('chrome-hidden');
    document.body.classList.add('no-scroll', 'has-overlay');
    show();
    App.pushOverlay('viewer', hide);
  }

  function hide() {
    isOpen = false;
    viewer.hidden = true;
    vImg.removeAttribute('src');
    document.body.classList.remove('no-scroll', 'has-overlay');
  }

  // ---------- rendering ----------

  function show() {
    const rec = cur();
    if (!rec) { if (isOpen) history.back(); return; }
    resetTransform();
    vImg.classList.remove('anim');
    vImg.style.opacity = '0';
    vImg.onload = () => {
      computeFit();
      applyTransform();
      vImg.style.opacity = '1';
    };
    vImg.onerror = () => { App.toast('⚠️ Could not display this photo'); };
    vImg.src = App.urlFor(rec, 'full');
    vImg.alt = rec.name || 'photo';
    updateChrome();
    preload(idx + 1);
    preload(idx - 1);
  }

  function preload(i) {
    if (i < 0 || i >= ids.length) return;
    const rec = App.getPhoto(ids[i]);
    if (rec) { const im = new Image(); im.src = App.urlFor(rec, 'full'); }
  }

  function updateChrome() {
    const rec = cur();
    if (!rec) return;
    vCount.textContent = (idx + 1) + ' / ' + ids.length;
    vChip.className = 'vchip';
    vChip.style.removeProperty('--tint');
    if (rec.miniCat && CATS.byMini[rec.miniCat]) {
      const mini = CATS.byMini[rec.miniCat];
      const main = CATS.mainById[mini.mainId];
      vChip.textContent = main.emoji + ' ' + mini.name;
      vChip.style.setProperty('--tint', main.color);
    } else {
      vChip.textContent = rec.status === 'pending' ? '⏳ Sorting…' : '🗂️ Uncategorised';
    }
    vPrevBtn.disabled = idx === 0;
    vNextBtn.disabled = idx === ids.length - 1;
  }

  function computeFit() {
    const s = vStage.getBoundingClientRect();
    const nw = vImg.naturalWidth || 1;
    const nh = vImg.naturalHeight || 1;
    const r = Math.min(s.width / nw, s.height / nh);
    fitW = nw * r;
    fitH = nh * r;
  }

  function resetTransform() { scale = 1; tx = 0; ty = 0; }

  function applyTransform() {
    vImg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function clampT() {
    const s = vStage.getBoundingClientRect();
    const exX = Math.max(0, (fitW * scale - s.width) / 2);
    const exY = Math.max(0, (fitH * scale - s.height) / 2);
    tx = Math.min(exX, Math.max(-exX, tx));
    ty = Math.min(exY, Math.max(-exY, ty));
  }

  function animApply() {
    vImg.classList.add('anim');
    applyTransform();
    setTimeout(() => vImg.classList.remove('anim'), 220);
  }

  function zoomAt(px, py, ns) {
    const r = vStage.getBoundingClientRect();
    const ax = px - (r.left + r.width / 2);
    const ay = py - (r.top + r.height / 2);
    ns = Math.min(MAX_SCALE, Math.max(1, ns));
    tx = ax - (ax - tx) * (ns / scale);
    ty = ay - (ay - ty) * (ns / scale);
    scale = ns;
    if (scale <= 1.001) resetTransform();
    clampT();
  }

  function toggleZoom(px, py) {
    if (scale > 1.01) resetTransform();
    else zoomAt(px, py, 2.5);
    animApply();
  }

  // ---------- navigation ----------

  function next() { if (idx < ids.length - 1) { idx++; show(); } }
  function prev() { if (idx > 0) { idx--; show(); } }

  // ---------- gestures ----------

  const ptrs = new Map();
  let gest = null;
  let lastTap = 0, lastTapX = 0, lastTapY = 0, tapTimer = null;

  vStage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    vStage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vImg.classList.remove('anim');
    if (ptrs.size === 1) {
      gest = {
        type: scale > 1.01 ? 'pan' : 'swipe',
        sx: e.clientX, sy: e.clientY, stx: tx, sty: ty,
        t: performance.now(), moved: false, dx: 0, dy: 0,
      };
    } else if (ptrs.size === 2) {
      const pts = Array.from(ptrs.values());
      gest = {
        type: 'pinch',
        d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        mx0: (pts[0].x + pts[1].x) / 2, my0: (pts[0].y + pts[1].y) / 2,
        s0: scale, tx0: tx, ty0: ty,
      };
      vImg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    }
  });

  vStage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gest) return;

    if (gest.type === 'pinch' && ptrs.size >= 2) {
      const pts = Array.from(ptrs.values());
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const ns = Math.min(MAX_SCALE, Math.max(0.5, gest.s0 * (d / gest.d0)));
      const r = vStage.getBoundingClientRect();
      const ax = gest.mx0 - (r.left + r.width / 2);
      const ay = gest.my0 - (r.top + r.height / 2);
      tx = ax - (ax - gest.tx0) * (ns / gest.s0) + (mx - gest.mx0);
      ty = ay - (ay - gest.ty0) * (ns / gest.s0) + (my - gest.my0);
      scale = ns;
      if (scale >= 1) clampT();
      applyTransform();
    } else if (gest.type === 'pan') {
      const dx = e.clientX - gest.sx;
      const dy = e.clientY - gest.sy;
      if (Math.hypot(dx, dy) > 6) gest.moved = true;
      tx = gest.stx + dx;
      ty = gest.sty + dy;
      clampT();
      applyTransform();
    } else if (gest.type === 'swipe') {
      gest.dx = e.clientX - gest.sx;
      gest.dy = e.clientY - gest.sy;
      if (Math.hypot(gest.dx, gest.dy) > 6) gest.moved = true;
      if (!gest.moved) return;
      if (Math.abs(gest.dx) > Math.abs(gest.dy)) {
        vImg.style.transform = 'translate(' + gest.dx + 'px,0) scale(1)';
      } else if (gest.dy > 0) {
        const k = Math.max(0.6, 1 - gest.dy / 900);
        vImg.style.transform = 'translate(0,' + gest.dy + 'px) scale(' + k + ')';
        viewer.style.setProperty('--vdim', String(Math.max(0.35, 1 - gest.dy / 500)));
      }
    }
  });

  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);

    if (gest && gest.type === 'pinch') {
      if (ptrs.size < 2) {
        if (scale < 1.05) resetTransform(); else clampT();
        animApply();
        gest = null;
      }
      return;
    }
    if (!gest) return;
    const g = gest;
    gest = null;

    if (g.type === 'pan') {
      if (!g.moved && e.type === 'pointerup') handleTap(e);
      return;
    }

    // swipe
    viewer.style.removeProperty('--vdim');
    if (!g.moved) {
      if (e.type === 'pointerup') handleTap(e);
      applyTransform();
      return;
    }
    const dt = performance.now() - g.t;
    if (Math.abs(g.dx) > Math.abs(g.dy)) {
      const fling = Math.abs(g.dx) > 70 || (Math.abs(g.dx) > 30 && dt < 250);
      if (fling && g.dx < 0 && idx < ids.length - 1) { next(); return; }
      if (fling && g.dx > 0 && idx > 0) { prev(); return; }
    } else if (g.dy > 90) {
      history.back();
      return;
    }
    animApply(); // snap back
  }

  vStage.addEventListener('pointerup', endPointer);
  vStage.addEventListener('pointercancel', endPointer);

  function handleTap(e) {
    const now = performance.now();
    const isDouble = tapTimer && (now - lastTap) < 320 &&
      Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40;
    if (isDouble) {
      clearTimeout(tapTimer);
      tapTimer = null;
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapTimer = null;
      viewer.classList.toggle('chrome-hidden');
    }, 320);
  }

  vStage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * 0.0022));
    applyTransform();
  }, { passive: false });

  vStage.addEventListener('dblclick', (e) => { e.preventDefault(); });
  vStage.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS native pinch
  vImg.addEventListener('contextmenu', (e) => e.preventDefault());
  vImg.draggable = false;

  window.addEventListener('keydown', (e) => {
    if (!isOpen || document.getElementById('editor').hidden === false) return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Escape') history.back();
    else if (e.key === '+' || e.key === '=') { zoomAt(innerWidth / 2, innerHeight / 2, scale * 1.4); animApply(); }
    else if (e.key === '-') { zoomAt(innerWidth / 2, innerHeight / 2, scale / 1.4); animApply(); }
  });

  window.addEventListener('resize', () => { if (isOpen) { computeFit(); clampT(); applyTransform(); } });

  // ---------- buttons ----------

  vBack.onclick = () => history.back();
  vPrevBtn.onclick = prev;
  vNextBtn.onclick = next;
  vInfoBtn.onclick = () => { const r = cur(); if (r) App.openInfoSheet(r.id); };
  vEditBtn.onclick = () => { const r = cur(); if (r) Editor.open(r.id); };
  vMoveBtn.onclick = () => { const r = cur(); if (r) App.openMoveSheet(r.id, updateChrome); };
  vSaveBtn.onclick = () => { const r = cur(); if (r) App.downloadPhoto(r.id); };
  vDeleteBtn.onclick = async () => {
    const r = cur();
    if (!r) return;
    const deleted = await App.confirmDelete(r.id);
    if (!deleted) return;
    ids.splice(idx, 1);
    if (!ids.length) { history.back(); return; }
    if (idx >= ids.length) idx = ids.length - 1;
    show();
  };

  window.Viewer = {
    open,
    isOpen: () => isOpen,
    currentId: () => (isOpen ? ids[idx] : null),
    refreshCurrent() {
      if (!isOpen) return;
      const rec = cur();
      if (!rec) { history.back(); return; }
      show();
    },
    refreshChrome() { if (isOpen) updateChrome(); },
  };
})();
