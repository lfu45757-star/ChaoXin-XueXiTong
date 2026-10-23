// Isolated chapter navigation gates only. Never accesses a real course/profile.
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
const discussion = await readFile(join(root, 'extension/discussion.js'), 'utf8');
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw new Error('No disposable fixture browser found');

const origin = 'https://mooc1.chaoxing.com';
const cardsPath = '/mooc-ans/knowledge/cards';
const workModulePath = '/ananas/modules/work/index.html';
const workDocumentPath = '/mooc-ans/work/doHomeWorkNew';
const workReceiptPath = '/mooc-ans/work/selectWorkQuestionYiPiYue';
const cardsQuery = '?courseid=fixture&knowledgeid=fixture-chapter';
const done = '<div class="ans-attach-ct ans-job-finished"><span class="ans-job-icon"></span></div>';
const completedWorkTask = `<div class="ans-attach-ct ans-job-finished"><span class="ans-job-icon"></span><iframe src="${workModulePath}?workId=fixture"></iframe></div>`;
const pendingWorkTask = `<div class="ans-attach-ct"><span class="ans-job-icon"></span><iframe src="${workModulePath}?workId=fixture"></iframe></div>`;
const pendingHidden = '<div class="ans-attach-ct" style="display:none"><span class="ans-job-icon"></span><iframe src="/work/pending"></iframe></div>';
const discussionKey = origin + '/ananas/modules/discuss/index.html?task=fixture';
const pendingDiscussion = `<div class="ans-attach-ct"><span class="ans-job-icon"></span><iframe src="${discussionKey}"></iframe></div>`;
const oldComplete = { frameId: 91, mode: 'complete', busy: false, status: 'old work complete', url: origin + workReceiptPath + '?knowledgeid=previous-chapter&workAnswerId=old-answer', jobTotal: 1, jobDone: 1, trackedJobTotal: 1, submissionConfirmed: true };
const skippedWorkReports = [
  { frameId: 92, mode: 'page', busy: false, url: origin + workModulePath + '?workId=fixture',
    childFrameUrls: [origin + workDocumentPath + '?workAnswerId=fixture-answer&knowledgeid=fixture-chapter&courseid=fixture'], jobTotal: 0, jobDone: 0 },
  { frameId: 93, mode: 'skipped', busy: false, skipReason: 'no-valid-answer', quizKey: 'b'.repeat(64),
    url: origin + workDocumentPath + '?workAnswerId=fixture-answer&knowledgeid=fixture-chapter&courseid=fixture', jobTotal: 0, jobDone: 0 }
];
const specs = [
  { name: 'hidden pending marker and no work-child report block chapter navigation', html: done + pendingHidden, injectCards: true },
  { name: 'expired blocked work report never turns a hidden pending task into completion', html: done + pendingHidden, injectCards: true,
    seeds: [{ frameId: 92, mode: 'blocked', busy: false, status: 'unknown submission', url: origin + '/work/pending', quizKey: 'a'.repeat(64), jobTotal: 0, jobDone: 0, ageMs: 5000 }] },
  { name: 'loading native cards with a visible old completion marker do not advance', html: '<div class="loading">正在加载任务</div>' + done, injectCards: true },
  { name: 'missing native-cards report is not replaced by another completed work report', html: done, injectCards: false, seeds: [oldComplete] },
  { name: 'about:blank main iframe cannot reuse an earlier completed cards report', blankMain: true, seeds: [{ ...oldComplete, url: origin + cardsPath + cardsQuery }] },
  { name: 'loaded fresh native cards with all tasks complete advance exactly once', html: done + done, injectCards: true, expectedClicks: 1 },
  { name: 'all completed native markers override stale active media and nested job counts', html: done + done,
    injectCards: true, seeds: [
      { frameId: 82, mode: 'media', busy: true, status: 'old video still playing', url: origin + '/ananas/modules/video/index.html?old=1', jobTotal: 0, jobDone: 0 },
      { frameId: 83, mode: 'page', busy: false, status: 'waiting for task point', url: origin + '/ananas/modules/video/index.html?old=2', jobTotal: 1, jobDone: 0 }
    ], expectedClicks: 1 },
  { name: 'completed native work marker advances despite review page lacking receipt', html: completedWorkTask, injectCards: true, expectedClicks: 1 },
  { name: 'completed work marker is checked before solving its still-visible question', html: completedWorkTask,
    injectCards: true, injectWorkQuestion: true, checkBeforeParse: true, expectedClicks: 1 },
  { name: 'cross-origin completed work marker is checked before solving its still-visible question', html: completedWorkTask,
    injectCards: true, injectWorkQuestion: true, workCrossOrigin: true, checkBeforeParse: true, expectedClicks: 1 },
  { name: 'another completed marker cannot suppress an unfinished work question', html: done + pendingWorkTask,
    injectCards: true, injectWorkQuestion: true, expectedSolves: 1 },
  { name: 'completed native work marker overrides a stale blocked child report', html: completedWorkTask, injectCards: true,
    seeds: [{ ...skippedWorkReports[1], mode: 'blocked', skipReason: undefined }], expectedClicks: 1 },
  { name: 'unanswerable work advances while its own task marker stays pending', html: done + pendingWorkTask,
    injectCards: true, seeds: skippedWorkReports, expectedClicks: 1 },
  { name: 'skipped work never hides an unrelated pending task', html: done + pendingWorkTask + pendingHidden,
    injectCards: true, seeds: skippedWorkReports },
  { name: 'completed cards markers plus a fresh successful actual work document advance once', html: completedWorkTask, injectCards: true, injectWorkDocument: true, expectedClicks: 1 }
  ,{ name: 'cross-origin work receipt without knowledgeid is bound through actual parent iframe URLs', html: completedWorkTask, injectCards: true, injectWorkDocument: true, workCrossOrigin: true, expectedClicks: 1 }
  ,{ name: 'completed selected card advances inside tabs while a different card remains pending', html: done, injectCards: true, cardNavigation: true, expectedCardClicks: 1 }
  ,{ name: 'same-chapter report from another card cannot satisfy the current cards URL', html: done, injectCards: false,
    seeds: [{ frameId: 94, mode: 'page', cardsReady: true, url: origin + cardsPath + cardsQuery + '&num=1', jobTotal: 1, jobDone: 1, trackedJobTotal: 1 }] }
  ,{ name: 'explicitly skipped discussion continues to next chapter with original pending marker intact', html: pendingDiscussion, injectCards: true, skippedDiscussion: true, expectedClicks: 1 }
  ,{ name: 'skipped discussion never hides an unfinished different task', html: pendingDiscussion + pendingHidden, injectCards: true, skippedDiscussion: true }
];

