/* Runs only in the native PDF module's MAIN world. No extension APIs. */
(() => {
  const allowed = url => url.protocol === 'https:' && /(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname);
  if (!allowed(new URL(location.href)) || !/^\/ananas\/modules\/pdf\//.test(location.pathname)) return;
  const requests = new WeakMap();
  const watched = new WeakSet();
  const valid = data => data && data.type === 'cx-agent:pdf-finish' && data.version === 1 &&
    typeof data.id === 'string' && /^[a-f0-9-]{36}$/.test(data.id) && Object.keys(data).sort().join(',') === 'id,type,version';
  window.addEventListener('message', async event => {
    if (!valid(event.data)) return;
    const viewer = document.querySelector('iframe#panView');
    if (!viewer || event.source !== viewer.contentWindow) return;
    if (!watched.has(viewer)) {
      watched.add(viewer);
      viewer.addEventListener('load', () => requests.delete(viewer.contentWindow));
    }
    let url;
    try { url = new URL(viewer.getAttribute('src'), location.href); } catch { return; }
    // The native /screen/file endpoint redirects the exact panView window to
    // pan-yz. The source window remains the same, but its origin changes.
    const redirectedViewer = url.origin === location.origin && url.pathname === '/mooc-ans/screen/file' &&
      event.origin === 'https://pan-yz.chaoxing.com';
    if (!allowed(url) || (event.origin !== url.origin && !redirectedViewer)) return;
    let attempt = requests.get(event.source);
    if (!attempt || attempt.url !== url.href) {
      // Store the attempt before invoking the callback, including async callbacks.
      attempt = { url: url.href, result: null };
      requests.set(event.source, attempt);
      attempt.result = (async () => {
        if (typeof window.finishJob !== 'function') return 'unavailable';
        try { await window.finishJob.call(window); return 'invoked'; } catch { return 'error'; }
      })();
    }
    const status = await attempt.result;
    // The viewer may have navigated while the normal site callback was running.
    let currentUrl;
    try { currentUrl = new URL(viewer.getAttribute('src'), location.href); } catch { return; }
    if (document.querySelector('iframe#panView') !== viewer || viewer.contentWindow !== event.source || currentUrl.href !== url.href) return;
    event.source.postMessage({ type: 'cx-agent:pdf-result', version: 1, id: event.data.id, status }, event.origin);
  });
})();
