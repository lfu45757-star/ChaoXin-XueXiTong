// Parse inert Parcel data only. Never import/evaluate the extension bundle.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { parse } = require('@babel/parser');
const sourcePath = join(base, '../extension-research/daxuesoutijiang-edge/SideBar.d70b0916.js');
const libraryPath = join(base, '../extension-research/daxuesoutijiang-edge/lib/TyprMd5.js');
const bytes = await readFile(sourcePath), source = bytes.toString('utf8');
const ast = parse(source, { sourceType: 'unambiguous', errorRecovery: true });
let module;
function walk(node) {
  if (!node || typeof node !== 'object' || module) return;
  if (node.type === 'ObjectProperty' && node.value?.type === 'ArrayExpression') {
    if (String(node.key.name ?? node.key.value) === '3ErB5') module = node;
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
}
walk(ast);
if (!module) throw new Error('Glyph data module 3ErB5 not found');
const fn = module.value.elements[0];
const object = fn.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
  .find(node => node.init?.type === 'ObjectExpression')?.init;
if (!object) throw new Error('Glyph table literal not found');
const table = {}, metadata = {};
for (const property of object.properties) {
  const key = String(property.key?.name ?? property.key?.value);
  if (property.value?.type === 'NumericLiteral' && /^[a-f0-9]{8}$/.test(key) && property.value.value >= 19968 && property.value.value < 40870) table[key] = property.value.value;
  else if (['author', 'namespace', 'license', 'version'].includes(key) && property.value?.type === 'StringLiteral') metadata[key] = property.value.value;
  else throw new Error(`Unexpected glyph data property: ${key}`);
}
if (Object.keys(table).length !== 20902 || new Set(Object.values(table)).size !== 20902 || metadata.license !== 'MIT') throw new Error('Unexpected glyph coverage/license');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const library = await readFile(libraryPath);
const mapJson = JSON.stringify(table);
const mapSource = `/* Glyph hash data: ${metadata.author}, ${metadata.namespace}; MIT; version ${metadata.version}.\n * Extracted as inert data from Parcel module 3ErB5; see font-assets.json and THIRD_PARTY_LICENSES.md. */\nglobalThis.ChaoxingGlyphMap = Object.freeze(${mapJson});\n`;
const out = join(base, 'extension/vendor');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'typr-md5.js'), library);
await writeFile(join(out, 'cx-glyph-map.js'), mapSource);
await writeFile(join(out, 'font-assets.json'), JSON.stringify({
  extraction: 'Babel AST literal extraction; no third-party extension logic executed',
  table: { source: '../extension-research/daxuesoutijiang-edge/SideBar.d70b0916.js', sourceSha256: sha256(bytes), module: '3ErB5', start: module.start, end: module.end,
    offsets: 'zero-based UTF-16 offsets, end exclusive', entries: Object.keys(table).length, metadata, dataSha256: sha256(mapJson), shippedSha256: sha256(mapSource) },
  library: { source: '../extension-research/daxuesoutijiang-edge/lib/TyprMd5.js', shippedFile: 'typr-md5.js', sha256: sha256(library), unchanged: true,
    upstream: ['https://github.com/photopea/Typr.js/blob/15aa12ffa6cf39e8788562ea4af65b42317375fb/src/Typr.min.js',
      'https://github.com/photopea/Typr.js/blob/f4fcdeb8014edc75ab7296bd85ac9cde8cb30489/src/Typr.U.min.js',
      'https://github.com/blueimp/JavaScript-MD5/blob/v2.19.0/js/md5.min.js'],
    usage: 'Only parse, codeToGlyph, glyphToPath, and MD5. initHB is never called.' }
}, null, 2));
console.log(JSON.stringify({ entries: Object.keys(table).length, librarySha256: sha256(library), mapSha256: sha256(mapSource) }));
