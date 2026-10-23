// Disposable headless browser; every URL is intercepted. No live course access.
import { createRequire } from 'node:module';
import { readFile, access, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw new Error('No disposable fixture browser found');
const [adapter, content, pdfBridge, documentBridge, documentScroll, manifest] = await Promise.all([
  ...['adapter.js', 'content.js', 'pdf-bridge.js', 'document-bridge.js', 'document-scroll.js'].map(file => readFile(join(root, 'extension', file), 'utf8')),
  readFile(join(root, 'extension/manifest.json'), 'utf8').then(JSON.parse)
]);
const mainScript = manifest.content_scripts.find(script => script.js.includes('pdf-bridge.js'));
assert.equal(mainScript.world, 'MAIN');
assert.equal(mainScript.run_at, 'document_start');
assert.equal(mainScript.all_frames, true);
assert.ok(mainScript.matches.every(pattern => /^https:\/\/\*\.(?:chaoxing|xuexitong)\.com\/ananas\/modules\/pdf\/\*$/.test(pattern)));
assert.ok(['storage', 'alarms'].every(permission => manifest.permissions.includes(permission)));
assert.ok(!manifest.permissions.includes('debugger') && !manifest.permissions.includes('scripting'));
assert.ok(manifest.content_scripts.find(script => script.js.includes('content.js')).js.indexOf('document-bridge.js') < manifest.content_scripts.find(script => script.js.includes('content.js')).js.indexOf('content.js'));
const browser = await chromium.launch({ executablePath, headless: true });
const results = ['MAIN 桥接静态注册仅限 PDF 模块路径，未增加 scripting/debugger 权限'];
const topUrl = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=fixture';
const cardsUrl = 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture';
const pdfUrl = 'https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?fixture=1';
const viewerUrl = 'https://pan-yz.chaoxing.com/preview?fixture=1';
const rogueUrl = 'https://pan-yz.chaoxing.com/rogue?fixture=1';
async function fixture({ callback = true, pages = 2, injectMain = true, documentMode = 'fast' } = {}) {
  const page = await browser.newPage();
  const records = new Map(), frameIds = new Map(), events = [];
  let nextId = 1, route;
  await page.exposeBinding('__cxFixture', ({ frame }, message) => {
    if (!frameIds.has(frame)) frameIds.set(frame, frame === page.mainFrame() ? 0 : nextId++);
    const frameId = frameIds.get(frame);
    if (message.type === 'state') return { ok: true, value: { enabled: true, config: { autoSubmit: true, confidence: .85, nextSelector: '', completeSelector: '', documentMode } } };
    if (message.type === 'report') {
      if (frameId === 0 && route && route !== message.value.route) records.clear();
      if (frameId === 0) route = message.value.route;
      records.set(frameId, { frameId, ...message.value, at: Date.now() });
    }
    if (message.type === 'reports') return { ok: true, value: [...records.values()].filter(item => Date.now() - item.at < 12000) };
    if (message.type === 'claimTask') return { ok: true, value: { ok: true } };
    if (message.type === 'event') events.push(message.value);
    if (message.type === 'solve') throw new Error('PDF fixture must never call a model');
    return { ok: true, value: { ok: true } };
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    let body = '<html><body>intercepted fixture</body></html>';
    if (url === topUrl) body = `<iframe id="iframe" style="width:1000px;height:700px" src="${cardsUrl}"></iframe><button id="prevNextFocusNext" onclick="window.nextClicks=(window.nextClicks||0)+1;document.getElementById('iframe').src='about:blank#next'">下一节</button>`;
    if (url === cardsUrl) body = `<div id="job" class="ans-attach-ct"><span class="ans-job-icon"></span><iframe style="width:950px;height:650px" src="${pdfUrl}"></iframe></div>`;
    if (url === pdfUrl) body = `<iframe id="panView" style="width:900px;height:600px" src="${viewerUrl}"></iframe><iframe id="rogue" src="${rogueUrl}"></iframe><script>window.finishCalls=0;window.received=[];addEventListener('message',e=>{if(e.data?.type==='cx-agent:pdf-finish')received.push(e.data);});${callback ? 'window.finishJob=function(){finishCalls++;window.callbackAt=Date.now();};' : ''}</script>`;
    if (url === viewerUrl) body = `<ul class="fileBox">${Array.from({length: pages}, (_, i) => `<li id="page${i + 1}" style="height:900px">Document page ${i + 1}</li>`).join('')}</ul><script>window.scrolls=[];const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){scrolls.push({id:this.id,at:Date.now()});return original.apply(this,args);};</script>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  await page.goto(topUrl);
  const frame = url => page.frames().find(item => item.url() === url);
  const pdf = frame(pdfUrl), viewer = frame(viewerUrl), cards = frame(cardsUrl), rogue = frame(rogueUrl);
  assert.ok(pdf && viewer && cards && rogue, 'real nested cross-origin fixture frames loaded');
  if (injectMain) await pdf.addScriptTag({ content: pdfBridge });
  return {
    page, pdf, viewer, cards, rogue, events, records,
    async start() {
      for (const target of [page.mainFrame(), cards, pdf, viewer]) {
        await target.evaluate(() => { globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: message => globalThis.__cxFixture(message) } }; });
        await target.addScriptTag({ content: documentBridge });
        await target.addScriptTag({ content: documentScroll });
        await target.addScriptTag({ content: adapter });
        await target.addScriptTag({ content });
      }
    }
  };
}
async function isolatedWorld(frame) {
  const context = frame.page().context();
  const session = await context.newCDPSession(frame).catch(() => context.newCDPSession(frame.page()));
  const {frameTree} = await session.send('Page.getFrameTree');
  const find = tree => tree.frame.url === frame.url() ? tree.frame.id : (tree.childFrames || []).map(find).find(Boolean);
  const frameId = find(frameTree);
  assert.ok(frameId, 'isolated world has an observed fixture frame');
  const {executionContextId} = await session.send('Page.createIsolatedWorld', {frameId,worldName:'cx-agent-pdf-fixture'});
  return {
    async evaluate(expression) {
      const result = await session.send('Runtime.evaluate', {expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    close:()=>session.detach()
  };
}
try {
  const valid = await fixture({ documentMode: 'paced' });
  await valid.start();
  await valid.viewer.waitForFunction(() => scrolls.length === 1);
  assert.equal(await valid.pdf.evaluate(() => finishCalls), 0);
  await valid.viewer.waitForFunction(() => scrolls.length === 2, null, { timeout: 12000 });
  assert.equal(await valid.pdf.evaluate(() => finishCalls), 0, 'second page must also finish its dwell');
  await valid.pdf.waitForFunction(() => finishCalls === 1, null, { timeout: 12000 });
  const scrolls = await valid.viewer.evaluate(() => scrolls);
  assert.ok(scrolls[1].at - scrolls[0].at >= 7900);
  assert.ok((await valid.pdf.evaluate(() => callbackAt)) - scrolls[1].at >= 7900);
  assert.equal(await valid.cards.locator('#job').evaluate(node => node.classList.contains('ans-job-finished')), false);
  assert.equal(valid.events.some(event => event.type === 'next'), false);
  const completedReport = [...valid.records.values()].find(item => item.url === viewerUrl);
  assert.ok(completedReport?.mode === 'complete');
  assert.match(completedReport.status, /已调用站点完成回调/);
  await valid.cards.locator('#job').evaluate(node => node.classList.add('ans-job-finished'));
  await valid.page.waitForFunction(() => window.nextClicks === 1, null, { timeout: 12000 });
  await valid.page.waitForTimeout(13000);
  assert.equal(await valid.page.evaluate(() => nextClicks), 1);
  assert.equal(valid.events.some(event => event.type === 'submitted'), false);
  results.push('跨源 pan-yz 两页均滚动停留后只调用一次站点 finishJob，真实父层完成标记出现后才跳转');
  await valid.page.close();

  const fast = await fixture({ pages: 20 });
  const started = Date.now();
  await fast.start();
  await fast.pdf.waitForFunction(() => finishCalls === 1, null, { timeout: 5000 });
  assert.deepEqual(await fast.viewer.evaluate(() => scrolls.map(item => item.id)), ['page20']);
  assert.ok(Date.now() - started < 5000, 'fast mode has no per-page dwell');
  assert.equal(fast.events.some(event => event.type === 'next'), false);
  assert.equal(await fast.cards.locator('#job').evaluate(node => node.classList.contains('ans-job-finished')), false);
  results.push('快速模式直接滚到第20页末尾并在5秒内请求正常完成回调，未自行标记完成或跳转');
  await fast.page.close();

  const security = await fixture();
  const id = '11111111-1111-4111-8111-111111111111';
  const request = { type: 'cx-agent:pdf-finish', version: 1, id };
  await security.pdf.evaluate(request => window.postMessage(request, location.origin), request);
  await security.rogue.evaluate(({ request, origin }) => window.parent.postMessage(request, origin), {request, origin:new URL(pdfUrl).origin});
  await security.pdf.evaluate(request => dispatchEvent(new MessageEvent('message', { data:request, source:document.getElementById('panView').contentWindow, origin:'https://evil.example' })), request);
  await security.viewer.evaluate(({ request, origin }) => window.parent.postMessage({...request, method:'anything'}, origin), {request, origin:new URL(pdfUrl).origin});
  await security.page.waitForTimeout(300);
  assert.equal(await security.pdf.evaluate(() => finishCalls), 0);
  await security.viewer.evaluate(({ request, origin }) => { window.parent.postMessage(request, origin);window.parent.postMessage(request, origin);window.parent.postMessage({...request,id:'22222222-2222-4222-8222-222222222222'},origin); }, {request, origin:new URL(pdfUrl).origin});
  await security.pdf.waitForFunction(() => finishCalls === 1);
  await security.page.waitForTimeout(300);
  assert.equal(await security.pdf.evaluate(() => finishCalls), 1);
  results.push('错误来源窗口、错误 origin、额外方法字段均被拒绝；重复或不同关联 ID 不重复调用同一文档回调');
  await security.page.close();

  const response = await fixture({injectMain:false});
  const isolated = await isolatedWorld(response.viewer);
  await isolated.evaluate(documentBridge);
  assert.equal(await response.viewer.evaluate(()=>typeof globalThis.ChaoxingDocumentBridge),'undefined','bridge lives in a real isolated world');
  await isolated.evaluate("window.bridgeResult=null;ChaoxingDocumentBridge.finishViewedDocument('viewed').then(value=>bridgeResult=value);void ChaoxingDocumentBridge.finishViewedDocument('viewed');");
  await response.pdf.waitForFunction(() => received.length === 1);
  const pendingId = await response.pdf.evaluate(() => received[0].id);
  await response.viewer.evaluate(id => dispatchEvent(new MessageEvent('message', {data:{type:'cx-agent:pdf-result',version:1,id,status:'invoked'},source:window.parent,origin:'https://evil.example'})), pendingId);
  await response.pdf.evaluate(({id,origin}) => document.getElementById('panView').contentWindow.postMessage({type:'cx-agent:pdf-result',version:1,id:(id[0]==='0'?'1':'0')+id.slice(1),status:'invoked'},origin),{id:pendingId,origin:new URL(viewerUrl).origin});
  await response.viewer.evaluate(id => window.postMessage({type:'cx-agent:pdf-result',version:1,id,status:'invoked'},location.origin),pendingId);
  await response.page.waitForTimeout(300);
  assert.equal(await isolated.evaluate('bridgeResult'),null);
  await response.pdf.evaluate(({id,origin}) => document.getElementById('panView').contentWindow.postMessage({type:'cx-agent:pdf-result',version:1,id,status:'invoked'},origin),{id:pendingId,origin:new URL(viewerUrl).origin});
  const until = Date.now()+2000;
  while(Date.now()<until && (await isolated.evaluate('bridgeResult?.status'))!=='invoked') await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(await isolated.evaluate('bridgeResult?.status'),'invoked');
  assert.equal(await response.pdf.evaluate(() => received.length),1);
  await isolated.close();
  results.push('真实 ISOLATED world 仅接受 MAIN parent、精确 origin 与关联 ID 的回复，同一文档重复请求合并');
  await response.page.close();

  const unavailable = await fixture({callback:false,pages:1});
  await unavailable.start();
  await unavailable.viewer.waitForFunction(() => document.body.textContent.includes('Document page'));
  await unavailable.page.waitForTimeout(14500);
  assert.equal(await unavailable.pdf.evaluate(() => finishCalls),0);
  assert.equal(await unavailable.pdf.evaluate(() => received.length),1);
  assert.equal(unavailable.events.some(event=>event.type==='next'),false);
  assert.match([...unavailable.records.values()].find(item=>item.url===viewerUrl)?.status || '',/回调不可用/);
  assert.equal(await unavailable.cards.locator('#job').evaluate(node=>node.classList.contains('ans-job-finished')),false);
  results.push('站点没有 finishJob 时只尝试一次并等待平台或人工，不制造完成标记或跳转');
  await unavailable.page.close();
  const report = {at:new Date().toISOString(),browser:await browser.version(),scope:'intercepted disposable browser fixtures; real cross-origin nested frames; full-content transport mocked in page world; separate real ISOLATED-to-MAIN bridge messaging test; no live course access',checks:results};
  await writeFile(join(root,'test/pdf-bridge-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
