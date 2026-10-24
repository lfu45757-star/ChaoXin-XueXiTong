// Run separately: node test/browser-fixtures.mjs
// Headless browser, disposable profile, intercepted fixture URLs only.
import { createRequire } from 'node:module';
import { access, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { root } from '../lib/solver.mjs';
import { join } from 'node:path';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const candidates = [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
if (!executablePath) throw new Error('未发现测试浏览器，可设置 CX_TEST_BROWSER');
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body>fixture</body></html>' }));
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=fixture');
  const adapter = await readFile(join(root, 'extension/adapter.js'), 'utf8');
  const content = await readFile(join(root, 'extension/content.js'), 'utf8');
  const documentScroll = await readFile(join(root, 'extension/document-scroll.js'), 'utf8');
  const fixture = `<div class="singleQuesId" data="q1"><input id="answertype1" type="hidden" value="0"><div class="Zy_TItle">【单选题】2+2=?</div><ul class="Zy_ulTop"><li class="before-after" onclick="document.querySelectorAll('[name=answer1]').forEach(x=>x.classList.remove('check_answer'));this.firstElementChild.classList.add('check_answer')"><span name="answer1">A</span>、3</li><li class="before-after" onclick="document.querySelectorAll('[name=answer1]').forEach(x=>x.classList.remove('check_answer'));this.firstElementChild.classList.add('check_answer')"><span name="answer1">B</span>、4</li></ul></div>`;
  await page.setContent(fixture); await page.addScriptTag({ content: adapter });
  const parsed = await page.evaluate(() => ChaoxingAdapter.parseQuestions().map(q => q.data));
  assert.equal(parsed.length, 1); assert.equal(parsed[0].type, 'single'); assert.equal(parsed[0].options.length, 2);
  await page.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: ['B'] }]));
  assert.equal(await page.locator('[name=answer1].check_answer').innerText(), 'B');
  results.push('实际超星类名 singleQuesId / answertype / before-after / check_answer 的提取与选中校验');
  await page.setContent(`<div class="singleQuesId"><div class="Zy_TItle">【多选题】选择偶数</div><label><input type="checkbox">A、2</label><label><input type="checkbox" checked>B、3</label><label><input type="checkbox">C、4</label></div>`);
  await page.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: ['A', 'C'] }]));
  assert.deepEqual(await page.locator('input').evaluateAll(xs => xs.map(x => x.checked)), [true, false, true]);
  results.push('多选题清除旧选项并校验新选项');
  await page.setContent(`<div class="singleQuesId"><input id="answertype1" type="hidden" value="2"><div class="Zy_TItle">【填空题】中国首都是</div><div class="blankItemDiv"><textarea style="display:none"></textarea><div class="InpDIV" contenteditable="true"></div></div></div>`);
  await page.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [{ id: '1', values: ['北京'] }]));
  assert.equal(await page.locator('textarea').inputValue(), '北京'); assert.equal(await page.locator('.InpDIV').innerText(), '北京');
  results.push('富文本填空的隐藏 textarea 与可见编辑区同步');
  await page.setContent(`<div class="ans-attach-ct"><span class="ans-job-icon"></span></div><button id="prevNextFocusNext">下一节</button>`);
  assert.equal(await page.evaluate(() => ChaoxingAdapter.completion('')), false);
  await page.locator('.ans-attach-ct').evaluate(x => x.classList.add('ans-job-finished'));
  assert.equal(await page.evaluate(() => ChaoxingAdapter.completion('')), true);
  results.push('仅平台 ans-job-finished 标记确认任务完成');
  await page.setContent(fixture + `<iframe id="iframe" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture"></iframe><button class="btnSubmit workBtnIndex" onclick="window.submits=(window.submits||0)+1;document.getElementById('done').className='testTit_status_complete'">提交</button><span id="done"></span><div class="ans-attach-ct"><span class="ans-job-icon"></span></div><button id="prevNextFocusNext">下一节</button>`);
  await page.evaluate(() => {
    window.events=[];window.records={};window.submits=0;window.enabled=true;
    window.frameReports=[{frameId:999,url:'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture',cardsReady:true,jobTotal:0,jobDone:0}];
    globalThis.chrome={ storage:{ local:{ get:async key=>({[key]:window.records[key]}),set:async value=>Object.assign(window.records,value)} }, runtime:{ sendMessage:async m=> {
      if(m.type==='state')return{ok:true,value:{enabled:window.enabled,config:{confidence:0.85,autoSubmit:true,nextSelector:'',completeSelector:''}}};
      if(m.type==='solve')return{ok:true,value:{answers:[{id:'1',values:['B'],confidence:0.99,explanation:'fixture'}]}};
      if(m.type==='claimTask')return{ok:true,value:{ok:true}};
      if(m.type==='reports')return{ok:true,value:window.frameReports||[]};
      if(m.type==='report')window.lastReport=m.value;
      if(m.type==='event')window.events.push(m.value);
      return{ok:true,value:{ok:true}};
    }}};
  });
  await page.addScriptTag({ content });
  await page.waitForFunction(() => Object.values(records).some(x => x.stage === 'submitted'), null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => submits), 1);
  assert.equal(await page.evaluate(() => events.some(x => x.type === 'next')), false);
  await page.locator('.ans-attach-ct').evaluate(x => x.classList.add('ans-job-finished'));
  await page.locator('#prevNextFocusNext').evaluate(x => x.onclick = () => { x.textContent='已进入下一节'; document.querySelectorAll('.singleQuesId').forEach(x=>x.remove()); document.getElementById('iframe').src='about:blank#chapter2'; document.querySelector('.ans-attach-ct').classList.remove('ans-job-finished'); });
  await page.waitForFunction(() => events.some(x => x.type === 'next'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => submits), 1);
  assert.equal(await page.locator('#prevNextFocusNext').innerText(), '已进入下一节');
  await page.waitForTimeout(12500);
  assert.doesNotMatch(await page.evaluate(()=>lastReport.status),/页面未变化/);
  assert.equal(await page.evaluate(()=>events.filter(x=>x.type==='next').length),1);
  results.push('完整内容脚本：agent 答案→填写→只提交一次→确认→等待平台标记→下一章节');
  results.push('地址栏不变的 iframe 章节切换不误判失败，且只跳转一次');
  await page.close();
  async function scenario(html, settings = {}) {
    const p = await browser.newPage();
    const childPath = settings.childPath || '/mooc-ans/knowledge/cards';
    // These transport fixtures simulate a ready native cards report. The
    // separate navigation-gate fixtures exercise missing/loading/stale reports.
    const syntheticCards = !settings.childHtml && !settings.url;
    if (syntheticCards) html += '<iframe id="iframe" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture"></iframe>';
    await p.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      new URL(route.request().url()).pathname === childPath && (settings.childHtml || syntheticCards) ? (settings.childHtml || '<body>Loaded native cards transport fixture</body>') : html }));
    await p.goto(settings.url || 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=fixture');
    await p.evaluate(settings => {
      window.records={};window.events=[];window.enabled=true;window.solverCalls=0;window.frameReports=settings.frames||[];window.scrolls=[];
      if(settings.syntheticCards)frameReports.push({frameId:999,url:'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture',cardsReady:true,jobTotal:0,jobDone:0});
      if(settings.trackScroll){const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){scrolls.push(this.id);return original.apply(this,args);};}
      globalThis.chrome={storage:{local:{get:async key=>({[key]:records[key] || (key.startsWith('quiz:') && settings.checkpoint ?
        { ...settings.checkpoint, context: settings.checkpoint.context || globalThis.ChaoxingAdapter?.courseContext() } :
        settings.checkpointStage && key.startsWith('quiz:') ? {stage:settings.checkpointStage}:undefined)}),set:async value=>Object.assign(records,value)}},runtime:{sendMessage:async m=>{
        if(m.type==='state')return{ok:true,value:{enabled,config:{confidence:0.85,autoSubmit:true,nextSelector:'',completeSelector:''}}};
        if(m.type==='solve'){solverCalls++;if(settings.delay)await new Promise(r=>setTimeout(r,settings.delay));return{ok:true,value:{answers:[{id:'1',values:['B'],confidence:settings.confidence??0.99,explanation:'fixture'}]}};}
        if(m.type==='claimTask')return{ok:true,value:{ok:true}};
        if(m.type==='reports')return{ok:true,value:frameReports};
        if(m.type==='report')window.lastReport=m.value;
        if(m.type==='event')events.push(m.value);
        return{ok:true,value:{ok:true}};
      }}};
    }, { ...settings, syntheticCards });
    await p.addScriptTag({ content: documentScroll });
    await p.addScriptTag({ content: adapter });
    await p.addScriptTag({ content });
    if (settings.childHtml) {
      const child = p.frames().find(f => { try { return new URL(f.url()).pathname === childPath; } catch { return false; } });
      assert.ok(child, 'nested task frame loaded');
      await child.evaluate(() => {
        globalThis.chrome={storage:window.parent.chrome.storage,runtime:{sendMessage:async m=>{
          if(m.type==='report'){window.parent.frameReports=[{frameId:1,...m.value}];return{ok:true,value:{ok:true}};}
          return window.parent.chrome.runtime.sendMessage(m);
        }}};
      });
      await child.addScriptTag({content:documentScroll});
      await child.addScriptTag({content:adapter});
      await child.addScriptTag({content});
    }
    return p;
  }
  const low = await scenario(fixture + '<button onclick="window.submitted=true">提交</button>', { confidence: 0.5 });
  await low.waitForFunction(() => events.some(e=>e.type==='blocked'));
  assert.equal(await low.evaluate(() => !!window.submitted), false);
  assert.equal(await low.locator('.check_answer').count(), 0);
  results.push('低置信度答案不会填写或提交'); await low.close();
  const stopped = await scenario(fixture + '<button onclick="window.submitted=true">提交</button>', { delay: 1200 });
  await stopped.waitForFunction(() => solverCalls === 1);
  await stopped.evaluate(() => { enabled=false; });
  await stopped.waitForTimeout(1600);
  assert.equal(await stopped.evaluate(() => !!window.submitted), false);
  assert.equal(await stopped.locator('.check_answer').count(), 0);
  results.push('停止后拒绝迟到的 agent 答案'); await stopped.close();
  const popup = await scenario('<div id="workpop">是否提交本次作业？<button id="popok" onclick="window.confirmed=(window.confirmed||0)+1;this.parentElement.style.display=\'none\';frameReports[0]={frameId:1,busy:false,mode:\'complete\',status:\'完成\',jobTotal:1,jobDone:0}">确定</button></div><button id="prevNextFocusNext">下一节</button>',
    { frames: [{ frameId:1,busy:true,mode:'submitting',status:'提交中',jobTotal:1,jobDone:0 }] });
  await popup.waitForFunction(() => window.confirmed === 1);
  assert.equal(await popup.evaluate(() => events.some(e=>e.type==='next')),false);
  await popup.locator('#prevNextFocusNext').evaluate(x=>x.onclick=()=>history.pushState({},'',location.pathname+'?courseid=fixture&chapter=3'));
  await popup.evaluate(() => { frameReports[0].jobDone=1; });
  await popup.waitForFunction(() => events.some(e=>e.type==='next'), null, { timeout:15000 });
  results.push('父页面提交确认弹窗与子 frame 平台完成状态汇总'); await popup.close();
  const splitPopup = await scenario('<div class="maskDiv"><div id="workpopFocus" role="alertdialog"><span>提示</span></div><div id="popcontent">确认提交？</div><button id="popok" onclick="window.confirmed=(window.confirmed||0)+1;this.parentElement.style.display=\'none\';frameReports[0]={frameId:1,busy:false,mode:\'complete\',status:\'完成\',jobTotal:1,jobDone:1}">确定</button><button id="popno">取消</button></div><button id="prevNextFocusNext">下一节</button>',
    { frames: [{ frameId:1,busy:true,mode:'submitting',status:'提交中',jobTotal:1,jobDone:0 }] });
  await splitPopup.waitForFunction(() => window.confirmed === 1);
  assert.equal(await splitPopup.evaluate(() => confirmed),1);
  await splitPopup.close();
  const unrelatedPopup = await scenario('<div class="maskDiv"><div id="workpopFocus" role="alertdialog"><span>提示</span></div><div id="popcontent">请先登录</div><button id="popok" onclick="window.confirmed=true">确定</button></div>',
    { frames: [{ frameId:1,busy:true,mode:'submitting',status:'提交中',jobTotal:1,jobDone:0 }] });
  await unrelatedPopup.waitForTimeout(1300);
  assert.equal(await unrelatedPopup.evaluate(() => !!window.confirmed),false);
  await unrelatedPopup.close();
  const pendingPopup = await scenario('<div class="maskDiv"><div id="workpopFocus" role="alertdialog"><span>提示</span></div><div id="popcontent">确认提交？</div><button id="popok" onclick="window.confirmed=(window.confirmed||0)+1">确定</button></div>',
    { frames: [{ frameId:1,busy:false,mode:'blocked',status:'提交结果未确认，已停止重复提交，请检查平台',quizKey:'a'.repeat(64),jobTotal:1,jobDone:0 }] });
  await pendingPopup.waitForFunction(() => window.confirmed === 1);
  await pendingPopup.waitForTimeout(2400);
  assert.equal(await pendingPopup.evaluate(() => confirmed),1);
  await pendingPopup.close();
  results.push('studentstudy 的标题、提示文字与确认按钮为兄弟节点时仅确认提交；旧提交意图可完成仍打开的弹窗且不重复点击');
  const competing = await scenario('<div class="maskDiv"><div id="workpop" class="popDiv"><p id="popcontent">确认提交?</p><a id="popok" onclick="window.confirmed=(window.confirmed||0)+1;document.querySelector(\'.maskDiv\').style.display=\'none\';frameReports[1]={frameId:2,busy:false,mode:\'complete\',status:\'第二任务完成\',jobTotal:1,jobDone:1}">确定</a></div></div><div class="ans-attach-ct ans-job-finished"><span class="ans-job-icon"></span></div><button id="prevNextFocusNext" onclick="window.nextClicks=(window.nextClicks||0)+1;frameReports=[];document.querySelector(\'.ans-attach-ct\').remove();history.pushState({},\'\',location.pathname+\'?courseid=fixture&chapter=4\')">下一节</button>',
    {frames:[
      {frameId:1,busy:true,mode:'blocked',status:'第一任务提交结果未知',jobTotal:1,jobDone:0},
      {frameId:2,busy:true,mode:'quiz',status:'第二任务解答中',jobTotal:1,jobDone:0}
    ]});
  await competing.waitForFunction(()=>window.lastReport?.status==='第二任务解答中');
  assert.equal(await competing.evaluate(()=>!!window.confirmed),false);
  await competing.evaluate(()=>{frameReports[1].mode='submitting';frameReports[1].status='第二任务提交中';});
  await competing.waitForFunction(()=>window.confirmed===1);
  await competing.waitForTimeout(7500);
  assert.equal(await competing.evaluate(()=>events.some(e=>e.type==='next')),false);
  await competing.evaluate(()=>{frameReports[0].mode='awaiting-completion';frameReports[0].busy=false;frameReports[0].status='第一任务等待平台标记';});
  await competing.waitForTimeout(3500);
  assert.equal(await competing.evaluate(()=>events.some(e=>e.type==='next')),false,'top completion cannot override a pending child marker');
  assert.equal(await competing.evaluate(()=>confirmed),1);
  await competing.evaluate(()=>{frameReports[0].mode='complete';frameReports[0].jobDone=1;});
  await competing.waitForFunction(()=>window.nextClicks===1,null,{timeout:10000});
  assert.equal(await competing.evaluate(()=>confirmed),1);
  results.push('前一child blocked不遮蔽后续busy/submitting及真实workpop确认；top完成标记不能覆盖未完成child，全部完成后才跳转');
  await competing.close();
  const uncertain = await scenario(fixture+'<button onclick="window.submits=(window.submits||0)+1">提交</button>',{checkpointStage:'uncertain'});
  await uncertain.waitForFunction(()=>window.lastReport?.mode==='blocked');
  await uncertain.waitForTimeout(3500);
  assert.equal(await uncertain.evaluate(()=>solverCalls),0);
  assert.equal(await uncertain.evaluate(()=>window.submits||0),0);
  assert.equal(await uncertain.locator('.check_answer').count(),0);
  assert.match(await uncertain.evaluate(()=>lastReport.status),/上次提交结果尚未确认/);
  results.push('unknown/uncertain提交checkpoint保持暂停，不调用solver、不重新填写或重复提交');
  await uncertain.close();
  const staleAnswer = {stage:'uncertain',at:Date.now()-180000,answers:[{id:'1',values:['B'],confidence:0.99,explanation:'fixture'}]};
  const recovered = await scenario(fixture+'<div id="RightCon"><span class="testTit_status">待完成</span></div><button class="btnSubmit workBtnIndex" onclick="window.submits=(window.submits||0)+1;this.insertAdjacentHTML(\'afterend\',\'<span class=testTit_status_complete>已提交</span>\')">提交</button>',
    {url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=fixture',checkpoint:staleAnswer});
  await recovered.waitForFunction(()=>Object.values(records).some(x=>x.stage==='submitted'),null,{timeout:10000});
  assert.equal(await recovered.evaluate(()=>window.submits||0),1);
  assert.equal(await recovered.evaluate(()=>solverCalls),0);
  results.push('刷新后的平台明确待完成且旧记录超过两分钟时，只用已核对答案恢复提交一次');
  await recovered.close();
  const exhausted = await scenario(fixture+'<div id="RightCon"><span class="testTit_status">待完成</span></div><button onclick="window.submits=(window.submits||0)+1">提交</button>',
    {url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=fixture',checkpoint:{...staleAnswer,recoveryCount:1}});
  await exhausted.waitForFunction(()=>window.lastReport?.mode==='blocked');
  assert.equal(await exhausted.evaluate(()=>window.submits||0),0);
  results.push('一次恢复仍未确认时保持暂停，防止无限重试');
  await exhausted.close();
  const documentPage = await scenario('<ul class="fileBox"><li id="p1" style="height:900px">文档第 1 页</li><li id="p2" style="height:900px">文档第 2 页</li></ul><button id="prevNextFocusNext">下一节</button>', { trackScroll:true });
  await documentPage.waitForFunction(() => scrolls.length===1 && window.lastReport?.mode==='complete', null, { timeout:5000 });
  assert.deepEqual(await documentPage.evaluate(() => scrolls), ['p2']);
  assert.equal(await documentPage.evaluate(() => events.some(e=>e.type==='next')), false);
  results.push('文档默认快速滚到末尾，缺少平台完成标记时不会跳转'); await documentPage.close();
  const textHtml = '<div class="ans-cc"><p>这是已经加载的课程文字阅读内容。请阅读这段完整的说明，了解本章节介绍的概念，并结合前面章节的知识进行思考。</p></div>';
  const nextText = '<button id="prevNextFocusNext" onclick="window.nextClicks=(window.nextClicks||0)+1;frameReports=[];document.getElementById(\'iframe\').src=\'about:blank#chapter2\'">下一节</button>';
  const textChapter = await scenario('<iframe id="iframe" style="width:900px;height:600px" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture"></iframe>' + nextText, {childHtml:textHtml});
  await textChapter.waitForFunction(()=>frameReports.some(f=>f.mode==='text'));
  assert.equal(await textChapter.evaluate(()=>events.some(e=>e.type==='next')),false);
  await textChapter.waitForFunction(()=>window.nextClicks===1,null,{timeout:25000});
  assert.equal(await textChapter.evaluate(()=>solverCalls),0);
  await textChapter.waitForTimeout(13000);
  assert.equal(await textChapter.evaluate(()=>nextClicks),1);
  assert.equal(await textChapter.evaluate(()=>events.filter(e=>e.type==='submitted').length),0);
  results.push('稳定加载的无任务点文字 cards 子页面经过浏览后，由父页面正常下一节入口跳转且只跳转一次'); await textChapter.close();
  const invalidTextPages = await Promise.all([
    scenario('<div class="ans-cc"></div><button id="prevNextFocusNext">下一节</button>',{url:'https://mooc1.chaoxing.com/knowledge/cards?courseid=fixture&case=empty'}),
    scenario(textHtml+'<div class="loading">正在加载课程内容</div><button id="prevNextFocusNext">下一节</button>',{url:'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture&case=loading'}),
    scenario(textHtml+'<iframe src="about:blank" title="task"></iframe><button id="prevNextFocusNext">下一节</button>',{url:'https://mooc1.chaoxing.com/knowledge/cards?courseid=fixture&case=task-frame'})
  ]);
  await Promise.all(invalidTextPages.map(p=>p.waitForTimeout(18000)));
  for (const p of invalidTextPages) {
    assert.equal(await p.evaluate(()=>events.some(e=>e.type==='next')),false);
    assert.equal(await p.evaluate(()=>!!lastReport?.untrackedTextViewed),false);
    await p.close();
  }
  results.push('空白/加载中的 cards 或包含任务 iframe 的章节不会被认定为无任务点文字阅读');
  const restored = await scenario('<iframe id="iframe" src="https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=fixture"></iframe><div class="ans-attach-ct"><span class="ans-job-icon"></span></div>'+nextText,
    {childHtml:fixture,checkpointStage:'submitted'});
  await restored.waitForFunction(()=>frameReports.some(f=>f.mode==='awaiting-completion'));
  assert.equal(await restored.evaluate(()=>solverCalls),0);
  await restored.waitForTimeout(7500);
  assert.equal(await restored.evaluate(()=>events.some(e=>e.type==='next')),false);
  await restored.locator('.ans-attach-ct').evaluate(x=>x.classList.add('ans-job-finished'));
  await restored.waitForFunction(()=>window.nextClicks===1,null,{timeout:10000});
  assert.equal(await restored.evaluate(()=>events.filter(e=>e.type==='submitted').length),0);
  results.push('恢复已提交 checkpoint 的子题目不占用执行状态，仍等待父页面平台完成标记后再跳转'); await restored.close();
  // Keep results honest: model, transport and platform are fixture implementations.
  const report = { at: new Date().toISOString(), browser: await browser.version(), scope: 'isolated local browser fixtures; simulated extension transport and agent; no live Chaoxing submissions', checks: results };
  await writeFile(join(root, 'test/browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
