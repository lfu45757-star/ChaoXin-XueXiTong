// Current user's observed nesting, with intercepted pages and simulated transport.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
let executablePath;
for (const path of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(path); executablePath = path; break; } catch {}
}
if (!executablePath) throw new Error('No fixture browser');
const [adapter, discussion] = await Promise.all(['adapter.js','discussion.js'].map(name => readFile(new URL('../extension/' + name, import.meta.url), 'utf8')));
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
async function fixture({ badLink = false, missingPreview = false } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === '/ananas/modules/insertbbs/index.html') {
      const frameElement = await route.request().frame().frameElement();
      const id = (await frameElement.getAttribute('name')).replace('topic-', '');
      body = missingPreview ? '<p>Preview not loaded</p>' : `<iframe src="/mooc-ans/bbscircle/chapter?mtopicid=${id}&courseid=12345&utenc=viewer-signature&isJob=true"></iframe>`;
    } else if (url.pathname === '/mooc-ans/bbscircle/chapter') {
      const id = url.searchParams.get('mtopicid');
      const target = badLink ? 'javascript:alert(1)' : `https://groupweb.chaoxing.com/course/topic/v3/bbs/${id}/replysList`;
      body = `<div id="topicMainDiv" data="${target}" onclick="window.unsafeInlineHandlerExecuted=true"><img alt="讨论图标">Teacher discussion ${id}: Explain your reasons.</div>`;
    } else body = [101,102,103].map(id => `<div class="ans-attach-ct"><span class="ans-job-icon"></span><iframe name="topic-${id}" src="/ananas/modules/insertbbs/index.html?v=2025-0109-1519&castscreen=0"></iframe></div>`).join('') + '<div class="ans-attach-ct" id="other-work"><span class="ans-job-icon"></span></div>';
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  await page.goto('https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=12345&knowledgeid=54321');
  await page.evaluate(() => {
    window.records = {}; window.calls = []; window.timeOffset = 0;
    const now = Date.now.bind(Date); Date.now = () => now() + timeOffset;
    window.send = async message => {
      calls.push(message);
      if (message.type === 'discussionStatus') return records;
      if (message.type === 'openDiscussion') return records[message.key] = { status: 'working', href: message.href };
      if (message.type === 'skipDiscussion') return records[message.key] = { status: 'skipped', reason: message.reason };
      throw new Error('Unexpected message: ' + message.type);
    };
    window.run = () => ChaoxingDiscussion.handle({ send, state: { config: { autoDiscuss: true } }, alive: async () => true, onProgress: async () => {} });
  });
  await page.addScriptTag({ content: adapter }); await page.addScriptTag({ content: discussion });
  return page;
}
try {
  const good = await fixture();
  const wrapperUrls = await good.locator('.ans-attach-ct iframe').evaluateAll(frames => frames.map(frame => frame.src));
  assert.equal(new Set(wrapperUrls).size, 1);
  let firstKey;
  for (const id of ['101','102','103']) {
    assert.equal((await good.evaluate(() => run())).mode, 'discussion');
    const opened = await good.evaluate(() => calls.filter(call => call.type === 'openDiscussion'));
    assert.equal(new URL(opened.at(-1).key).searchParams.get('mtopicid'), id);
    assert.equal(opened.at(-1).href, `https://groupweb.chaoxing.com/course/topic/v3/bbs/${id}/replysList`);
    assert.equal(new URL(opened.at(-1).key).searchParams.has('utenc'), false);
    if (!firstKey) {
      firstKey = opened.at(-1).key;
      assert.equal((await good.evaluate(() => run())).mode, 'discussion');
      assert.equal(await good.evaluate(() => calls.filter(call => call.type === 'openDiscussion').length),1);
    }
    await good.evaluate(key => records[key].status = 'submitted', opened.at(-1).key);
  }
  assert.equal(await good.evaluate(() => run()), null);
  assert.equal(await good.evaluate(() => new Set(calls.filter(call => call.type === 'openDiscussion').map(call => call.key)).size), 3);
  assert.equal(await good.locator('.ans-job-finished').count(), 0);
  assert.equal(await good.evaluate(() => ChaoxingDiscussion.skippedCount(ChaoxingAdapter.jobs())), 3);
  checks.push('三层 insertbbs→bbscircle 结构中，相同外层 URL 的三个题目按各自 mtopicid 顺序处理，其他作业不跳过');
  checks.push('题目身份不依赖签名或时间参数，等待子页期间不会再次打开同题');
  for (const frame of good.frames().filter(frame => frame.url().includes('/bbscircle/chapter')))
    assert.equal(await frame.evaluate(() => window.unsafeInlineHandlerExecuted === true), false);
  checks.push('仅读取 topicMainDiv 的普通 data URL，不执行内联 onclick 或任意脚本文本');
  // A preview content script sees the same identity as its parent cards script.
  const preview = good.frames().find(frame => frame.url().includes('mtopicid=101'));
  await good.locator('.ans-attach-ct').nth(2).evaluate(node => node.classList.add('ans-job-finished'));
  await preview.evaluate(() => { window.messages=[]; window.send=async message => { messages.push(message); if(message.type==='discussionStatus') return {}; if(message.type==='openDiscussion') return {status:'working'}; throw Error(message.type); }; });
  await preview.addScriptTag({content:adapter}); await preview.addScriptTag({content:discussion});
  await preview.evaluate(() => ChaoxingDiscussion.handle({ send, state:{config:{autoDiscuss:true}}, alive:async()=>true, onProgress:async()=>{} }));
  assert.equal(await preview.evaluate(() => messages.find(message => message.type === 'openDiscussion').key), firstKey);
  checks.push('cards、模块与预览框架使用一致题目身份，后台可跨 frame 去重');
  checks.push('其他讨论任务已完成不会阻止当前未完成讨论的进入');
  await good.locator('.ans-attach-ct').nth(0).evaluate(node => node.classList.add('ans-job-finished'));
  assert.equal(await preview.evaluate(() => { messages=[]; return ChaoxingDiscussion.handle({ send, state:{config:{autoDiscuss:true}}, alive:async()=>true, onProgress:async()=>{} }); }),null);
  assert.equal(await preview.evaluate(() => messages.length),0);
  const module = good.frames().find(frame => frame.name() === 'topic-101');
  await module.addScriptTag({content:adapter}); await module.addScriptTag({content:discussion});
  assert.equal(await module.evaluate(() => ChaoxingDiscussion.handle({ send:async()=>{throw Error('Completed task must not send');}, state:{config:{autoDiscuss:true}}, alive:async()=>true, onProgress:async()=>{} })),null);
  checks.push('平台已完成的所属讨论在模块/内层预览均不再打开或生成回复');
  await good.close();

  for (const options of [{badLink:true},{missingPreview:true}]) {
    const page = await fixture(options);
    assert.equal((await page.evaluate(() => run())).mode, 'discussion');
    await page.evaluate(() => timeOffset += 13000);
    assert.equal(await page.evaluate(() => run()), null);
    const skipped = await page.evaluate(() => calls.filter(call => call.type === 'skipDiscussion'));
    assert.equal(skipped.length,3); assert.equal(new Set(skipped.map(call => call.key)).size,3);
    assert.equal(await page.evaluate(() => calls.filter(call => call.type === 'openDiscussion').length),0);
    assert.equal(await page.evaluate(() => ChaoxingDiscussion.skippedCount(ChaoxingAdapter.jobs())),3);
    assert.equal(await page.locator('.ans-job-finished').count(),0);
    checks.push(options.badLink ? '无效/脚本 data 地址拒绝打开，三个题目分别跳过且保留平台标记' : '内层预览无法读取时用当前章节和附件序号区分任务，三个同址外框不会互相覆盖');
    await page.close();
  }
  assert.deepEqual(errors,[]);
  const result = { checkedAt:new Date().toISOString(), passed:checks.length, checks, errors,
    sourceSha256:{adapter:createHash('sha256').update(adapter).digest('hex'),discussion:createHash('sha256').update(discussion).digest('hex')},
    scope:'Observed user template reproduced with three real nested same-origin iframe trees, intercepted pages and simulated extension transport. Destination data URL shape comes from shipped extension source; live values and real course publication not verified.' };
  await writeFile(new URL('./insertbbs-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
