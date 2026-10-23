/* Scroll only the document page's containing readers, then confirm a stable bottom. */
(() => {
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  function containers(page) {
    const root = document.scrollingElement || document.documentElement;
    const targets = [];
    for (let node = page; node && node !== root; node = node.parentElement) {
      if (node.clientHeight > 0 && /^(auto|scroll|overlay|hidden)$/.test(getComputedStyle(node).overflowY) &&
          node.scrollHeight > node.clientHeight + 1) targets.push(node);
    }
    if (root && !targets.includes(root)) targets.push(root);
    return targets;
  }
  function pendingImages(page) {
    return [...page.querySelectorAll('img[src],img[srcset]')].some(image => !image.complete);
  }
  async function settleBottom(page, { active, stableMs = 800, maxMs = 6000, intervalMs = 150 } = {}) {
    if (typeof active !== 'function') throw new Error('Missing document lifecycle check');
    const deadline = Date.now() + maxMs;
    let geometry = '', stableSince = 0, previousTargets = [];
    while (Date.now() < deadline) {
      if (!page?.isConnected || !(await active())) return { status: 'cancelled' };
      const targets = containers(page);
      for (const node of targets) {
        if (!node.isConnected || !(await active())) return { status: 'cancelled' };
        // Real browser scrolls fire the reader's normal scroll listeners. A
        // footer or padding after the last page must also enter the viewport.
        node.scrollTo({ top: node.scrollHeight, left: node.scrollLeft, behavior: 'instant' });
      }
      await pause(intervalMs);
      if (!page.isConnected || !(await active())) return { status: 'cancelled' };
      const currentTargets = containers(page);
      const dimensions = currentTargets.map(node => [node.scrollHeight, node.clientHeight, Math.round(node.scrollTop)]);
      const atBottom = dimensions.every(([height, viewport, position]) => height - viewport - position <= 2);
      const nextGeometry = JSON.stringify(dimensions);
      const sameTargets = currentTargets.length === previousTargets.length && currentTargets.every((node, index) => node === previousTargets[index]);
      if (!atBottom || pendingImages(page) || !sameTargets || nextGeometry !== geometry) stableSince = Date.now();
      else if (Date.now() - stableSince >= stableMs) return { status: 'bottom', containers: currentTargets.length };
      geometry = nextGeometry; previousTargets = currentTargets;
    }
    return { status: 'unstable' };
  }
  globalThis.ChaoxingDocumentScroller = Object.freeze({ settleBottom });
})();
