// Disposable headless browser; all fixture requests intercepted, no model/course calls.
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
async function fixture(html, extra = {}) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: extra[new URL(route.request().url()).pathname] ?? html }));
  await page.goto('https://mooc1.chaoxing.com/work/context-fixture');
  await page.addScriptTag({ content: adapter });
  return page;
}
const textQuestion = '<div class="singleQuesId"><input id="answertype1" type="hidden" value="4"><div class="Zy_TItle">编写程序计算给定数据。</div><textarea></textarea></div>';
const python = 'for i in range(3):\n    if i == 1:\n        continue\n    print("<script>literal</script>", i)\nprint("done")';
try {
  const titles = await fixture('<div class="courseName">Python 程序设计</div><div class="prev_title" title="第八课时 章节测试（实验课）">第八课时 章节测试（实验课）</div>');
  assert.deepEqual(await titles.evaluate(() => ChaoxingAdapter.courseContext()), { courseTitle: 'Python 程序设计', chapterTitle: '第八课时 章节测试（实验课）', programmingLanguage: 'Python' });
  const languages = [['Python语言概述','Python'],['C语言程序设计','C'],['C++ 程序设计','C++'],['Programming in C++','C++'],['Programming in C','C'],['Java程序设计','Java'],['JavaScript程序设计','JavaScript'],['ECMAScript 基础','JavaScript'],['微积分','auto']];
  for (const [title, language] of languages) {
    await titles.setContent('<div class="courseName"></div>');
    await titles.locator('.courseName').evaluate((node, title) => { node.textContent = title; }, title);
    assert.equal(await titles.evaluate(() => ChaoxingAdapter.courseContext().programmingLanguage), language, title);
  }
  await titles.setContent('<div class="courseName">Python 程序设计</div><div class="prev_title">Java 入门</div>');
  assert.equal(await titles.evaluate(() => ChaoxingAdapter.courseContext().programmingLanguage), 'auto');
  await titles.setContent('<div style="display:none"><div class="courseName">Python 程序设计</div></div><aside><span class="posCatalog_title" title="Python概述">Python概述</span><span class="posCatalog_name">Python语言概述</span></aside><div class="prev_title">第八课时 章节测试（实验课）</div><p>用Java编程回答</p>');
  assert.deepEqual(await titles.evaluate(() => ChaoxingAdapter.courseContext()), { courseTitle: '', chapterTitle: '第八课时 章节测试（实验课）', programmingLanguage: 'auto' });
  results.push('课程/当前章节显式可见标题可保守识别全部语言枚举；冲突、隐藏标题、任意侧栏/题目文字不推断语言');
  await titles.close();

  const nested = await fixture('<div class="courseName">Python 程序设计</div><div class="prev_title">当前实验</div><iframe src="/cards"></iframe>', {
    '/cards': '<iframe src="/nested-work"></iframe>', '/nested-work': textQuestion
  });
  const work = nested.frames().find(frame => frame.url().endsWith('/nested-work'));
  assert.ok(work); await work.addScriptTag({ content: adapter });
  assert.deepEqual(await work.evaluate(() => ChaoxingAdapter.courseContext()), { courseTitle: 'Python 程序设计', chapterTitle: '当前实验', programmingLanguage: 'Python' });
  await nested.close();
  const cross = await fixture('<div class="courseName">Python 程序设计</div><iframe src="https://mooc2.chaoxing.com/foreign-work"></iframe>', { '/foreign-work': textQuestion });
  const foreign = cross.frames().find(frame => frame.url().endsWith('/foreign-work'));
  assert.ok(foreign); await foreign.addScriptTag({ content: adapter });
  assert.deepEqual(await foreign.evaluate(() => ChaoxingAdapter.courseContext()), { courseTitle: '', chapterTitle: '', programmingLanguage: 'auto' });
  const hidden = await fixture('<iframe style="display:none" src="/hidden-work"></iframe>', { '/hidden-work': '<div class="courseName">Python 程序设计</div>' });
  const hiddenWork = hidden.frames().find(frame => frame.url().endsWith('/hidden-work'));
  assert.ok(hiddenWork); await hiddenWork.addScriptTag({ content: adapter });
  assert.equal(await hiddenWork.evaluate(() => ChaoxingAdapter.courseContext().programmingLanguage), 'auto');
  results.push('嵌套同源任务frame读取祖先标题，跨源top访问被浏览器拒绝时保持空上下文/auto');
  await Promise.all([cross.close(), hidden.close()]);

  const editor = await fixture('<div class="singleQuesId"><input id="answertype1" type="hidden" value="4"><div class="Zy_TItle">编写程序。</div><div class="blankItemDiv"><textarea style="display:none"></textarea><div class="InpDIV" contenteditable="true"></div><iframe src="/ueditor"></iframe></div></div>', { '/ueditor': '<body contenteditable="true"></body>' });
  for (const value of [python, '\n\n\tif True:\n\t\tprint("<img src=x onerror=alert(1)>")\n', '    return "<b>literal</b>"  ']) {
    await editor.evaluate(value => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: [value] }]), value);
    assert.equal(await editor.locator('textarea').inputValue(), value);
    assert.equal(await editor.locator('.InpDIV').innerText(), value);
    const frame = editor.frames().find(frame => frame.url().endsWith('/ueditor'));
    const saved = await frame.evaluate(() => ({ text: document.body.textContent, displayed: document.body.innerText, html: document.body.innerHTML, scripts: document.body.querySelectorAll('script,img').length }));
    assert.equal(saved.text, value); assert.equal(saved.displayed, value); assert.equal(saved.scripts, 0);
    assert.equal(await frame.locator('pre > code[lang="Plain Text"].language-plain').count(), 1);
    assert.match(saved.html, /<pre/); assert.ok(saved.html.includes('&lt;'));
    // UEditor getContent/save uses HTML. Round-trip its generated serialization
    // in an independent document to verify actual display, including leading LF.
    const replay = await fixture(saved.html);
    assert.equal(await replay.locator('body').innerText(), value);
    assert.equal(await replay.locator('body').textContent(), value);
    await replay.close();
  }
  results.push('UEditor式隐藏textarea+可见编辑区+iframe body保留Python换行/缩进；安全pre文本可序列化回放，答案HTML仅显示为文字');
  // Exercise real isolated-world wrappers, not only scripts sharing page globals.
  const session = await editor.context().newCDPSession(editor);
  const { frameTree } = await session.send('Page.getFrameTree');
  const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'cx-context-editor-fixture' });
  async function isolated(expression) {
    const reply = await session.send('Runtime.evaluate', { contextId: executionContextId, expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text);
    return reply.result.value;
  }
  assert.equal(await isolated('typeof ChaoxingAdapter'), 'undefined');
  await isolated(adapter);
  await isolated(`ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:[${JSON.stringify(python)}]}])`);
  assert.equal(await editor.locator('textarea').inputValue(), python);
  assert.equal(await editor.frames().find(frame => frame.url().endsWith('/ueditor')).evaluate(() => document.body.innerText), python);
  await session.detach(); await editor.close();
  results.push('真实CDP ISOLATED world适配器可跨同源iframe写入安全DOM并验证代码实际显示');

  const native = await fixture(textQuestion);
  await native.evaluate(value => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: [value] }]), '\n  native\n\ttext\n');
  assert.equal(await native.locator('textarea').inputValue(), '\n  native\n\ttext\n');
  const corrupted = await fixture('<div class="singleQuesId"><div class="Zy_TItle">编程</div><div class="blankItemDiv"><textarea style="display:none"></textarea><div class="InpDIV" contenteditable="true" oninput="this.querySelector(\'pre\').style.whiteSpace=\'normal\'"></div></div></div>');
  await assert.rejects(() => corrupted.evaluate(value => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: [value] }]), python), /页面未接受文字答案/);
  const stale = await fixture('<div class="singleQuesId"><div class="Zy_TItle">编程</div><div class="blankItemDiv"><textarea style="display:none"></textarea><div class="InpDIV" contenteditable="true" oninput="this.textContent=\'stale\'"></div></div></div>');
  await assert.rejects(() => stale.evaluate(value => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: [value] }]), python), /页面未接受文字答案/);
  results.push('原生textarea内容原样保存；主textarea正确但富文本镜像折叠空白或未接受答案时拒绝成功');
  await Promise.all([native.close(), corrupted.close(), stale.close()]);

  async function transport(page, checkpoint = '', autoSubmit = false, solveDelay = 0) {
    await page.evaluate(({ checkpoint, autoSubmit, solveDelay }) => {
      window.records = {}; window.reports = []; window.solves = []; window.submitClicks = 0; window.enabled = true; window.programmingLanguage = 'auto';
      globalThis.chrome = { storage: { local: {
        get: async key => ({ [key]: records[key] || (typeof checkpoint === 'string' ? (checkpoint ? { stage: checkpoint } : undefined) : checkpoint) }),
        set: async value => Object.assign(records, value)
      } }, runtime: { sendMessage: async message => {
        if (message.type === 'state') return { ok: true, value: { enabled, config: { confidence: .85, autoSubmit, programmingLanguage, nextSelector: '', completeSelector: '' } } };
        if (message.type === 'solve') {
          solves.push(message); const language = programmingLanguage;
          if (solveDelay) await new Promise(resolve => setTimeout(resolve, solveDelay));
          const usedContext = window.solverContextOverride;
          return { ok: true, value: { context: usedContext, answers: [{ id: '1', values: [(usedContext?.programmingLanguage || language) === 'C' ? 'int main(void) { return 0; }' : 'for i in range(2):\n    print(i)'], confidence: .99, explanation: 'fixture' }] } };
        }
        if (message.type === 'claimTask') return { ok: true, value: { ok: true } };
        if (message.type === 'reports') return { ok: true, value: [] };
        if (message.type === 'report') reports.push(message.value);
        return { ok: true, value: { ok: true } };
      } } };
    }, { checkpoint, autoSubmit, solveDelay });
    await page.addScriptTag({ content });
  }
  const solved = await fixture('<div class="courseName">Python 程序设计</div><div class="prev_title">第八课时 章节测试（实验课）</div>' + textQuestion);
  await transport(solved);
  await solved.waitForFunction(() => Object.values(records).some(record => record.stage === 'filled'));
  await solved.waitForFunction(() => reports.some(report => /^[a-f0-9]{64}$/.test(report.quizKey)));
  const solvedData = await solved.evaluate(() => ({ request: solves[0], report: reports.at(-1), recordKey: Object.keys(records)[0] }));
  assert.deepEqual(solvedData.request.context, { courseTitle: 'Python 程序设计', chapterTitle: '第八课时 章节测试（实验课）', programmingLanguage: 'Python' });
  assert.equal(solvedData.recordKey, 'quiz:' + solvedData.request.key); assert.equal(solvedData.report.quizKey, solvedData.request.key);
  assert.equal(await solved.locator('textarea').inputValue(), 'for i in range(2):\n    print(i)');
  results.push('无语言题solve消息携带课程/章节与Python上下文；frame report.quizKey使用实际存储fingerprint');
  await solved.close();

  const staleFilled = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion);
  await transport(staleFilled, { stage: 'filled', answers: [{ id: '1', values: ['old C answer'], confidence: .99 }] });
  await staleFilled.waitForFunction(() => solves.length === 1 && Object.values(records).some(record => record.context?.programmingLanguage === 'Python'));
  assert.equal(await staleFilled.locator('textarea').inputValue(), 'for i in range(2):\n    print(i)');
  const filledKey = await staleFilled.evaluate(() => solves[0].key);
  await staleFilled.evaluate(() => { programmingLanguage = 'C'; });
  await staleFilled.waitForFunction(() => solves.length === 2 && Object.values(records).some(record => record.context?.programmingLanguage === 'C'));
  assert.equal(await staleFilled.locator('textarea').inputValue(), 'int main(void) { return 0; }');
  assert.equal(await staleFilled.evaluate(() => solves[1].key), filledKey);
  await staleFilled.evaluate(() => { programmingLanguage = 'auto'; });
  await staleFilled.waitForFunction(() => solves.length === 3 && Object.values(records).some(record => record.context?.programmingLanguage === 'Python'));
  await staleFilled.waitForTimeout(3500);
  assert.equal(await staleFilled.evaluate(() => solves.length), 3, 'matching filled context does not trigger repeated solves');
  assert.equal(await staleFilled.evaluate(() => solves[2].key), filledKey);
  results.push('旧filled缺context重新解题；显式语言C/Python变化重新solve并替换答案但fingerprint不变，相同context不重复solve');
  await staleFilled.close();
  const cached = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion + '<button class="btnSubmit workBtnIndex" onclick="submitClicks++;this.insertAdjacentHTML(\'afterend\',\'<span class=testTit_status_complete>完成</span>\')">提交</button>');
  await transport(cached, { stage: 'filled', context: { courseTitle: 'Python 程序设计', chapterTitle: '', programmingLanguage: 'Python' }, answers: [{ id: '1', values: ['print("cached")'], confidence: .99 }] }, true);
  await cached.waitForFunction(() => Object.values(records).some(record => record.stage === 'submitted'));
  assert.equal(await cached.evaluate(() => solves.length), 0);
  assert.equal(await cached.locator('textarea').inputValue(), 'print("cached")');
  assert.equal(await cached.evaluate(() => submitClicks), 1);
  results.push('完全一致的解题context允许复用filled答案并仅一次正常提交');
  await cached.close();
  const cachedManual = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion);
  await transport(cachedManual, { stage: 'filled', context: { courseTitle: 'Python 程序设计', chapterTitle: '', programmingLanguage: 'Python' }, answers: [{ id: '1', values: ['print("cached")'], confidence: .99 }] });
  await cachedManual.waitForFunction(() => document.querySelector('textarea').value === 'print("cached")');
  assert.equal(await cachedManual.evaluate(() => solves.length), 0);
  await cachedManual.locator('textarea').fill('print("manual correction")');
  await cachedManual.waitForTimeout(3500);
  assert.equal(await cachedManual.locator('textarea').inputValue(), 'print("manual correction")');
  results.push('filled缓存进入刷新后的空文档会实际填写；关闭自动提交时后续轮询保留人工修改');
  await cachedManual.close();
  const changedDuringSolve = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion);
  await transport(changedDuringSolve, '', false, 1200);
  await changedDuringSolve.waitForFunction(() => solves.length === 1);
  await changedDuringSolve.evaluate(() => { programmingLanguage = 'C'; });
  await changedDuringSolve.waitForTimeout(1600);
  assert.equal(await changedDuringSolve.locator('textarea').inputValue(), '');
  assert.equal(await changedDuringSolve.evaluate(() => Object.keys(records).length), 0);
  await changedDuringSolve.waitForFunction(() => solves.length === 2 && Object.values(records).some(record => record.context?.programmingLanguage === 'C'));
  assert.equal(await changedDuringSolve.locator('textarea').inputValue(), 'int main(void) { return 0; }');
  assert.equal(await changedDuringSolve.evaluate(() => solves[0].key === solves[1].key), true);
  results.push('解题期间改变显式语言时丢弃迟到结果，不填写/缓存旧答案；下一轮按新设置重解但key不变');
  await changedDuringSolve.close();
  const returnedContext = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion);
  await transport(returnedContext, '', false, 1200);
  await returnedContext.waitForFunction(() => solves.length === 1);
  await returnedContext.evaluate(() => {
    programmingLanguage = 'C'; solverContextOverride = { courseTitle: 'Python 程序设计', chapterTitle: '', programmingLanguage: 'C' };
  });
  await returnedContext.waitForFunction(() => Object.values(records).some(record => record.context?.programmingLanguage === 'C'));
  assert.equal(await returnedContext.locator('textarea').inputValue(), 'int main(void) { return 0; }');
  await returnedContext.waitForTimeout(3500);
  assert.equal(await returnedContext.evaluate(() => solves.length), 1);
  assert.deepEqual(await returnedContext.evaluate(() => Object.values(records)[0].context), { courseTitle: 'Python 程序设计', chapterTitle: '', programmingLanguage: 'C' });
  results.push('后台返回实际effective context时按最新设置核对并记录该context，避免把新语言答案错误缓存为旧语言');
  await returnedContext.close();

  const pending = await fixture('<div class="courseName">Python 程序设计</div>' + textQuestion + '<button class="btnSubmit workBtnIndex" onclick="submitClicks++">提交</button>');
  await transport(pending, 'uncertain');
  await pending.waitForFunction(() => reports.some(report => report.mode === 'blocked' && report.quizKey));
  const key = await pending.evaluate(() => reports.at(-1).quizKey);
  assert.match(key, /^[a-f0-9]{64}$/);
  await pending.locator('.courseName').evaluate(node => { node.textContent = 'C语言程序设计'; });
  await pending.evaluate(() => { programmingLanguage = 'C'; });
  await pending.waitForTimeout(3500);
  assert.equal(await pending.evaluate(() => reports.at(-1).quizKey), key, 'context changes must not bypass uncertain fingerprint');
  await pending.evaluate(() => { enabled = false; });
  await pending.waitForFunction(() => reports.at(-1)?.mode === 'idle' && !reports.at(-1).busy);
  assert.equal(await pending.evaluate(() => reports.at(-1).quizKey), key);
  assert.deepEqual(await pending.evaluate(() => [solves.length, submitClicks, document.querySelector('textarea').value]), [0, 0, '']);
  results.push('uncertain仍报告同一quizKey；改课程上下文不绕过检查，停止后busy=false仍保留key，无求解/填写/重复提交');
  await pending.close();
  const submitting = await fixture(textQuestion + '<button class="btnSubmit workBtnIndex" onclick="submitClicks++">提交</button>');
  await transport(submitting, '', true);
  await submitting.waitForFunction(() => reports.some(report => report.mode === 'submitting' && report.busy && report.quizKey));
  const activeKey = await submitting.evaluate(() => reports.at(-1).quizKey);
  assert.match(activeKey, /^[a-f0-9]{64}$/);
  assert.equal(await submitting.evaluate(key => records['quiz:' + key].stage, activeKey), 'submitting');
  await submitting.evaluate(() => { enabled = false; });
  await submitting.waitForFunction(() => reports.at(-1)?.mode === 'idle' && !reports.at(-1).busy);
  assert.equal(await submitting.evaluate(() => reports.at(-1).quizKey), activeKey);
  assert.equal(await submitting.evaluate(() => submitClicks), 1);
  assert.equal(await submitting.evaluate(key => records['quiz:' + key].stage, activeKey), 'submitting');
  results.push('实际提交等待循环报告原quizKey和busy=true；停止后busy=false且保留submitting意图，不再写入/再次点击');
  await submitting.close();
} finally { await browser.close(); }
const result = { at: new Date().toISOString(), passed: results.length, results, scope: 'Intercepted disposable fixtures; UEditor DOM/HTML save shape simulated, not a real course submission.' };
await writeFile(join(root, 'test/context-editor-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