const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
async function check(spec) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let observation;
  try {
    await page.exposeBinding('__fixtureSend', (_source, message, frameId) => page.evaluate(({ message, frameId }) => fixtureSend(message, frameId), { message, frameId }));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const src = spec.blankMain ? 'about:blank' : origin + cardsPath + cardsQuery;
      const tabs = spec.cardNavigation ? '<ul class="ans-tabs"><li><a class="ans-tab on">文档</a></li><li><a class="ans-tab" onclick="window.cardClicks++;window.enabled=false">练习</a></li></ul><div class="ans-attach-ct"><span class="ans-job-icon"></span></div>' : '';
      const top = `${tabs}<iframe id="iframe" style="width:900px;height:600px" src="${src}"></iframe><button id="prevNextFocusNext" onclick="window.nextClicks++;window.enabled=false">下一节</button>`;
      const body = url.pathname === cardsPath ? (spec.html || '') :
        url.pathname === workModulePath ? `<iframe id="frame_content" style="width:800px;height:500px" src="${(spec.workCrossOrigin ? 'https://mooc2.chaoxing.com' : origin) + (spec.injectWorkDocument ? workReceiptPath : workDocumentPath)}?workAnswerId=fixture-answer${spec.workCrossOrigin ? '' : '&knowledgeid=fixture-chapter'}&courseid=fixture"></iframe>` :
        url.pathname === workReceiptPath ? '<div class="testTit_status_complete">章节测验已完成</div>' :
        url.pathname === workDocumentPath ? (spec.injectWorkQuestion ?
          '<div class="testTit_status">待完成</div><div class="singleQuesId"><input id="answertype1" type="hidden" value="0"><div class="Zy_TItle">Python 文件操作题</div><label><input type="radio" name="answer">A、open()</label><label><input type="radio" name="answer">B、close()</label></div><button class="btnSubmit workBtnIndex">提交</button>' :
          '<div class="testTit_status">待完成</div><button class="btnSubmit workBtnIndex">提交</button>') :
        url.pathname === '/work/pending' ? '<body>Task frame deliberately has no content transport</body>' : top;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    await page.goto(origin + '/mycourse/studentstudy?courseid=fixture&chapterId=fixture-chapter');
    await page.evaluate(({ seeds, skippedDiscussion, discussionKey }) => {
      window.enabled = true; window.nextClicks = 0; window.cardClicks = 0; window.solverCalls = 0; window.fixtureEvents = []; window.fixtureReports = new Map();
      for (const seed of seeds) fixtureReports.set(seed.frameId, { ...seed, at: Date.now() - (seed.ageMs || 0) });
      window.fixtureSend = async (message, frameId) => {
        if (message.type === 'state') return { ok: true, value: { enabled, config: { autoSubmit: true, confidence: 0.85, programmingLanguage: 'auto', nextSelector: '', completeSelector: '' } } };
        if (message.type === 'report') { fixtureReports.set(frameId, { frameId, ...message.value, at: Date.now() }); return { ok: true, value: { ok: true } }; }
        if (message.type === 'reports') return { ok: true, value: [...fixtureReports.values()].filter(report => Date.now() - report.at < 12000) };
        if (message.type === 'discussionStatus') return { ok: true, value: skippedDiscussion ? { [discussionKey]: { status: 'skipped', reason: 'fixture entry unavailable' } } : {} };
        if (message.type === 'event') { fixtureEvents.push(message.value); return { ok: true, value: { ok: true } }; }
        if (message.type === 'solve') { solverCalls++; throw new Error('Navigation fixture must never solve or submit a quiz'); }
        return { ok: true, value: { ok: true } };
      };
      window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: message => fixtureSend(message, 0) } };
    }, { seeds: spec.seeds || [], skippedDiscussion: spec.skippedDiscussion, discussionKey });
    if (spec.injectCards) {
      const frame = page.frames().find(frame => { try { return new URL(frame.url()).pathname === cardsPath; } catch { return false; } });
      assert.ok(frame, 'native cards document loaded');
      await frame.evaluate(() => {
        window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: message => __fixtureSend(message, 1) } };
      });
      await frame.addScriptTag({ content: adapter });
      await frame.addScriptTag({ content: discussion });
      await frame.addScriptTag({ content });
    }
    if (spec.injectWorkDocument || spec.injectWorkQuestion) {
      for (const [index, path] of [workModulePath, spec.injectWorkQuestion ? workDocumentPath : workReceiptPath].entries()) {
        const frame = page.frames().find(frame => { try { return new URL(frame.url()).pathname === path; } catch { return false; } });
        assert.ok(frame, 'nested work frame loaded: ' + path);
        await frame.evaluate(frameId => {
          window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: message => __fixtureSend(message, frameId) } };
        }, index + 2);
        await frame.addScriptTag({ content: adapter });
        if (spec.checkBeforeParse && path === workDocumentPath) await frame.evaluate(() => {
          ChaoxingAdapter.parseQuestions = () => { throw new Error('Completed task was parsed'); };
        });
        await frame.addScriptTag({ content });
      }
    }
    await page.addScriptTag({ content: adapter });
    await page.addScriptTag({ content });
    if (spec.expectedClicks || spec.expectedCardClicks) await page.waitForFunction(() => nextClicks === 1 || cardClicks === 1, null, { timeout: 15000 });
    else await page.waitForTimeout(11000); // Includes the 7s navigation dwell and seeded report's 12s expiry.
    observation = await page.evaluate(() => ({ nextClicks, cardClicks, solverCalls, events: fixtureEvents,
      mainFrameSrc: document.getElementById('iframe')?.getAttribute('src'),
      reports: [...fixtureReports.values()].map(report => ({ ...report, ageMs: Date.now() - report.at })),
      liveReports: [...fixtureReports.values()].filter(report => Date.now() - report.at < 12000),
      liveMarkerSnapshot: (() => { try { const doc = document.getElementById('iframe').contentDocument; return [...doc.querySelectorAll('.ans-job-icon')].map(icon => ({ hiddenParent: !icon.parentElement.getClientRects().length, ownAttachDone: !!icon.closest('.ans-attach-ct')?.classList.contains('ans-job-finished') })); } catch { return null; } })()
    }));
    assert.equal(observation.solverCalls, spec.expectedSolves || 0);
    if (spec.checkBeforeParse) assert.ok(observation.liveReports.some(report =>
      new URL(report.url).pathname === workDocumentPath && report.mode === 'complete'), 'completed work child skipped parsing');
    assert.equal(observation.nextClicks, spec.expectedClicks || 0, spec.name);
    assert.equal(observation.cardClicks, spec.expectedCardClicks || 0, spec.name);
    assert.equal(observation.events.filter(event => event.type === 'next').length, (spec.expectedClicks || 0) + (spec.expectedCardClicks || 0));
    return { name: spec.name, passed: true, expectedClicks: spec.expectedClicks || 0, observation };
  } catch (error) {
    return { name: spec.name, passed: false, expectedClicks: spec.expectedClicks || 0, error: error.message, observation };
  } finally { await context.close(); }
}
try {
  results.push(...await Promise.all(specs.map(check)));
  const report = {
    at: new Date().toISOString(), browser: await browser.version(), passed: results.filter(result => result.passed).length, total: results.length,
    scope: 'Fully intercepted disposable browser; actual adapter/content with simulated runtime/storage and the background 12s report TTL; no real courses, model calls or submissions',
    sourceSha256: { adapter: createHash('sha256').update(adapter).digest('hex'), content: createHash('sha256').update(content).digest('hex'), discussion: createHash('sha256').update(discussion).digest('hex') }, results
  };
  await writeFile(join(root, 'test/navigation-gate-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, total: report.total, results: results.map(({ name, passed, error, observation }) => ({ name, passed, error, nextClicks: observation?.nextClicks })) }, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
} finally { await browser.close(); }
