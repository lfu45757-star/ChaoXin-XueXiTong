/* Isolated-world transport. Calling the site callback is never completion proof. */
(() => {
  const allowed = url => url.protocol === 'https:' && /(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname);
  const attempts = new Map();
  async function finishViewedDocument(key) {
    if (attempts.has(key)) return attempts.get(key);
    const attempt = new Promise(resolve => {
      let parent;
      try { parent = new URL(document.referrer); } catch { resolve({ status: 'not-supported' }); return; }
      if (window === window.parent || !allowed(new URL(location.href)) || !allowed(parent)) {
        resolve({ status: 'not-supported' }); return;
      }
      const id = crypto.randomUUID();
      const onMessage = event => {
        const data = event.data;
        if (event.source !== window.parent || event.origin !== parent.origin || !data || data.type !== 'cx-agent:pdf-result' ||
            data.version !== 1 || data.id !== id || !['invoked', 'unavailable', 'error'].includes(data.status) ||
            Object.keys(data).sort().join(',') !== 'id,status,type,version') return;
        clearTimeout(timer); window.removeEventListener('message', onMessage); resolve({ status: data.status });
      };
      const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve({ status: 'timeout' }); }, 4000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage({ type: 'cx-agent:pdf-finish', version: 1, id }, parent.origin);
    });
    attempts.set(key, attempt);
    return attempt;
  }
  globalThis.ChaoxingDocumentBridge = Object.freeze({ finishViewedDocument });
})();
