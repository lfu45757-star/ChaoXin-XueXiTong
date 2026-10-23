// Official public asset parser/output rules, intercepted disposable browser only.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const source = 'https://mooc1.chaoxing.com/mooc-ans/mooc2/js/editor/ueditor.all.min.js?v=2026-0921-1215';
const assetPath = join(root, '../extension-research/chaoxing-ueditor-2026-0921-1215.js');
const expectedSha256 = '6d94b4efd20950b7808f0b445fdc00c95e00ca95db501694850f77c84efba97e';
const results = [], skipped = [];
let official;
try { official = await readFile(assetPath, 'utf8'); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  skipped.push('Official public UEditor asset is not bundled; retain/download the identified asset in extension-research to run its actual rules.');
}
if (official) {
  assert.equal(createHash('sha256').update(official).digest('hex'), expectedSha256);
  // Extract the exact official show function, not a rewritten approximation.
  const ast = require('@babel/parser').parse(official);
  let showSource;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectProperty' && node.key?.name === 'show' && node.loc.start.line === 8069) showSource = official.slice(node.value.start, node.value.end);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && value.type) visit(value);
    }
  };
  visit(ast); assert.ok(showSource);
  let executablePath;
  for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  if (!executablePath) throw Error('No disposable fixture browser found');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: new URL(route.request().url()).pathname === '/ueditor-body' ? '<body contenteditable="true"></body>' :
      '<!doctype html><body><div class="singleQuesId"><input id="answertype1" type="hidden" value="4"><div class="Zy_TItle">编写程序。</div><div class="blankItemDiv"><textarea style="display:none"></textarea><iframe src="/ueditor-body"></iframe></div></div></body>' }));
    await page.goto('https://mooc1.chaoxing.com/ueditor-fixture');
    await page.addScriptTag({ content: official });
    await page.addScriptTag({ content: `window.officialCodeToolShow = ${showSource};` });
    await page.addScriptTag({ content: await readFile(join(root, 'extension/adapter.js'), 'utf8') });
    await page.evaluate(() => {
      // Register the unmodified real code plugins. The UI-ready callbacks are
      // intentionally not run; getContent/parser/filter functions are real.
      window.$ = () => ({ on() {} });
      window.fixtureEditor = { body: document.querySelector('iframe').contentDocument.body, document: document.querySelector('iframe').contentDocument,
        commands: {}, options: {}, inputRules: [], outputRules: [], ready() {}, addListener() {}, queryCommandState() {}, hasContents: () => true, fireEvent() {} };
      for (const name of ['setOpt', 'addInputRule', 'addOutputRule', 'filterInputRule', 'filterOutputRule', 'getContent']) fixtureEditor[name] = UE.Editor.prototype[name];
      UE.plugins.defaultfilter.call(fixtureEditor);
      UE.plugins.insertcode.call(fixtureEditor);
      UE.plugins.insertcodedefined.call(fixtureEditor);
      window.testToolbar = pre => {
        const resizer = document.createElement('div');
        resizer.innerHTML = '<div class="now-lang"><span></span></div><div class="linebreak"><span></span></div><div class="langList"></div><input class="dataSearch_input"><div class="langList-wrap"></div>';
        let attached = false;
        officialCodeToolShow.call({ resizer, codeList: ['Plain Text', 'Python'], attachTo: target => { attached = target === pre; } }, pre);
        return { attached, lang: resizer.querySelector('.now-lang span').innerText };
      };
    });
    assert.equal(await page.evaluate(() => fixtureEditor.outputRules.length), 2);
    await assert.rejects(() => page.evaluate(() => { const pre = document.createElement('pre'); pre.textContent = 'x'; testToolbar(pre); }), /getAttribute/);
    results.push('Exact official codeTool.show reproduces null.getAttribute for bare PRE; actual default/old/new code filters and getContent are registered');

    const code = 'for n in range(2, 101):\n    prime = True\n    for d in range(2, n):\n        if n % d == 0:\n            prime = False\n    print(n, prime)';
    for (const value of [code, 'if True:\n\tprint("<script>literal</script>")\n\n    print("<img src=x>")', '    return 2  ']) {
      await page.evaluate(value => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: [value] }]), value);
      assert.equal(await page.locator('textarea').inputValue(), value);
      const frame = page.frames().find(frame => frame.url().endsWith('/ueditor-body'));
      assert.equal(await frame.locator('pre > code[lang="Plain Text"].language-plain').count(), 1);
      assert.equal(await frame.locator('body').innerText(), value);
      assert.deepEqual(await page.evaluate(() => testToolbar(fixtureEditor.body.querySelector('pre'))), { attached: true, lang: 'Plain Text' });
      const saved = await page.evaluate(() => fixtureEditor.getContent());
      assert.ok(saved.includes('<code')); assert.ok(saved.includes('lang="Plain Text"'));
      await frame.evaluate(saved => { document.body.innerHTML = saved; }, saved);
      assert.equal((await frame.locator('body').innerText()).replace(/\u00a0/g, ' '), value);
      assert.equal(await frame.locator('script,img').count(), 0);
      // A second save uses the same official parser/output rules and does not
      // erase the CODE child or its internal blank lines and indentation.
      const savedAgain = await page.evaluate(() => fixtureEditor.getContent());
      await frame.evaluate(saved => { document.body.innerHTML = saved; }, savedAgain);
      assert.equal((await frame.locator('body').innerText()).replace(/\u00a0/g, ' '), value);
      assert.equal(await page.locator('textarea').inputValue(), value);
    }
    results.push('Safe PRE>CODE fixes exact official toolbar method and preserves six-line Python, internal blank lines, tabs/indentation through two actual getContent saves');
    results.push('Answer HTML remains literal after official saves/reload; hidden textarea retains original raw code');

    // Record the library limitation accurately: its HTML parser normalizes
    // pure newlines adjacent to opening/closing tags; no invented workaround.
    await page.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: ['\n\nprint(1)\n'] }]));
    const boundary = await page.evaluate(() => fixtureEditor.getContent());
    const recovered = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent, boundary);
    assert.equal(recovered, 'print(1)');
    assert.equal(await page.locator('textarea').inputValue(), '\n\nprint(1)\n');
    results.push('Official parser boundary-blank-line normalization is explicit; raw textarea stays exact, internal code line breaks are preserved');
    await page.close();
  } finally { await browser.close(); }
}
const result = { at: new Date().toISOString(), passed: results.length, source, sha256: expectedSha256, results, skipped,
  scope: 'Fully intercepted disposable browser, exact official parser + default/code-plugin rules + toolbar show; UI lifecycle/ajax submission not exercised.' };
await writeFile(join(root, 'test/ueditor-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
