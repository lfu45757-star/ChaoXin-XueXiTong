// Mock HTMLMediaElement state/Promises in intercepted disposable frames only.
// No real media decode, user activation, course requests, seeking or rate changes.
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
async function scenario(options = {}) {
  const page = await browser.newPage();
  const origin = options.crossOrigin ? 'https://mooc2.chaoxing.com' : 'https://mooc1.chaoxing.com';
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    const tag = options.audio ? 'audio' : 'video';
    const player = `<!doctype html><body><${tag} id="video" style="${options.hidden ? 'display:none' : 'display:block;width:400px;height:200px'}" src="/fixture-media.mp4"></${tag}>` + (options.next ? '<div id="marker" class="ans-attach-ct"><span class="ans-job-icon"></span></div><button id="prevNextFocusNext">下一节</button>' : '') + '</body>';
    if (path.endsWith('.mp4')) return route.fulfill({ status: 204, body: '' });
    const body = options.embed && path !== '/player' ? '<!doctype html><body>' + (options.parent || `<div class="ans-attach-ct ${options.done ? 'ans-job-finished' : ''}"><span class="ans-job-icon"></span><iframe src="${origin}/player"></iframe></div>`) + '</body>' : player;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  await page.goto('https://mooc1.chaoxing.com/' + (options.embed ? 'cards-fixture' : options.audioModule ? 'ananas/modules/audio/index.html' : 'player'));
  const target = options.embed ? page.frames().find(frame => frame.url() === origin + '/player') : page;
  assert.ok(target);
  await target.evaluate(options => {
    window.enabled = true; window.allowClaim = true; window.lock = null; window.claims = []; window.releases = []; window.reports = []; window.events = [];
    window.behavior = options.behavior || 'success'; window.timeOffset = 0;
    window.autoSeekAudio = options.autoSeekAudio !== false;
    const now = Date.now; Date.now = () => now() + timeOffset;
    const interval = window.setInterval; window.setInterval = (fn, ms, ...args) => interval(fn, options.slowTicks ? ms : ms === 3000 ? 100 : ms === 2500 ? 80 : ms, ...args);
    const item = document.getElementById('video');
    window.mock = { paused: true, ended: false, time: 0, duration: options.delayedMetadata ? NaN : 120, seeks: [], calls: 0, pauses: 0, mutedBeforePlay: [], resolve: null };
    for (const [key, getter] of Object.entries({ paused: () => mock.paused, ended: () => mock.ended, duration: () => mock.duration, readyState: () => 4, error: () => null }))
      Object.defineProperty(item, key, { configurable: true, get: getter });
    Object.defineProperty(item, 'currentTime', { configurable: true, get: () => mock.time, set: value => { mock.seeks.push(value); mock.time = value; } });
    item.pause = () => { mock.pauses++; mock.paused = true; };
    item.play = () => {
      mock.calls++; mock.mutedBeforePlay.push(item.muted);
      if (behavior === 'deferred') return new Promise(resolve => { mock.resolve = () => { mock.paused = false; item.dispatchEvent(new Event('playing')); resolve(); }; });
      if (behavior !== 'success') return Promise.reject(new DOMException('fixture ' + behavior, behavior));
      mock.paused = false; item.dispatchEvent(new Event('playing')); return Promise.resolve();
    };
    document.getElementById('prevNextFocusNext')?.addEventListener('click', () => { window.nextClicks = (window.nextClicks || 0) + 1; enabled = false; });
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { onMessage: { addListener: fn => { window.contentMessage = fn; } }, sendMessage: async message => {
      if (message.type === 'state') return { ok: true, value: { enabled, config: { autoSubmit: true, autoSeekAudio, confidence: .85, programmingLanguage: 'auto', nextSelector: '', completeSelector: '' } } };
      if (message.type === 'claimTask') { claims.push(message.key); if (!allowClaim) return { ok: true, value: { ok: false } }; lock = message.key; return { ok: true, value: { ok: true } }; }
      if (message.type === 'releaseTask') { releases.push(message.key); if (lock === message.key) lock = null; }
      if (message.type === 'report') reports.push(message.value);
      if (message.type === 'reports') return { ok: true, value: [] };
      if (message.type === 'event') events.push(message.value);
      if (message.type === 'solve') throw Error('Media fixture must not invoke solver');
      return { ok: true, value: { ok: true } };
    } } };
  }, options);
  await target.addScriptTag({ content: adapter });
  await target.addScriptTag({ content });
  return { page, target };
}
try {
  const audio = await scenario({ audio: true, hidden: true, audioModule: true });
  await audio.target.waitForFunction(() => mock.calls === 1 && reports.at(-1)?.mode === 'media');
  assert.deepEqual(await audio.target.evaluate(() => mock.mutedBeforePlay), [true]);
  assert.deepEqual(await audio.target.evaluate(() => mock.seeks), [119.5]);
  await audio.target.waitForTimeout(200);
  assert.deepEqual(await audio.target.evaluate(() => mock.seeks), [119.5], 'audio seeks only once per source');
  await audio.target.evaluate(() => { mock.time = 42; });
  await audio.target.waitForFunction(() => reports.at(-1)?.progress?.current === 42);
  await audio.page.close();
  const disabledSeek = await scenario({ audio: true, hidden: true, audioModule: true, autoSeekAudio: false });
  await disabledSeek.target.waitForFunction(() => mock.calls === 1);
  assert.deepEqual(await disabledSeek.target.evaluate(() => mock.seeks), []);
  await disabledSeek.page.close();
  const delayedMetadata = await scenario({ audio: true, hidden: true, audioModule: true, delayedMetadata: true });
  await delayedMetadata.target.waitForFunction(() => mock.calls === 1);
  assert.deepEqual(await delayedMetadata.target.evaluate(() => mock.seeks), []);
  await delayedMetadata.target.evaluate(() => { mock.duration = 120; document.getElementById('video').dispatchEvent(new Event('loadedmetadata')); });
  await delayedMetadata.target.waitForFunction(() => mock.seeks.length === 1);
  assert.deepEqual(await delayedMetadata.target.evaluate(() => mock.seeks), [119.5]);
  await delayedMetadata.page.close();
  const incidental = await scenario({ audio: true, hidden: true });
  await incidental.target.waitForTimeout(350);
  assert.equal(await incidental.target.evaluate(() => mock.calls), 0);
  await incidental.page.close();
  results.push('Task audio seeks once to the final half-second after duration is known, can be disabled, starts muted and reports progress; hidden incidental audio is not started');

  const completed = await scenario({ embed: true, done: true });
  await completed.target.waitForFunction(() => reports.at(-1)?.mode === 'complete');
  assert.equal(await completed.target.evaluate(() => mock.calls), 0);
  assert.equal(await completed.target.locator('video').evaluate(item => item.muted), false);
  assert.equal(await completed.target.evaluate(() => mock.ended), false);
  await completed.page.close();
  const newlyCompleted = await scenario({ embed: true });
  await newlyCompleted.target.waitForFunction(() => mock.calls === 1 && reports.at(-1)?.mode === 'media');
  await newlyCompleted.page.locator('.ans-attach-ct').evaluate(item => item.classList.add('ans-job-finished'));
  await newlyCompleted.target.waitForFunction(() => reports.at(-1)?.mode === 'complete');
  const priorClaims = await newlyCompleted.target.evaluate(() => claims.length);
  await newlyCompleted.target.evaluate(() => { mock.paused = false; document.getElementById('video').muted = false; document.getElementById('video').dispatchEvent(new Event('playing')); });
  await newlyCompleted.target.waitForTimeout(200);
  assert.deepEqual(await newlyCompleted.target.evaluate(() => [mock.paused, document.getElementById('video').muted, claims.length]), [false, false, priorClaims]);
  await newlyCompleted.page.close();
  results.push('A refreshed own completed attachment is skipped despite ended=false; completion cleanup also allows later manual replay without remuting or reclaiming');
  for (const options of [
    { embed: true, parent: '<div class="ans-attach-ct ans-job-finished"><span class="ans-job-icon"></span></div><div class="ans-attach-ct"><iframe src="/player"></iframe></div>' },
    { embed: true, parent: '<div class="ans-attach-ct ans-job-finished"><div class="ans-attach-ct"><iframe src="/player"></iframe></div></div>' },
    { embed: true, crossOrigin: true, done: true }
  ]) {
    const sample = await scenario(options);
    await sample.target.waitForFunction(() => mock.calls === 1);
    assert.equal(await sample.target.evaluate(() => ChaoxingAdapter.mediaCompleted(document.getElementById('video'))), false);
    assert.deepEqual(await sample.target.evaluate(() => mock.mutedBeforePlay), [true]);
    await sample.page.close();
  }
  results.push('Completed sibling/outer attachment or unreadable cross-origin parent cannot complete this media; each uncompleted play starts muted');

  const denied = await scenario({ behavior: 'NotAllowedError' });
  await denied.target.waitForFunction(() => reports.at(-1)?.mode === 'awaiting-user-playback');
  await denied.target.waitForTimeout(450);
  assert.equal(await denied.target.evaluate(() => mock.calls), 1);
  assert.equal(await denied.target.evaluate(() => lock), null);
  await denied.target.evaluate(() => document.getElementById('video').dispatchEvent(new Event('playing')));
  await denied.target.waitForTimeout(150);
  assert.equal(await denied.target.evaluate(() => mock.calls), 1, 'event name alone while paused does not resume');
  await denied.target.evaluate(() => { mock.paused = false; document.getElementById('video').dispatchEvent(new Event('playing')); });
  await denied.target.waitForFunction(() => reports.at(-1)?.mode === 'media');
  assert.equal(await denied.target.evaluate(() => mock.calls), 1);
  await denied.target.locator('video').evaluate(item => { item.muted = false; item.dispatchEvent(new Event('volumechange')); });
  assert.equal(await denied.target.locator('video').evaluate(item => item.muted), true);
  results.push('NotAllowedError attempts once, releases lock, and waits across ticks; actual unpaused playing reclaims normally and mute remains enforced');
  await denied.page.close();

  const deniedBeforeMetadata = await scenario({ audio: true, hidden: true, audioModule: true,
    behavior: 'NotAllowedError', delayedMetadata: true });
  await deniedBeforeMetadata.target.waitForFunction(() => reports.at(-1)?.mode === 'awaiting-user-playback');
  assert.deepEqual(await deniedBeforeMetadata.target.evaluate(() => mock.seeks), []);
  await deniedBeforeMetadata.target.evaluate(() => {
    mock.duration = 120;
    document.getElementById('video').dispatchEvent(new Event('loadedmetadata'));
  });
  await deniedBeforeMetadata.target.waitForFunction(() => mock.seeks.length === 1 && /音频已跳到结尾/.test(reports.at(-1)?.status || ''));
  assert.deepEqual(await deniedBeforeMetadata.target.evaluate(() => [mock.seeks, mock.calls]), [[119.5], 1]);
  await deniedBeforeMetadata.page.close();
  results.push('Audio metadata arriving after autoplay denial still seeks to the end without retrying blocked playback');

  const backgroundStall = await scenario({ slowTicks: true });
  await backgroundStall.target.waitForFunction(() => mock.calls === 1 && reports.at(-1)?.mode === 'media');
  await backgroundStall.target.evaluate(() => { timeOffset = 35000; contentMessage({ type: 'heartbeat' }); });
  await backgroundStall.target.waitForFunction(() => mock.calls === 2 && /进度停滞/.test(reports.at(-1)?.status || ''));
  assert.equal(await backgroundStall.target.evaluate(() => mock.pauses), 1);
  await backgroundStall.target.evaluate(() => { mock.time = 5; contentMessage({ type: 'heartbeat' }); });
  await backgroundStall.target.waitForFunction(() => reports.at(-1)?.progress?.current === 5);
  assert.match(await backgroundStall.target.evaluate(() => reports.at(-1).status), /正常播放中/);
  await backgroundStall.page.close();
  results.push('Worker heartbeat detects stalled background playback, restarts once, and publishes advancing progress');

  await Promise.all(['AbortError', 'NotSupportedError', 'NetworkError'].map(async name => {
    const sample = await scenario({ behavior: name });
    await sample.target.waitForFunction(() => reports.at(-1)?.mode === 'blocked');
    await sample.target.waitForTimeout(250);
    assert.equal(await sample.target.evaluate(() => mock.calls), 1);
    assert.equal(await sample.target.evaluate(() => lock), null);
    const status = await sample.target.evaluate(() => reports.at(-1).status);
    assert.doesNotMatch(status, /限制自动播放/);
    assert.match(status, name === 'AbortError' ? /已中断/ : name === 'NotSupportedError' ? /不受支持/ : /播放失败/);
    await sample.page.close();
  }));
  results.push('AbortError, NotSupportedError and other failures show their real category, release ownership, and do not repeatedly call play');

  const reset = await scenario({ behavior: 'NotAllowedError' });
  await reset.target.waitForFunction(() => reports.at(-1)?.mode === 'awaiting-user-playback');
  await reset.target.evaluate(() => { behavior = 'success'; document.getElementById('video').src = '/second.mp4'; });
  await reset.target.waitForFunction(() => mock.calls === 2 && reports.at(-1)?.mode === 'media');
  await reset.target.evaluate(() => { behavior = 'NotAllowedError'; mock.paused = true; });
  await reset.target.waitForFunction(() => mock.calls === 3 && reports.at(-1)?.mode === 'awaiting-user-playback');
  await reset.target.evaluate(() => { behavior = 'success'; history.pushState({}, '', location.pathname + '?chapter=next'); });
  await reset.target.waitForFunction(() => mock.calls === 4 && reports.at(-1)?.mode === 'media');
  await reset.target.evaluate(() => { enabled = false; });
  await reset.target.waitForFunction(() => reports.at(-1)?.mode === 'idle' && mock.paused);
  await reset.target.evaluate(() => { document.getElementById('video').muted = false; mock.paused = false; document.getElementById('video').dispatchEvent(new Event('playing')); });
  await reset.target.waitForTimeout(150);
  assert.deepEqual(await reset.target.evaluate(() => [mock.paused, document.getElementById('video').muted, lock]), [false, false, null]);
  await reset.target.evaluate(() => { enabled = true; mock.paused = true; });
  await reset.target.waitForFunction(() => mock.calls === 5 && reports.at(-1)?.mode === 'media');
  results.push('Source/route/stop reset waiting state and use new ownership; after stopped cleanup manual playback stays unmuted and unpaused, then a new start can play again');
  await reset.page.close();

  const delayed = await scenario({ behavior: 'deferred' });
  await delayed.target.waitForFunction(() => mock.calls === 1 && !!mock.resolve);
  await delayed.target.waitForTimeout(250);
  assert.equal(await delayed.target.evaluate(() => mock.calls), 1, 'pending play cannot reenter');
  await delayed.target.evaluate(() => { enabled = false; });
  await delayed.target.waitForFunction(() => reports.at(-1)?.mode === 'idle');
  await delayed.target.evaluate(() => mock.resolve());
  await delayed.target.waitForTimeout(100);
  assert.equal(await delayed.target.evaluate(() => mock.paused), true);
  await delayed.target.evaluate(() => { document.getElementById('video').muted = false; mock.paused = false; document.getElementById('video').dispatchEvent(new Event('playing')); });
  await delayed.target.waitForTimeout(100);
  assert.deepEqual(await delayed.target.evaluate(() => [mock.paused, document.getElementById('video').muted, lock]), [false, false, null]);
  results.push('A pending play runs once; stop pauses a late resolved attempt, and its settled cleanup does not take over later manual playback');
  await delayed.page.close();

  const ended = await scenario({ next: true });
  await ended.target.waitForFunction(() => mock.calls === 1);
  await ended.target.evaluate(() => { mock.ended = true; mock.paused = true; timeOffset = 10000; });
  await ended.target.waitForFunction(() => reports.at(-1)?.mode === 'complete');
  assert.equal(await ended.target.evaluate(() => window.nextClicks || 0), 0);
  await ended.target.locator('#marker').evaluate(item => item.classList.add('ans-job-finished'));
  await ended.target.waitForFunction(() => window.nextClicks === 1);
  assert.equal(await ended.target.evaluate(() => mock.calls), 1);
  results.push('Natural mocked ended does not replay or advance without the platform marker; the real marker then permits one normal next action');
  await ended.page.close();
} finally { await browser.close(); }
const result = { at: new Date().toISOString(), passed: results.length, results,
  scope: 'Fully intercepted disposable browser, real iframe/attachment DOM and extension-message simulation, mocked media paused/ended/error/play promises and accelerated tick timers; no real autoplay-policy, media decoding, user-gesture or live-course proof.' };
await writeFile(join(root, 'test/media-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
