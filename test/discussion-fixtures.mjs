// Real DOM and actual adapters; disposable browser, intercepted network, stub AI.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
let executablePath;
for (const path of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(path); executablePath = path; break; } catch {}
}
if (!executablePath) throw new Error('No fixture browser');
const sources = await Promise.all(['adapter.js', 'status-text.js', 'discussion.js'].map(name => readFile(new URL('../extension/' + name, import.meta.url), 'utf8')));
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
const href = 'https://groupweb.chaoxing.com/course/topic/v3/bbs/fixture/replysList';
const topic = 'Do you believe people can truly get to know each other simply via online communication? Why or why not?';
const reply = 'Online communication can help people understand each other, but trust also requires time, honesty and shared experiences. We should listen carefully, respect different opinions and verify important information before forming a judgement.';
async function fixture(options = {}) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: options.realTemplate ?
    `<div id="bbsTopicDetail"><div class="topicDetail_detail"><div class="topicDetail_head"><div class="topicDetail_title_empty">无标题</div><div class="topicDetail_title"><span>${topic}</span><span class="tag blue">置顶</span></div><div class="topicDetail_title_right"><div class="replyBtn">回复</div></div></div><div class="topicDetail_main"><div class="topicDetail_info"><img alt="avatar">Teacher metadata must not be sent</div><div><div class="replyContent">${options.bodyText || ''}</div></div><div class="detail_bottom"><span>举报</span></div></div></div></div><div class="editContainer topicDetail_editContainer"><div class="edit_main"><div class="replyEdit"><div class="textareawrap"><textarea placeholder="回复话题"></textarea></div><div class="replyEditBtnGroup"><div class="jb_btn addReply">回复</div><div>取消</div></div></div></div></div><section class="actualReplies"></section><div style="display:none"><textarea placeholder="请输入举报内容"></textarea></div>` : options.host ?
    '<div class="ans-attach-ct" id="discussion"><span class="ans-job-icon"></span><iframe src="https://mooc1.chaoxing.com/ananas/modules/discuss/index.html?task=fixture"></iframe></div><div class="ans-attach-ct" id="work"><span class="ans-job-icon"></span></div>' :
    `<div id="bbsTopicDetail"><div class="topicDetail_main">${topic}<div class="topicDetail_info">Teacher metadata</div></div></div><form class="replyEditor"><textarea id="replyContent"></textarea><button type="button">发表</button></form><div class="replyList"></div>` }));
  await page.goto(options.host ? 'https://mooc1.chaoxing.com/knowledge/cards?fixture=1' : href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ options, reply, href }) => {
    window.reply = reply; window.storage = {}; window.calls = []; window.posts = 0; window.generated = 0; window.finishes = [];
    window.enabled = true; window.config = { confidence: .85, autoDiscuss: true }; window.timeOffset = 0; window.fastClock = false;
    const now = Date.now.bind(Date); Date.now = () => now() + timeOffset + (fastClock ? (timeOffset += 5000) : 0);
    window.state = { config, discussionKey: options.host ? undefined : 'fixture-key', assignedUrl: href };
    if (options.previewIdentity) state.discussionKey = 'https://mooc1.chaoxing.com/mooc-ans/bbscircle/chapter?courseid=12345&mtopicid=101';
    if (options.mismatch) state.assignedUrl = href.replace('fixture', 'another');
    window.chrome = { storage: { local: { get: async key => ({ [key]: storage[key] }), set: async value => Object.assign(storage, structuredClone(value)) } } };
    window.send = async message => {
      calls.push(message);
      if (message.type === 'config') return config;
      if (message.type === 'claimTask') return { ok: true };
      if (message.type === 'releaseTask') return { ok: true };
      if (message.type === 'finishDiscussion') { finishes.push(message); return {}; }
      if (message.type === 'discussionStatus') return {};
      if (message.type === 'skipDiscussion') return { status: 'skipped', reason: message.reason };
      if (message.type === 'discussion') {
        generated++;
        if (options.modelError) throw new Error('Codex 退出码 1: '+JSON.stringify({context:{},questions:[{text:'PRIVATE_PROMPT_SENTINEL'}]}));
        if (options.busy && generated === 1) throw new Error('agent 正在处理另一请求');
        if (options.deferred) await new Promise(resolve => window.resolveAI = resolve);
        return { reply, confidence: options.low ? .3 : .95 };
      }
      throw new Error('Unexpected fixture message: ' + message.type);
    };
    window.run = () => ChaoxingDiscussion.handle({ send, state, alive: async () => enabled, onProgress: async status => {
      if (options.noReceipt && status.startsWith('已点击')) fastClock = true;
    } });
    if (!options.host) {
      if (options.oldReceipt) {
        const old = document.createElement('div'); old.className = 'replyContent'; old.textContent = reply; document.querySelector('.replyList').append(old);
        const toast = document.createElement('div'); toast.setAttribute('role', 'alert'); toast.textContent = '发布成功'; document.body.append(toast);
      }
      if (options.noEditor) document.querySelector('textarea').remove();
      if (options.metadataImage) document.querySelector('.topicDetail_info').innerHTML = '<img alt="Teacher avatar" src="/avatar.png">Teacher metadata';
      if (options.topicImage) document.querySelector('.topicDetail_main').append(document.createElement('img'));
      const button = document.querySelector(options.realTemplate ? '.addReply' : 'button');
      if (options.realTemplate) document.querySelector('.replyBtn').onclick = () => window.wrongButtonClicks = (window.wrongButtonClicks || 0) + 1;
      button.onclick = () => {
        posts++; window.stageAtClick = Object.values(storage)[0]?.stage;
        if (!options.noReceipt) { const posted = document.createElement('div'); posted.className = 'replyContent'; posted.textContent = document.querySelector('textarea').value; document.querySelector(options.realTemplate ? '.actualReplies' : '.replyList').append(posted); }
        document.querySelector('textarea').value = '';
      };
    }
  }, { options, reply, href });
  for (const source of sources) await page.addScriptTag({ content: source });
  return page;
}
async function snapshot(page) { return page.evaluate(() => ({ generated, posts, finishes, stages: Object.values(storage).map(value => value.stage), stageAtClick: window.stageAtClick, value: document.querySelector('textarea')?.value })); }
try {
  const success = await fixture();
  const firstResult = await success.evaluate(() => run());
  assert.equal(firstResult.mode, 'complete');
  assert.equal((await success.evaluate(() => run())).mode, 'complete');
  const good = await snapshot(success);
  assert.equal(good.generated, 1); assert.equal(good.posts, 1); assert.equal(good.stageAtClick, 'submitting');
  assert.deepEqual(good.stages, ['submitted']); assert.equal(good.finishes[0].status, 'submitted');
  checks.push('生成教师题目回复、填写、发布前持久化意图，新增回执确认；再次执行不重复生成/发布');
  await success.close();
  const failed = await fixture({modelError:true});
  const failedResult = await failed.evaluate(() => run());
  assert.equal(failedResult.mode,'skipped'); assert.match(failedResult.status,/Codex 退出码 1/);
  const failureState=await failed.evaluate(()=>({finishes,posts,diagnostics:Object.entries(storage).filter(([key])=>key.startsWith('discussion-error:'))}));
  assert.equal(failureState.posts,0); assert.doesNotMatch(failureState.finishes[0].reason,/PRIVATE_PROMPT_SENTINEL|"questions"/);
  assert.equal(failureState.diagnostics.length,1); assert.match(failureState.diagnostics[0][1].message,/PRIVATE_PROMPT_SENTINEL/);
  checks.push('AI失败跳过时只上报短提示，不发布；原始诊断单独保留在本地记录'); await failed.close();

  const actual = await fixture({ realTemplate: true });
  assert.equal((await actual.evaluate(() => run())).mode, 'complete');
  assert.equal(await actual.evaluate(() => calls.find(call => call.type === 'discussion').topic),topic);
  assert.equal(await actual.evaluate(() => window.wrongButtonClicks || 0),0);
  assert.equal((await snapshot(actual)).posts,1);
  checks.push('真实模板的标题区教师题目、空正文、div.addReply 发布按钮、隐藏举报框和普通 replyContent 回执全部正确处理，不点击顶部回复入口'); await actual.close();
  const withBody = await fixture({ realTemplate: true, bodyText:'Please explain both benefits and limitations.' });
  assert.equal((await withBody.evaluate(() => run())).mode,'complete');
  assert.equal(await withBody.evaluate(() => calls.find(call => call.type === 'discussion').topic),topic+'\nPlease explain both benefits and limitations.');
  checks.push('标题与正文一起作为教师题目，剔除教师信息、置顶标签和举报页脚'); await withBody.close();

  const identity = await fixture({ previewIdentity: true });
  assert.equal((await identity.evaluate(() => run())).mode, 'complete');
  await identity.evaluate(() => { state.assignedUrl += '?utenc=refreshed-viewer-signature'; history.replaceState({}, '', state.assignedUrl); });
  assert.equal((await identity.evaluate(() => run())).mode, 'complete');
  const identityResult = await snapshot(identity); assert.equal(identityResult.generated,1); assert.equal(identityResult.posts,1);
  checks.push('insertbbs 发布记录按稳定题目身份保存，讨论地址签名刷新后也不会重复生成或发布'); await identity.close();

  const low = await fixture({ low: true });
  assert.equal((await low.evaluate(() => run())).mode, 'skipped');
  const lowResult = await snapshot(low); assert.equal(lowResult.posts, 0); assert.equal(lowResult.value, '');
  checks.push('低置信度回复不填写、不发布'); await low.close();

  const avatar = await fixture({ metadataImage: true });
  assert.equal((await avatar.evaluate(() => run())).mode, 'complete');
  checks.push('教师信息区的头像不干扰纯文字题目识别'); await avatar.close();
  const image = await fixture({ topicImage: true });
  assert.equal((await image.evaluate(() => run())).mode, 'discussion'); await image.evaluate(() => timeOffset += 13000);
  assert.equal((await image.evaluate(() => run())).mode, 'skipped'); assert.equal((await snapshot(image)).generated, 0);
  checks.push('题目含无法解析图片时跳过，不猜测题意'); await image.close();

  for (const change of ['stop', 'draft', 'topic', 'config', 'route']) {
    const page = await fixture({ deferred: true });
    await page.evaluate(() => { window.pendingRun = run(); });
    await page.waitForFunction(() => typeof window.resolveAI === 'function');
    await page.evaluate(change => {
      if (change === 'stop') enabled = false;
      if (change === 'draft') document.querySelector('textarea').value = 'My own draft';
      if (change === 'topic') document.querySelector('.topicDetail_main').textContent = 'A different teacher discussion topic';
      if (change === 'config') config.autoDiscuss = false;
      if (change === 'route') history.pushState({}, '', location.href.replace('fixture', 'another'));
      resolveAI();
    }, change);
    const result = await page.evaluate(() => pendingRun); assert.ok(['idle', 'skipped'].includes(result.mode));
    const value = await snapshot(page); assert.equal(value.posts, 0); assert.equal(value.value, change === 'draft' ? 'My own draft' : '');
    checks.push(`AI 等待期间 ${change} 变化阻止迟到发布并保留用户草稿`); await page.close();
  }

  const unknown = await fixture({ oldReceipt: true, noReceipt: true });
  assert.equal((await unknown.evaluate(() => run())).mode, 'skipped');
  assert.equal((await unknown.evaluate(() => run())).mode, 'skipped');
  const uncertain = await snapshot(unknown); assert.equal(uncertain.posts, 1); assert.equal(uncertain.generated, 1); assert.deepEqual(uncertain.stages, ['uncertain']);
  checks.push('旧同文回复和旧成功提示不能冒充新回执；结果未知不重复发布'); await unknown.close();

  const busy = await fixture({ busy: true });
  assert.equal((await busy.evaluate(() => run())).mode, 'discussion'); assert.equal((await snapshot(busy)).finishes.length, 0);
  assert.equal((await busy.evaluate(() => run())).mode, 'complete'); assert.equal((await snapshot(busy)).posts, 1);
  checks.push('AI 忙碌时排队，恢复后处理且不提前跳过'); await busy.close();

  const missing = await fixture({ noEditor: true });
  assert.equal((await missing.evaluate(() => run())).mode, 'discussion'); await missing.evaluate(() => timeOffset += 13000);
  assert.equal((await missing.evaluate(() => run())).mode, 'skipped'); assert.equal((await snapshot(missing)).generated, 0);
  checks.push('无法识别编辑区时等待加载后跳过，不调用 AI'); await missing.close();

  const mismatch = await fixture({ mismatch: true });
  assert.equal((await mismatch.evaluate(() => run())).mode, 'skipped'); assert.equal((await snapshot(mismatch)).generated, 0);
  checks.push('子页题目地址不属于原任务时不生成、不发布'); await mismatch.close();

  const host = await fixture({ host: true });
  assert.equal((await host.evaluate(() => run())).mode, 'discussion'); await host.evaluate(() => timeOffset += 13000);
  assert.equal(await host.evaluate(() => run()), null);
  assert.equal(await host.evaluate(() => ChaoxingDiscussion.skippedCount(ChaoxingAdapter.jobs())), 1);
  assert.equal(await host.locator('.ans-job-finished').count(), 0);
  assert.equal(await host.evaluate(() => calls.filter(message => message.type === 'skipDiscussion').length), 1);
  checks.push('讨论入口不可进入时跳过，只计该讨论，不伪造平台完成标记或跳过其他作业'); await host.close();

  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), passed: checks.length, checks, errors,
    scope: 'Disposable intercepted Chromium, actual adapter/discussion scripts and real DOM events; AI/extension transport simulated. No real course posts or paid model calls.' };
  await writeFile(new URL('./discussion-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
