// SnapSort backend bridge.
// Loads supabase-js from the CDN only when a project is configured in
// js/config.js. When unconfigured, offline, or on file:// without network,
// every social feature reports "unavailable" and the solo app is untouched.
(() => {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  let client = null;
  let sdkPromise = null;

  function configured() {
    const c = window.SNAPSORT_CONFIG;
    return !!(c && c.supabaseUrl && c.supabaseAnonKey);
  }

  function loadSdk() {
    if (window.supabase) return Promise.resolve();
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SDK_URL;
        s.onload = resolve;
        s.onerror = () => {
          sdkPromise = null; // allow a retry on the next call
          reject(new Error('Could not load the Supabase library'));
        };
        document.head.append(s);
      });
    }
    return sdkPromise;
  }

  // Resolves to the shared client, or null when social features can't run.
  async function getClient() {
    if (!configured()) return null;
    if (client) return client;
    try {
      await loadSdk();
      client = window.supabase.createClient(
        window.SNAPSORT_CONFIG.supabaseUrl,
        window.SNAPSORT_CONFIG.supabaseAnonKey
      );
    } catch (e) {
      client = null;
    }
    return client;
  }

  window.Backend = { configured, getClient };
})();
