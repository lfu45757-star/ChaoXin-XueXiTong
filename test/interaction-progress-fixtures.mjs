// Intercepted disposable browser only; no live course, model, or submission.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const adapter = await readFile(join(root, 'extension/adapter.js'), 'utf8');
const content = await readFile(join(root, 'extension/content.js'), 'utf8');
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw Error('No disposable fixture browser found');
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
async function scenario(options = {}) {
  const page = await browser.newPage();
  const html = Array.from({ length: 3 }, (_, index) => `<div class="singleQuesId"><div class="Zy_TItle">【单选题】${index + 1}+0=?</div><label><input type="radio" name="q${index}" value="A">A. ${index + 1}</label><label><input type="radio" name="q${index}" value="B">B. 0</label></div>`).join('');
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://mooc1.chaoxing.com/progress-fixture');
  await page.evaluate(options => {
    window.enabled = false; window.reports = []; window.records = {}; window.solveCalls = 0; window.controls = [];
    const interval = window.setInterval;
    // A control event must update the page independently of periodic ticks.
    window.setInterval = (fn, ms, ...args) => interval(fn, ms === 3000 ? 60000 : ms, ...args);
    window.chrome = { storage: { local: { get: async key => ({ [key]: records[key] }), set: async value => Object.assign(records, value) } }, runtime: {
      onMessage: { addListener: callback => controls.push(callback) },
      sendMessage: async message => {
        if (message.type === 'state') return { ok: true, value: { enabled, config: { autoSubmit: false, confidence: .85, programmingLanguage: 'auto' } } };
        if (message.type === 'solve') {
          solveCalls++;
          await new Promise(resolve => setTimeout(resolve, 80));
          return { ok: true, value: { answers: [1, 2, 3].map(index => ({ id: String(index), values: [options.invalid && index === 3 ? 'Z' : 'A'], confidence: .99 })) } };
        }
        if (message.type === 'report') {
          reports.push({ ...message.value, selected: document.querySelectorAll('input:checked').length });
          if (options.stopAfterFirst && message.value.progress?.phase === 'verified' && message.value.progress.filled === 1) enabled = false;
        }
        if (message.type === 'reports') return { ok: true, value: [] };
        return { ok: true, value: { ok: true } };
      }
    } };
  }, options);
  await page.addScriptTag({ content: adapter });
  await page.addScriptTag({ content });
  await page.waitForFunction(() => reports.some(report => report.mode === 'idle'));
  await page.evaluate(() => { enabled = true; controls.forEach(callback => callback({ type: 'controlChanged' })); });
  await page.waitForFunction(() => solveCalls === 1, null, { timeout: 2000 });
  await page.evaluate(() => controls.forEach(callback => callback({ type: 'controlChanged' })));
  return page;
}
try {
  const complete = await scenario();
  await complete.waitForFunction(() => Object.values(records).some(record => record.stage === 'filled'), null, { timeout: 3000 });
  const progress = await complete.evaluate(() => reports.filter(report => report.progress?.phase === 'verified').map(report => [report.progress.filled, report.selected]));
  assert.deepEqual(progress.filter((value, index) => index === 0 || value[0] !== progress[index - 1][0]), [[1, 1], [2, 2], [3, 3]]);
  assert.equal(await complete.locator('[data-cx-agent-answer-progress]').count(), 3);
  assert.equal(await complete.evaluate(() => solveCalls), 1);
  results.push('Control message starts within 2s without polling; repeated controls do not duplicate solving; each verified question report matches its actual DOM state and has a visible Agent label');
  await complete.close();

  const stopped = await scenario({ stopAfterFirst: true });
  await stopped.waitForFunction(() => reports.some(report => report.progress?.filled === 1));
  await stopped.waitForTimeout(200);
  assert.equal(await stopped.locator('input:checked').count(), 1);
  assert.equal(await stopped.locator('[data-cx-agent-answer-progress]').count(), 1);
  assert.equal(await stopped.evaluate(() => Object.values(records).some(record => record.stage === 'filled')), false);
  results.push('Stopping after the first verified question prevents later answers and avoids storing an incomplete batch as filled');
  await stopped.close();

  const invalid = await scenario({ invalid: true });
  await invalid.waitForFunction(() => reports.some(report => report.mode === 'blocked'));
  assert.equal(await invalid.locator('input:checked').count(), 0);
  assert.equal(await invalid.locator('[data-cx-agent-answer-progress]').count(), 0);
  results.push('An invalid later answer fails whole-batch preflight before any question is changed');
  await invalid.close();
} finally { await browser.close(); }
const report = { at: new Date().toISOString(), passed: results.length, results,
  scope: 'Fully intercepted disposable browser, actual adapter/content and native radio DOM, simulated extension transport and model answers, no real course submission',
  sourceSha256: { adapter: createHash('sha256').update(adapter).digest('hex'), content: createHash('sha256').update(content).digest('hex') } };
await writeFile(join(root, 'test/interaction-progress-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
