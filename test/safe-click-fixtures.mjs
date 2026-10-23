// Disposable intercepted pages. Page CSP is real; this is not extension-CSP proof.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const adapter = await readFile(join(root, 'extension/adapter.js'), 'utf8');
const content = await readFile(join(root, 'extension/content.js'), 'utf8');
let executablePath;
for (const path of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(path); executablePath = path; break; } catch {}
}
if (!executablePath) throw Error('No disposable fixture browser found');
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
async function fixture(html, csp = false) {
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    const script = path === '/adapter.js' ? adapter : path === '/init.js' ? 'window.clicks=0;window.violations=[];document.addEventListener("securitypolicyviolation",e=>violations.push({directive:e.effectiveDirective,uri:e.blockedURI}));document.addEventListener("click",e=>{if(e.target.closest(".action"))clicks++;});' : null;
    return route.fulfill({ contentType: script === null ? 'text/html; charset=utf-8' : 'text/javascript',
      headers: csp ? { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'" } : {},
      body: script ?? '<!doctype html><body>' + html + '<script src="/adapter.js"></script><script src="/init.js"></script></body>' });
  });
  await page.goto('https://mooc1.chaoxing.com/work/click-fixture');
  return page;
}
try {
  const strict = await fixture('<a class="action" id="anchor" href="javascript:void(0)">执行<svg><g><path id="icon" d="M0 0h8v8z"></path></g></svg></a>', true);
  await strict.evaluate(() => document.getElementById('anchor').click());
  await strict.waitForFunction(() => violations.length > 0);
  assert.equal(await strict.evaluate(() => clicks), 1, 'a CSP violation does not prove the page click handler failed');
  const baseline = await strict.evaluate(() => violations.slice());
  await strict.evaluate(() => { clicks = 0; violations = []; });
  const noops = ['javascript:', 'javascript:;', 'javascript: ; ; ', 'javascript:void(0)', 'JaVaScRiPt: void ( 0 ) ;', 'java\nscript:\tvoid(0);'];
  for (const href of noops) {
    await strict.evaluate(href => { const node = document.getElementById('anchor'); node.setAttribute('href', href); ChaoxingAdapter.safeClick(node); }, href);
    assert.equal(await strict.locator('#anchor').getAttribute('href'), href);
  }
  await strict.evaluate(() => ChaoxingAdapter.safeClick(document.getElementById('icon')));
  assert.equal(await strict.evaluate(() => clicks), noops.length + 1);
  await strict.waitForTimeout(200);
  assert.deepEqual(await strict.evaluate(() => violations), []);
  results.push({ check: 'Real restrictive page CSP blocks the baseline JavaScript URL default; noop helper dispatches each handler once, restores exact href, and produces no page CSP violation, including nested SVG', baseline });
  for (const href of ['javascript:doSubmit()', 'java\nscript:doSubmit()', 'javascript:VOID(0)', 'javascript:void0', 'javascript:%76oid(0)']) {
    await strict.locator('#anchor').evaluate((node, href) => node.setAttribute('href', href), href);
    const before = await strict.evaluate(() => clicks);
    await assert.rejects(() => strict.evaluate(() => ChaoxingAdapter.safeClick(document.getElementById('icon'))), /非空 JavaScript/);
    assert.equal(await strict.evaluate(() => clicks), before);
    assert.equal(await strict.locator('#anchor').getAttribute('href'), href);
  }
  results.push({ check: 'Functional/unknown JavaScript URLs, including URL-parser control-character schemes, are refused before any handler and retain attributes' });
  await strict.close();

  const ordinary = await fixture('<a class="action" id="url" href="/ordinary?x=1">链接</a><button class="action" id="button">按钮</button><a class="action" id="changing" href="javascript:;">改链接</a><a id="throwing" href="javascript:;">异常</a><svg xmlns:xlink="http://www.w3.org/1999/xlink"><a class="action" id="svgLink" xlink:href="javascript:;"><g><path id="svgIcon" d="M0 0h8v8z"></path></g></a></svg>');
  await ordinary.evaluate(() => {
    document.getElementById('url').addEventListener('click', event => event.preventDefault());
    document.getElementById('changing').addEventListener('click', event => { event.preventDefault(); event.currentTarget.setAttribute('href', '/changed'); });
    document.getElementById('throwing').click = () => { throw Error('fixture dispatch failure'); };
    ChaoxingAdapter.safeClick(document.getElementById('url'));
    ChaoxingAdapter.safeClick(document.getElementById('button'));
    ChaoxingAdapter.safeClick(document.getElementById('changing'));
    ChaoxingAdapter.safeClick(document.getElementById('svgIcon'));
  });
  assert.equal(await ordinary.locator('#url').getAttribute('href'), '/ordinary?x=1');
  assert.equal(await ordinary.locator('#changing').getAttribute('href'), '/changed');
  assert.equal(await ordinary.locator('#svgLink').getAttribute('xlink:href'), 'javascript:;');
  assert.equal(await ordinary.evaluate(() => clicks), 4);
  await assert.rejects(() => ordinary.evaluate(() => ChaoxingAdapter.safeClick(document.getElementById('throwing'))), /fixture dispatch failure/);
  assert.equal(await ordinary.locator('#throwing').getAttribute('href'), 'javascript:;');
  results.push({ check: 'Ordinary URL/button dispatch remains normal; SVG xlink noops restore, finally restores on thrown dispatch and preserves handler-written replacement href' });
  await ordinary.close();

  const options = await fixture('<div class="singleQuesId"><div class="Zy_TItle">第一题</div><label><input type="radio" name="q1">A、甲</label><label><input type="radio" name="q1">B、乙</label></div><div class="singleQuesId"><div class="Zy_TItle">第二题</div><a class="before-after action" aria-checked="false" href="javascript:;">A、甲</a><a class="before-after action" aria-checked="false" href="javascript:submitOption()">B、乙</a></div>');
  await assert.rejects(() => options.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: ['A'] }, { id: '2', values: ['B'] }])), /非空 JavaScript/);
  assert.deepEqual(await options.locator('input').evaluateAll(nodes => nodes.map(node => node.checked)), [false, false]);
  assert.equal(await options.evaluate(() => clicks), 0);
  results.push({ check: 'All planned option clicks preflight before any question is changed; later unsupported href leaves earlier native radio unselected' });
  await options.close();

  async function runtime(page) {
    await page.evaluate(() => {
      window.records = {}; window.writes = []; window.events = []; window.submitClicks = 0; window.confirmClicks = 0;
      globalThis.chrome = { storage: { local: { get: async key => ({ [key]: records[key] }), set: async value => { writes.push(value); Object.assign(records, value); } } }, runtime: { sendMessage: async message => {
        if (message.type === 'state') return { ok: true, value: { enabled: true, config: { autoSubmit: true, confidence: .85, programmingLanguage: 'auto', nextSelector: '', completeSelector: '' } } };
        if (message.type === 'solve') return { ok: true, value: { answers: [{ id: '1', values: ['print(1)'], confidence: .99, explanation: 'fixture' }] } };
        if (message.type === 'claimTask') return { ok: true, value: { ok: true } };
        if (message.type === 'reports') return { ok: true, value: [] };
        if (message.type === 'report') window.lastReport = message.value;
        if (message.type === 'event') events.push(message.value);
        return { ok: true, value: { ok: true } };
      } } };
    });
    await page.addScriptTag({ content });
  }
  const question = '<div class="singleQuesId"><input id="answertype1" type="hidden" value="4"><div class="Zy_TItle">编程题</div><textarea></textarea></div>';
  const rejected = await fixture(question + '<a class="btnSubmit workBtnIndex" href="javascript:performSubmit()">提交</a>');
  await rejected.locator('.btnSubmit').evaluate(node => node.addEventListener('click', () => submitClicks++));
  await runtime(rejected);
  await rejected.waitForFunction(() => events.some(event => event.type === 'blocked'));
  assert.equal(await rejected.evaluate(() => submitClicks), 0);
  assert.equal(await rejected.evaluate(() => writes.some(value => Object.values(value).some(record => ['submitting', 'uncertain'].includes(record.stage)))), false);
  assert.equal(await rejected.evaluate(() => Object.values(records)[0].stage), 'filled');
  results.push({ check: 'Content preflights submit before remember(submitting): functional href causes no submit handler, submitting record, or uncertain record' });
  await rejected.close();

  const submit = await fixture(question + '<a class="btnSubmit workBtnIndex" href="javascript:void(0)">提交</a><div id="workpop" style="display:none">确认提交?<a id="popok" href="javascript:;">确定</a></div><span id="done"></span>');
  await submit.evaluate(() => {
    document.querySelector('.btnSubmit').addEventListener('click', () => { submitClicks++; document.getElementById('workpop').style.display = 'block'; });
    document.getElementById('popok').addEventListener('click', () => { confirmClicks++; document.getElementById('workpop').style.display = 'none'; document.getElementById('done').className = 'testTit_status_complete'; });
  });
  await runtime(submit);
  await submit.waitForFunction(() => Object.values(records).some(record => record.stage === 'submitted'));
  assert.deepEqual(await submit.evaluate(() => [submitClicks, confirmClicks]), [1, 1]);
  assert.equal(await submit.locator('.btnSubmit').getAttribute('href'), 'javascript:void(0)');
  assert.equal(await submit.locator('#popok').getAttribute('href'), 'javascript:;');
  results.push({ check: 'Content normal noop submit + workpop confirm runs each existing handler once, records successful receipt, and restores both href attributes' });
  await submit.close();
} finally { await browser.close(); }
const result = { at: new Date().toISOString(), passed: results.length, results,
  scope: 'Fully intercepted disposable pages, real document CSP and main-world adapter/transport simulation; no real extension CSP, live course actions, or model calls. Removing a noop href can affect href-dependent site selectors; no transparency claim for arbitrary handlers.' };
await writeFile(join(root, 'test/safe-click-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
