// SnapSort — photo editor: crop (drag handles), rotate, flip, and
// brightness / contrast / saturation adjustments. Saves a new copy and keeps
// the original so edits can always be reverted.
(() => {
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const eCancel = $('eCancel');
  const eSave = $('eSave');
  const eWrap = $('eWrap');
  const eHolder = $('eHolder');
  const eCanvas = $('eCanvas');
  const eCropBox = $('eCropBox');
  const eTabCrop = $('eTabCrop');
  const eTabAdjust = $('eTabAdjust');
  const ePanelCrop = $('ePanelCrop');
  const ePanelAdjust = $('ePanelAdjust');
  const eRotL = $('eRotL');
  const eRotR = $('eRotR');
  const eFlip = $('eFlip');
  const eCropReset = $('eCropReset');
  const eBright = $('eBright');
  const eContrast = $('eContrast');
  const eSat = $('eSat');
  const eBrightVal = $('eBrightVal');
  const eContrastVal = $('eContrastVal');
  const eSatVal = $('eSatVal');
  const eAdjReset = $('eAdjReset');
  const eRevert = $('eRevert');

  const MAX_PIXELS = 16000000; // stay under mobile canvas limits

  let pid = null;
  let img = null;
  let isOpen = false;
  let rot = 0;            // 0 / 90 / 180 / 270
  let flipH = false;
  let baseW = 0, baseH = 0;   // image size after rotation
  let dispScale = 1;          // base px -> screen px
  let crop = null;            // {x,y,w,h} in base coords
  let filt = { b: 100, c: 100, s: 100 };
  let dirty = false;

  // ---------- open / close ----------

  async function open(id) {
    const rec = App.getPhoto(id);
    if (!rec) return;
    pid = id;
    rot = 0; flipH = false;
    filt = { b: 100, c: 100, s: 100 };
    dirty = false;

    img = new Image();
    img.src = App.urlFor(rec, 'full');
    try { await img.decode(); } catch (e) { /* checked below */ }
    if (!img.naturalWidth) { App.toast('⚠️ Could not open the editor for this photo'); return; }

    isOpen = true;
    editor.hidden = false;
    document.body.classList.add('no-scroll', 'has-overlay');
    eRevert.hidden = !rec.edited;
    setTab('crop');
    syncSliders();
    requestAnimationFrame(() => { layout(); resetCrop(); });
    App.pushOverlay('editor', hide);
  }

  function hide() {
    isOpen = false;
    editor.hidden = true;
    img = null;
    if (!Viewer.isOpen()) document.body.classList.remove('no-scroll', 'has-overlay');
  }

  eCancel.onclick = () => history.back();

  // ---------- layout & preview ----------

  function layout() {
    if (!img) return;
    baseW = rot % 180 ? img.naturalHeight : img.naturalWidth;
    baseH = rot % 180 ? img.naturalWidth : img.naturalHeight;
    const rect = eWrap.getBoundingClientRect();
    dispScale = Math.min((rect.width - 24) / baseW, (rect.height - 24) / baseH, 1);
    if (!isFinite(dispScale) || dispScale <= 0) dispScale = 0.01;
    const cw = Math.max(1, Math.round(baseW * dispScale));
    const ch = Math.max(1, Math.round(baseH * dispScale));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    eCanvas.width = Math.max(1, Math.round(cw * dpr));
    eCanvas.height = Math.max(1, Math.round(ch * dpr));
    eCanvas.style.width = cw + 'px';
    eCanvas.style.height = ch + 'px';
    eHolder.style.width = cw + 'px';
    eHolder.style.height = ch + 'px';
    drawBase(eCanvas.getContext('2d'), eCanvas.width / baseW);
    eCanvas.style.filter = cssFilter();
  }

  // Draws the rotated/flipped image scaled by s into a canvas of baseW*s × baseH*s.
  function drawBase(ctx, s) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.translate((baseW * s) / 2, (baseH * s) / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, 1);
    ctx.drawImage(img, (-w0 * s) / 2, (-h0 * s) / 2, w0 * s, h0 * s);
    ctx.restore();
  }

  function cssFilter() {
    return 'brightness(' + filt.b / 100 + ') contrast(' + filt.c / 100 + ') saturate(' + filt.s / 100 + ')';
  }

  function filtersActive() { return filt.b !== 100 || filt.c !== 100 || filt.s !== 100; }

  function cropIsFull() {
    return crop && Math.abs(crop.x) < 1 && Math.abs(crop.y) < 1 &&
      Math.abs(crop.w - baseW) < 1 && Math.abs(crop.h - baseH) < 1;
  }

  function isNoop() { return rot === 0 && !flipH && !filtersActive() && cropIsFull(); }

  // ---------- crop box ----------

  function resetCrop() {
    crop = { x: 0, y: 0, w: baseW, h: baseH };
    updateCropBox();
  }

  function updateCropBox() {
    if (!crop) return;
    eCropBox.style.left = crop.x * dispScale + 'px';
    eCropBox.style.top = crop.y * dispScale + 'px';
    eCropBox.style.width = crop.w * dispScale + 'px';
    eCropBox.style.height = crop.h * dispScale + 'px';
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let act = null;

  eCropBox.addEventListener('pointerdown', (e) => {
    const h = (e.target.dataset && e.target.dataset.h) || 'move';
    act = { h, sx: e.clientX, sy: e.clientY, r: Object.assign({}, crop) };
    eCropBox.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  eCropBox.addEventListener('pointermove', (e) => {
    if (!act) return;
    const dx = (e.clientX - act.sx) / dispScale;
    const dy = (e.clientY - act.sy) / dispScale;
    const min = Math.max(24 / dispScale, 8);
    const r = act.r;
    let { x, y, w, h } = crop;

    if (act.h === 'move') {
      x = clamp(r.x + dx, 0, baseW - r.w);
      y = clamp(r.y + dy, 0, baseH - r.h);
      w = r.w; h = r.h;
    } else {
      x = r.x; y = r.y; w = r.w; h = r.h;
      if (act.h.includes('w')) {
        const nx = clamp(r.x + dx, 0, r.x + r.w - min);
        w = r.x + r.w - nx; x = nx;
      }
      if (act.h.includes('e')) {
        w = clamp(r.w + dx, min, baseW - r.x);
      }
      if (act.h.includes('n')) {
        const ny = clamp(r.y + dy, 0, r.y + r.h - min);
        h = r.y + r.h - ny; y = ny;
      }
      if (act.h.includes('s')) {
        h = clamp(r.h + dy, min, baseH - r.y);
      }
    }
    crop = { x, y, w, h };
    dirty = true;
    updateCropBox();
  });

  const endCrop = () => { act = null; };
  eCropBox.addEventListener('pointerup', endCrop);
  eCropBox.addEventListener('pointercancel', endCrop);

  // ---------- controls ----------

  function setTab(name) {
    editor.dataset.tab = name;
    eTabCrop.classList.toggle('active', name === 'crop');
    eTabAdjust.classList.toggle('active', name === 'adjust');
    ePanelCrop.hidden = name !== 'crop';
    ePanelAdjust.hidden = name !== 'adjust';
  }
  eTabCrop.onclick = () => setTab('crop');
  eTabAdjust.onclick = () => setTab('adjust');

  eRotL.onclick = () => { rot = (rot + 270) % 360; dirty = true; layout(); resetCrop(); };
  eRotR.onclick = () => { rot = (rot + 90) % 360; dirty = true; layout(); resetCrop(); };
  eFlip.onclick = () => { flipH = !flipH; dirty = true; layout(); updateCropBox(); };
  eCropReset.onclick = () => resetCrop();

  function syncSliders() {
    eBright.value = String(filt.b);
    eContrast.value = String(filt.c);
    eSat.value = String(filt.s);
    eBrightVal.textContent = filt.b + '%';
    eContrastVal.textContent = filt.c + '%';
    eSatVal.textContent = filt.s + '%';
  }

  function onSlider() {
    filt.b = +eBright.value;
    filt.c = +eContrast.value;
    filt.s = +eSat.value;
    dirty = true;
    syncSliders();
    eCanvas.style.filter = cssFilter();
  }
  eBright.addEventListener('input', onSlider);
  eContrast.addEventListener('input', onSlider);
  eSat.addEventListener('input', onSlider);
  eAdjReset.onclick = () => { filt = { b: 100, c: 100, s: 100 }; syncSliders(); eCanvas.style.filter = cssFilter(); };

  window.addEventListener('resize', () => { if (isOpen) { layout(); updateCropBox(); } });

  // ---------- saving ----------

  let filterSupport = null;
  function ctxFilterSupported() {
    if (filterSupport === null) {
      const c = document.createElement('canvas').getContext('2d');
      c.filter = 'brightness(1.5)';
      filterSupport = c.filter === 'brightness(1.5)';
    }
    return filterSupport;
  }

  function applyFiltersPixels(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h);
    const p = d.data;
    const b = filt.b / 100, c = filt.c / 100, s = filt.s / 100;
    for (let i = 0; i < p.length; i += 4) {
      let r = p[i] * b, g = p[i + 1] * b, bl = p[i + 2] * b;
      r = (r - 128) * c + 128;
      g = (g - 128) * c + 128;
      bl = (bl - 128) * c + 128;
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      p[i] = gray + (r - gray) * s;
      p[i + 1] = gray + (g - gray) * s;
      p[i + 2] = gray + (bl - gray) * s;
    }
    ctx.putImageData(d, 0, 0);
  }

  async function renderFull() {
    // Downscale very large photos so canvases stay within mobile limits.
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (baseW * baseH)));
    const bw = Math.max(1, Math.round(baseW * k));
    const bh = Math.max(1, Math.round(baseH * k));
    const base = document.createElement('canvas');
    base.width = bw;
    base.height = bh;
    drawBase(base.getContext('2d'), bw / baseW);

    const cx = clamp(Math.round(crop.x * k), 0, bw - 1);
    const cy = clamp(Math.round(crop.y * k), 0, bh - 1);
    const cw = clamp(Math.round(crop.w * k), 1, bw - cx);
    const ch = clamp(Math.round(crop.h * k), 1, bh - cy);

    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext('2d');
    const needF = filtersActive();
    if (needF && ctxFilterSupported()) ctx.filter = cssFilter();
    ctx.drawImage(base, cx, cy, cw, ch, 0, 0, cw, ch);
    if (needF && !ctxFilterSupported()) applyFiltersPixels(ctx, cw, ch);

    const rec = App.getPhoto(pid);
    const mime = (rec && (rec.type === 'image/png' || rec.type === 'image/webp')) ? rec.type : 'image/jpeg';
    return new Promise((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export image'))), mime, 0.92);
    });
  }

  eSave.onclick = async () => {
    if (!isOpen) return;
    if (!dirty || isNoop()) { history.back(); return; }
    eSave.disabled = true;
    eSave.textContent = 'Saving…';
    try {
      const blob = await renderFull();
      await App.applyEdit(pid, blob);
      history.back();
      Viewer.refreshCurrent();
    } catch (err) {
      console.error(err);
      App.toast('⚠️ Saving failed');
    } finally {
      eSave.disabled = false;
      eSave.textContent = 'Save';
    }
  };

  eRevert.onclick = async () => {
    const ok = await App.confirm('Restore the original photo? Your saved edits will be removed.', 'Restore');
    if (!ok) return;
    const done = await App.revertEdit(pid);
    if (done) { history.back(); Viewer.refreshCurrent(); }
  };

  window.Editor = { open, isOpen: () => isOpen };
})();
