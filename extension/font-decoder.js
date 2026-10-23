/* Local glyph recognition. No page mutation, network, font replacement, or initHB. */
(() => {
  const fontCache = new Map(), documentFaces = new WeakMap();
  const family = name => name.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
  const families = value => value.split(',').map(family);
  const cjk = character => /\p{Unified_Ideograph}/u.test(character);
  function embeddedFont(source) {
    for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const url = (match[1] ?? match[2] ?? match[3]).trim();
      const data = url.match(/^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!data) continue;
      const base64 = data[1].replace(/\s/g, '');
      if (!base64 || base64.length > 12 * 1024 * 1024) continue;
      if (fontCache.has(base64)) return fontCache.get(base64);
      const record = { glyphs: new Map(), font: null };
      try {
        const binary = atob(base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const magic = String.fromCharCode(...bytes.slice(0, 4));
        if (magic !== '\x00\x01\x00\x00' && magic !== 'OTTO' && magic !== 'ttcf') throw new Error('Unsupported embedded font');
        record.font = globalThis.Typr.parse(bytes.buffer)[0];
      } catch { /* Unknown/corrupt font remains unresolved. */ }
      if (fontCache.size >= 4) fontCache.delete(fontCache.keys().next().value);
      fontCache.set(base64, record);
      return record;
    }
    return null;
  }
  function prepare(doc = document) {
    const faces = new Map();
    if (!globalThis.Typr?.U || typeof globalThis.md5 !== 'function' || !globalThis.ChaoxingGlyphMap) {
      documentFaces.set(doc, faces); return;
    }
    if (!doc.querySelector('.font-cxsecret')) { documentFaces.set(doc, faces); return; }
    const needed = new Set();
    for (const element of doc.querySelectorAll('.font-cxsecret, .font-cxsecret *')) {
      for (const name of families(doc.defaultView.getComputedStyle(element).fontFamily)) needed.add(name);
    }
    const visit = rules => {
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const name = family(rule.style.getPropertyValue('font-family'));
          if (!needed.has(name)) continue;
          const record = embeddedFont(rule.style.getPropertyValue('src'));
          if (record) { if (!faces.has(name)) faces.set(name, []); faces.get(name).push(record); }
        } else {
          try { if (rule.cssRules) visit(rule.cssRules); } catch {}
        }
      }
    };
    for (const sheet of doc.styleSheets) { try { visit(sheet.cssRules); } catch {} }
    documentFaces.set(doc, faces);
  }
  function glyph(record, code) {
    if (record.glyphs.has(code)) return record.glyphs.get(code);
    let value = null;
    try {
      if (record.font) {
        const id = globalThis.Typr.U.codeToGlyph(record.font, code);
        // These subset fonts omit ordinary characters: the browser displays
        // those with its normal fallback font, so they must stay unchanged.
        if (!id) value = String.fromCodePoint(code);
        else {
          const path = globalThis.Typr.U.glyphToPath(record.font, id);
          if (path.cmds?.length && path.crds?.length) {
            const hash = globalThis.md5(JSON.stringify(path)).slice(-8);
            const decoded = globalThis.ChaoxingGlyphMap[hash];
            if (Number.isInteger(decoded) && decoded >= 19968 && decoded < 40870) value = String.fromCodePoint(decoded);
          }
        }
      }
    } catch { /* A missing glyph never falls back to guessing. */ }
    record.glyphs.set(code, value); return value;
  }
  function read(node) {
    const original = node?.nodeValue || '';
    const parent = node?.parentElement;
    if (!parent?.closest('.font-cxsecret')) return { text: original, unresolved: false };
    const faces = documentFaces.get(node.ownerDocument);
    const names = families(node.ownerDocument.defaultView.getComputedStyle(parent).fontFamily);
    const records = names.map(name => faces?.get(name)).find(Boolean) || [];
    let unresolved = false;
    const text = [...original].map(character => {
      if (!cjk(character)) return character;
      const candidates = records.map(record => glyph(record, character.codePointAt(0)));
      const values = new Set(candidates);
      if (!candidates.length || candidates.some(value => value === null) || values.size !== 1) { unresolved = true; return character; }
      return [...values][0];
    }).join('');
    return { text, unresolved };
  }
  globalThis.ChaoxingFontDecoder = Object.freeze({ prepare, read });
})();
