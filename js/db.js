// SnapSort — IndexedDB storage. Everything (photos, thumbnails, AI model
// files, label embeddings) is stored locally in the browser.
(() => {
  const NAME = 'snapsort-db';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');       // original backups
        if (!db.objectStoreNames.contains('modelcache')) db.createObjectStore('modelcache'); // AI model files
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB failed to open'));
    });
    return dbPromise;
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(name, mode) {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  window.DB = {
    async getAllPhotos() { return promisify((await store('photos', 'readonly')).getAll()); },
    async putPhoto(p)    { return promisify((await store('photos', 'readwrite')).put(p)); },
    async deletePhoto(id){ return promisify((await store('photos', 'readwrite')).delete(id)); },

    async getMeta(key)   { return promisify((await store('meta', 'readonly')).get(key)); },
    async setMeta(obj)   { return promisify((await store('meta', 'readwrite')).put(obj)); },

    async fileGet(key)        { return promisify((await store('files', 'readonly')).get(key)); },
    async filePut(key, blob)  { return promisify((await store('files', 'readwrite')).put(blob, key)); },
    async fileDel(key)        { return promisify((await store('files', 'readwrite')).delete(key)); },

    async cacheGet(key)       { return promisify((await store('modelcache', 'readonly')).get(key)); },
    async cachePut(key, blob) { return promisify((await store('modelcache', 'readwrite')).put(blob, key)); },
  };
})();
