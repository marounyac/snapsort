// SnapSort — AI classifier. Runs OpenAI's CLIP model fully in the browser via
// transformers.js (no server, no API key; photos never leave the device).
// Each photo is embedded once and compared against the text embeddings of all
// mini-categories; the best match wins.
(() => {
  const CDN_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  const MODEL_ID = 'Xenova/clip-vit-base-patch32';
  const LOGIT_SCALE = 100; // CLIP's trained temperature
  const EMBED_KEY = 'labelEmbeds:' + CATS.version;

  let TF = null;
  let processor = null;
  let visionModel = null;
  let labels = null; // { miniIds: string[], dim: number, mat: Float32Array }
  let readyPromise = null;

  async function loadLibrary() {
    const mod = await import(CDN_URL);
    mod.env.allowLocalModels = false;
    if (location.protocol === 'file:') {
      // The Cache API is unavailable on file:// — cache model files in
      // IndexedDB instead so the ~150 MB download happens only once.
      mod.env.useBrowserCache = false;
      mod.env.useCustomCache = true;
      mod.env.customCache = {
        async match(key) {
          try {
            const url = typeof key === 'string' ? key : key.url;
            const blob = await DB.cacheGet(url);
            if (!blob) return undefined;
            return new Response(blob, { headers: {
              'Content-Length': String(blob.size),
              'Content-Type': 'application/octet-stream',
            }});
          } catch (e) { return undefined; }
        },
        async put(key, response) {
          try {
            const url = typeof key === 'string' ? key : key.url;
            const blob = await response.blob();
            await DB.cachePut(url, blob);
          } catch (e) { /* cache write failure is non-fatal */ }
        },
      };
    }
    return mod;
  }

  // Aggregates per-file download events into one overall percentage.
  function makeProgressAggregator(cb) {
    const files = new Map();
    return (info) => {
      if (!info || !info.file) return;
      const key = (info.name || '') + '|' + info.file;
      if (info.status === 'progress') {
        files.set(key, { loaded: info.loaded || 0, total: info.total || 0 });
      } else if (info.status === 'done' && files.has(key)) {
        const f = files.get(key);
        f.loaded = f.total;
      } else {
        return;
      }
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      if (total > 0 && cb) cb(Math.min(99, Math.floor((loaded / total) * 100)));
    };
  }

  async function loadLabelEmbeds(agg) {
    try {
      const saved = await DB.getMeta(EMBED_KEY);
      if (saved && saved.mat && Array.isArray(saved.miniIds) &&
          saved.miniIds.join() === CATS.miniOrder.join()) {
        return { miniIds: saved.miniIds, dim: saved.dim, mat: new Float32Array(saved.mat) };
      }
    } catch (e) { /* recompute below */ }

    const prompts = [];
    const owners = [];
    for (const miniId of CATS.miniOrder) {
      for (const p of CATS.byMini[miniId].prompts) { prompts.push(p); owners.push(miniId); }
    }

    const tokenizer = await TF.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: agg });
    const textModel = await TF.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
      quantized: true, progress_callback: agg,
    });

    const inputs = tokenizer(prompts, { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    const n = text_embeds.dims[0];
    const dim = text_embeds.dims[1];
    const raw = text_embeds.data;

    // Normalize each prompt embedding, average per mini-category, re-normalize.
    const rowOf = new Map(CATS.miniOrder.map((id, i) => [id, i]));
    const mat = new Float32Array(CATS.miniOrder.length * dim);
    for (let i = 0; i < n; i++) {
      const off = i * dim;
      let norm = 0;
      for (let j = 0; j < dim; j++) norm += raw[off + j] * raw[off + j];
      norm = Math.sqrt(norm) || 1;
      const roff = rowOf.get(owners[i]) * dim;
      for (let j = 0; j < dim; j++) mat[roff + j] += raw[off + j] / norm;
    }
    for (let r = 0; r < CATS.miniOrder.length; r++) {
      const roff = r * dim;
      let norm = 0;
      for (let j = 0; j < dim; j++) norm += mat[roff + j] * mat[roff + j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dim; j++) mat[roff + j] /= norm;
    }

    try {
      await DB.setMeta({ key: EMBED_KEY, miniIds: CATS.miniOrder.slice(), dim, mat: mat.buffer.slice(0) });
    } catch (e) { /* fine — recompute next session */ }
    try { if (textModel.dispose) await textModel.dispose(); } catch (e) { /* ignore */ }

    return { miniIds: CATS.miniOrder.slice(), dim, mat };
  }

  async function init(onProgress) {
    const report = (pct) => { if (onProgress) onProgress(pct); };
    report(0);
    TF = await loadLibrary();
    const agg = makeProgressAggregator(report);
    const loaded = await Promise.all([
      TF.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: agg }),
      TF.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true, progress_callback: agg }),
    ]);
    processor = loaded[0];
    visionModel = loaded[1];
    labels = await loadLabelEmbeds(agg);
    report(100);
  }

  window.Classifier = {
    // Loads library + model (~150 MB, first time only) and label embeddings.
    ensureReady(onProgress) {
      if (!readyPromise) {
        readyPromise = init(onProgress).catch((e) => { readyPromise = null; throw e; });
      }
      return readyPromise;
    },

    isReady() { return !!(visionModel && labels); },

    // Returns the top-3 mini-categories: [{ miniId, p }, ...] sorted by probability.
    async classify(blob) {
      const image = await TF.RawImage.fromBlob(blob);
      const inputs = await processor(image);
      const out = await visionModel(inputs);
      const v = out.image_embeds.data;
      const dim = labels.dim;

      let norm = 0;
      for (let j = 0; j < dim; j++) norm += v[j] * v[j];
      norm = Math.sqrt(norm) || 1;

      const nMinis = labels.miniIds.length;
      const logits = new Array(nMinis);
      for (let r = 0; r < nMinis; r++) {
        const roff = r * dim;
        let dot = 0;
        for (let j = 0; j < dim; j++) dot += (v[j] / norm) * labels.mat[roff + j];
        logits[r] = dot * LOGIT_SCALE;
      }
      const mx = Math.max.apply(null, logits);
      let sum = 0;
      const exps = logits.map((l) => { const e = Math.exp(l - mx); sum += e; return e; });
      return labels.miniIds
        .map((id, i) => ({ miniId: id, p: exps[i] / sum }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 3);
    },
  };
})();
