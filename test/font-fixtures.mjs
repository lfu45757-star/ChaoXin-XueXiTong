// Real embedded-font bytes, intercepted disposable browser; no course/model calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
import { syntheticFont } from './font-synthetic.mjs';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const files = ['vendor/typr-md5.js', 'vendor/cx-glyph-map.js', 'font-decoder.js', 'adapter.js', 'content.js'];
const scripts = await Promise.all(files.map(file => readFile(join(root, 'extension', file), 'utf8')));
const provenance = JSON.parse(await readFile(join(root, 'extension/vendor/font-assets.json'), 'utf8'));
let font = null;
if (!process.argv.includes('--without-live-font')) {
  try { font = await readFile(join(root, 'test/fixtures/live-cx-font.ttf')); } catch(error) { if(error.code!=='ENOENT')throw error; }
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
if(font)assert.equal(sha256(font), 'e11d1befc5b496e0d827f116ca0e73867ccb4d0728f50dcdba08684f735ed93b');
assert.equal(sha256(scripts[0]), provenance.library.sha256);
assert.equal(sha256(scripts[1]), provenance.table.shippedSha256);
const dataContext = vm.createContext({});
vm.runInContext(scripts[1], dataContext);
assert.equal(Object.keys(dataContext.ChaoxingGlyphMap).length, 20902);
assert.equal(new Set(Object.values(dataContext.ChaoxingGlyphMap)).size, 20902);
assert.equal(sha256(JSON.stringify(dataContext.ChaoxingGlyphMap)), provenance.table.dataSha256);
const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
const order = manifest.content_scripts.find(item => item.js.includes('content.js')).js;
assert.ok(order.indexOf('vendor/typr-md5.js') < order.indexOf('font-decoder.js'));
assert.ok(order.indexOf('vendor/cx-glyph-map.js') < order.indexOf('font-decoder.js'));
assert.ok(order.indexOf('font-decoder.js') < order.indexOf('adapter.js'));
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw new Error('No disposable fixture browser found');
const browser = await chromium.launch({ executablePath, headless: true });
const results = ['供应商库与字形数据的 SHA-256 一致，映射表20,902项，manifest加载顺序正确'];
const skipped = [];
const encoded = '在坓环坕中使用 __ 坔句坍以跳坒坓环坕.';
const decoded = '在循环体中使用 __ 语句可以跳出循环体.';
const code = 'for i in range(3):\n    if i == 1:\n        continue\n    print(i)\nprint("done")';
const fontStyle = bytes => bytes ? `<style>@font-face{font-family:"cx-fixture";src:url("data:font/ttf;base64,${bytes.toString('base64')}") format("truetype")} .font-cxsecret{font-family:"cx-fixture"} pre{white-space:pre}</style>` : '<style>pre{white-space:pre}</style>';
const question = title => `<div class="singleQuesId"><input id="answertype1" type="hidden" value="0"><div class="Zy_TItle">${title}</div><label><input type="radio" name="answer">A、1</label><label><input type="radio" name="answer">B、2</label></div>`;
async function pageWith(html, bytes = font) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fontStyle(bytes) + html }));
  await page.goto('https://mooc1.chaoxing.com/work/font-fixture');
  await page.evaluate(() => { window.networkCalls = 0; window.fetch = () => { networkCalls++; throw new Error('Font fixtures must never fetch'); }; });
  for (const content of scripts.slice(0, 4)) await page.addScriptTag({ content });
  return page;
}
try {
  const synthetic = await pageWith(question('<span class="font-cxsecret">坓</span>'),syntheticFont());
  await synthetic.evaluate(base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),f=Typr.parse(bytes.buffer)[0],id=Typr.U.codeToGlyph(f,0x5753);
    const hash=md5(JSON.stringify(Typr.U.glyphToPath(f,id))).slice(-8);
    // An original test-only triangle/character mapping, never shipped in production data.
    globalThis.ChaoxingGlyphMap=Object.freeze({...ChaoxingGlyphMap,[hash]:0x4e2d});
  },syntheticFont().toString('base64'));
  assert.deepEqual(await synthetic.evaluate(()=>({text:ChaoxingAdapter.parseQuestions()[0].data.text,blocked:ChaoxingAdapter.parseQuestions()[0].hasEncodedFont})),{text:'中',blocked:false});
  assert.equal(await synthetic.locator('.font-cxsecret').innerText(),'坓');
  results.push('原创合成TTF轮廓与测试专用映射可走完整本地解析/MD5/节点恢复链路，发布包无需真实课程字体');
  const formatted = await pageWith(question(`普通坓<pre><code>${code}</code></pre>`),null);
  assert.ok((await formatted.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].data.text)).includes(code));
  assert.ok((await formatted.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].data.text)).startsWith('普通坓'));
  results.push('没有本地课程字体时仍验证普通文字与Python换行、缩进提取');
  const englishCloze = await pageWith(`<div class="TiMu" data="2"><div class="Zy_TItle font-cxsecret"><span class="newZy_TItle">【填空题】</span><p>Directions: Fill ten blanks from the word bank.</p><p>Social media allows people to 1) _____ contact with friends.</p></div><ul class="Zy_ulTk"><li><textarea></textarea></li></ul></div>`,null);
  assert.deepEqual(await englishCloze.evaluate(()=>{const q=ChaoxingAdapter.parseQuestions()[0];return {text:q.data.text,type:q.data.type,blocked:q.hasEncodedFont,slots:q.data.slots};}),
    {text:'【填空题】\nDirections: Fill ten blanks from the word bank.\nSocial media allows people to 1) _____ contact with friends.',type:'blank',blocked:false,slots:1});
  await englishCloze.locator('.Zy_TItle p').last().evaluate(node=>node.textContent+=' 坓');
  assert.equal(await englishCloze.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].hasEncodedFont),true);
  await englishCloze.close();
  results.push('英文填空题仅有固定题型标签时不误判特殊字体；正文出现未知汉字仍暂停');
  const custom = (type,handler,aria=true) => `<div class="singleQuesId"><input id="answertype1" type="hidden" value="${type}"><div class="Zy_TItle">${type==='3'?'【判断题】':'【单选题】'}测试</div><ul><li class="before-after" role="radio" ${aria?'aria-checked="true"':''} onclick="${handler}">A、${type==='3'?'正确':'选项一'}</li><li class="before-after" role="radio" ${aria?'aria-checked="false"':''} onclick="${handler}">B、${type==='3'?'错误':'选项二'}</li></ul></div>`;
  const handler="this.parentElement.querySelectorAll('li').forEach(x=>{x.setAttribute('aria-checked','false');x.classList.remove('check_answer_dx');});this.setAttribute('aria-checked','true');this.classList.add('check_answer_dx');";
  for(const type of ['0','3']) {
    const page=await pageWith(custom(type,handler),null);
    assert.equal(await page.locator('input[type=radio]').count(),0);
    await page.evaluate(()=>ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}]));
    assert.deepEqual(await page.locator('li').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-checked'))),['false','true']);
    await page.close();
  }
  const classOnly=await pageWith(custom('0',"this.parentElement.querySelectorAll('li').forEach(x=>x.classList.remove('check_answer_dx'));this.classList.add('check_answer_dx');",false),null);
  await classOnly.evaluate(()=>ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}]));
  assert.equal(await classOnly.locator('li.check_answer_dx').innerText(),'B、选项二');
  results.push('无input的真实LI role=radio单选/判断可按aria及已知选中class校验最终键集合');
  const dead=await pageWith(custom('0',''),null);
  await assert.rejects(()=>dead.evaluate(()=>ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}])) ,/页面未接受选项/);
  const unknownWidget=await pageWith(custom('0','').replaceAll('before-after','answerBg').replaceAll(/ aria-checked="(?:true|false)"/g,''),null);
  await assert.rejects(()=>unknownWidget.evaluate(()=>ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}])) ,/无法验证自定义选项状态/);
  results.push('无input选项点击未生效或状态未知时拒绝完成填写/提交');
  const typeFixture = await pageWith(`
    <div class="singleQuesId"><div class="TiMu" data="4"><div class="Zy_TItle"><span class="newZy_TItle">【简答题】</span>编写函数，判断输入的三个数字能否构成三角形。</div><ul class="Zy_ulTk"><li><textarea></textarea></li></ul></div></div>
    <div class="singleQuesId"><div class="TiMu" data="0"><div class="Zy_TItle"><span class="newZy_TItle">【单选题】</span>判断以下说法。</div><label><input type="radio">A 正确</label><label><input type="radio">B 错误</label></div></div>
    <div class="singleQuesId"><div class="TiMu" data="3"><div class="Zy_TItle"><span class="newZy_TItle">【判断题】</span>函数可以有参数。</div><label><input type="radio">A 对</label><label><input type="radio">B 错</label></div></div>`, null);
  assert.deepEqual(await typeFixture.evaluate(() => ChaoxingAdapter.parseQuestions().map(q => q.data.type)), ['text', 'single', 'boolean']);
  await typeFixture.close();
  results.push('题干中的“判断”不改变简答题或单选题类型；优先使用平台 TiMu 题型标记');
  if(font) {
  const good = await pageWith(question(`<span class="font-cxsecret">${encoded}</span>`));
  const original = await good.locator('.singleQuesId').innerHTML();
  await good.evaluate(() => { window.parseCalls=0; const parse=Typr.parse;Typr.parse=function(...args){parseCalls++;return parse.apply(this,args);}; });
  let extracted = await good.evaluate(() => ChaoxingAdapter.parseQuestions().map(q => ({...q.data, blocked:q.hasEncodedFont})));
  assert.equal(extracted[0].text, decoded);
  assert.equal(extracted[0].blocked, false);
  await good.evaluate(() => ChaoxingAdapter.parseQuestions());
  assert.equal(await good.evaluate(() => parseCalls), 1);
  assert.equal(await good.locator('.singleQuesId').innerHTML(), original);
  assert.equal(await good.locator('.font-cxsecret').innerText(), encoded);
  assert.equal(await good.evaluate(() => networkCalls),0);
  await good.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}]));
  assert.deepEqual(await good.locator('input[type=radio]').evaluateAll(nodes=>nodes.map(node=>node.checked)),[false,true]);
  results.push('真实课程字体恢复完整题干；同字体只解析一次；DOM、特殊字体class与原始文字不改变；恢复后正常填答');
  const session = await good.context().newCDPSession(good);
  const {frameTree} = await session.send('Page.getFrameTree');
  const {executionContextId} = await session.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'cx-font-fixture'});
  const evaluateIsolated = async expression => {
    const result=await session.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  assert.equal(await evaluateIsolated('typeof globalThis.Typr'),'undefined');
  for(const script of scripts.slice(0,4))await evaluateIsolated(script);
  assert.deepEqual(await evaluateIsolated('({text:ChaoxingAdapter.parseQuestions()[0].data.text,blocked:ChaoxingAdapter.parseQuestions()[0].hasEncodedFont})'),{text:decoded,blocked:false});
  assert.equal(await good.locator('.font-cxsecret').innerText(),encoded);
  await session.detach();
  results.push('真正ISOLATED world独立加载vendor/decoder/adapter后仍可读取共享DOM字体并恢复题干，不依赖页面Typr全局');

  const mixed = await pageWith(question(`普通坓 <span class="font-cxsecret">坓环坕</span><pre><code>${code}</code></pre><span>尾文</span>`));
  await mixed.locator('label').nth(0).evaluate(node=>node.innerHTML='<input type="radio" name="answer">A、<pre>if True:\n    print(1)</pre>');
  extracted = await mixed.evaluate(() => ChaoxingAdapter.parseQuestions().map(q=>({...q.data,blocked:q.hasEncodedFont})));
  assert.ok(extracted[0].text.includes('普通坓 循环体'));
  assert.ok(extracted[0].text.includes(code));
  assert.ok(extracted[0].options[0].text.includes('if True:\n    print(1)'));
  assert.equal(extracted[0].blocked,false);
  assert.equal(await mixed.evaluate(()=>ChaoxingAdapter.text(document.querySelector('pre'))),'for i in range(3): if i == 1: continue print(i) print("done")');
  results.push('混合真实Text nodes只解码font-cxsecret部分；题干和选项保留Python换行/缩进；导航标签text规范化保持原行为');

  // Alter one real glyph coordinate, retaining its valid cmap/contour structure.
  const mutated = Buffer.from(font);
  const coordinate = await good.evaluate(base64 => {
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),f=Typr.parse(bytes.buffer)[0];
    const id=Typr.U.codeToGlyph(f,0x5753),base=Typr.findTable(f._data,'glyf',0)[0]+f.loca[id];
    const view=new DataView(bytes.buffer);const contours=view.getInt16(base);if(contours<=0)throw Error('Expected simple real fixture glyph');
    let cursor=base+10+contours*2;const points=view.getUint16(cursor-2)+1;const instructions=view.getUint16(cursor);cursor+=2+instructions;
    let count=0;while(count<points){const flag=bytes[cursor++];count++;if(flag&8)count+=bytes[cursor++];}
    return cursor+1;
  },font.toString('base64'));
  mutated[coordinate]^=1;
  const beforeChange = await good.evaluate(()=>parseCalls);
  await good.locator('style').evaluate((node,{before,after})=>{node.textContent=node.textContent.replace(before,after);},{before:font.toString('base64'),after:mutated.toString('base64')});
  assert.equal(await good.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].hasEncodedFont),true);
  assert.equal(await good.evaluate(()=>parseCalls),beforeChange+1);
  await good.locator('style').evaluate((node,{before,after})=>{node.textContent=node.textContent.replace(before,after);},{before:mutated.toString('base64'),after:font.toString('base64')});
  assert.equal(await good.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].data.text),decoded);
  assert.equal(await good.evaluate(()=>parseCalls),beforeChange+1);
  results.push('同一font-family内容改变后重新解析并暂停未知glyph，恢复原字体则复用按内容缓存而不复用错误映射');
  const unknown = await pageWith(question('<span class="font-cxsecret">坓</span>'),mutated);
  assert.equal(await unknown.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].hasEncodedFont),true);
  await assert.rejects(()=>unknown.evaluate(()=>ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(),[{id:'1',values:['B']}])) ,/字体未完整解码/);
  assert.deepEqual(await unknown.locator('input[type=radio]').evaluateAll(nodes=>nodes.map(node=>node.checked)),[false,false]);
  results.push('真实字体中存在但hash未知的glyph继续触发门禁，直接applyAnswers也拒绝填写');

  const missing = await pageWith('<div class="singleQuesId"><div class="Zy_TItle"><span class="font-cxsecret" style="font-family:unavailable">坓</span></div><label><input type="radio">A、1</label><label><input type="radio">B、2</label></div>');
  assert.equal(await missing.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].hasEncodedFont),true);
  const ordinary = await pageWith(question('普通文字坓，不带特殊字体。'));
  assert.equal(await ordinary.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].data.text),'普通文字坓，不带特殊字体。');
  assert.equal(await ordinary.evaluate(()=>ChaoxingAdapter.parseQuestions()[0].hasEncodedFont),false);
  results.push('缺失匹配字体时保持暂停；普通中文不会误解码，内嵌字体cmap缺省的正常字按浏览器fallback保持原样');

  async function runContent(page, solution = {answers:[{id:'1',values:['B'],confidence:.99,explanation:'fixture'}]}) {
    await page.locator('body').evaluate(node=>node.insertAdjacentHTML('beforeend','<button id="submit" onclick="window.submits++;document.getElementById(\'done\').className=\'testTit_status_complete\'">提交</button><span id="done"></span>'));
    await page.evaluate(solution=>{
      window.submits=0;window.calls=0;window.records={};window.fixtureSolution=solution;
      globalThis.chrome={storage:{local:{get:async k=>({[k]:records[k]}),set:async v=>Object.assign(records,v)}},runtime:{sendMessage:async m=>{
        if(m.type==='state')return{ok:true,value:{enabled:true,config:{confidence:.85,autoSubmit:true,nextSelector:'',completeSelector:''}}};
        if(m.type==='solve'){calls++;window.sent=m.questions;return{ok:true,value:fixtureSolution};}
        if(m.type==='claimTask')return{ok:true,value:{ok:true}};
        if(m.type==='reports')return{ok:true,value:[]};
        if(m.type==='report')window.lastReport=m.value;
        return{ok:true,value:{ok:true}};
      }}};
    },solution);
    await page.addScriptTag({content:scripts[4]});
  }
  const automatic = await pageWith(question(`<span class="font-cxsecret">${encoded}</span><pre>${code}</pre>`));
  await runContent(automatic);
  await automatic.waitForFunction(()=>submits===1);
  assert.equal(await automatic.evaluate(()=>calls),1);
  assert.ok((await automatic.evaluate(()=>sent[0].text)).includes(decoded));
  assert.ok((await automatic.evaluate(()=>sent[0].text)).includes(code));
  const fallback = await pageWith(question('低置信度复核失败后继续'),null);
  await runContent(fallback,{answers:[{id:'1',values:['B'],confidence:.4,explanation:'first answer'}],
    review:{attempted:true,threshold:.85,outcomes:[{id:'1',status:'failed'}]}});
  await fallback.waitForFunction(()=>submits===1);
  assert.equal(await fallback.evaluate(()=>calls),1);
  assert.deepEqual(await fallback.locator('input[type=radio]').evaluateAll(nodes=>nodes.map(node=>node.checked)),[false,true]);
  const unreviewed = await pageWith(question('未复核的低置信度答案'),null);
  await runContent(unreviewed,{answers:[{id:'1',values:['B'],confidence:.4,explanation:'first answer'}]});
  await unreviewed.waitForFunction(()=>window.lastReport?.mode==='blocked');
  assert.match(await unreviewed.evaluate(()=>lastReport.status),/尚未完成复核/);
  assert.equal(await unreviewed.evaluate(()=>submits),0);
  results.push('低置信度答案经二次复核失败后仍可填写并提交；缺少复核回执仍停止');
  const unanswered = await pageWith(question('需要上传文件的任务'),null);
  await runContent(unanswered,{answers:[{id:'1',values:['B'],confidence:0,explanation:'缺少完成任务所需的文件'}],
    review:{attempted:true,threshold:.85,outcomes:[{id:'1',status:'inconclusive'}]}});
  await unanswered.waitForFunction(()=>window.lastReport?.mode==='skipped');
  assert.equal(await unanswered.evaluate(()=>lastReport.skipReason),'no-valid-answer');
  assert.equal(await unanswered.evaluate(()=>submits),0);
  assert.deepEqual(await unanswered.locator('input[type=radio]').evaluateAll(nodes=>nodes.map(node=>node.checked)),[false,false]);
  results.push('置信度为零的任务报告为跳过，不填写、不提交且不伪装为完成');
  const blocked = await pageWith(question('<span class="font-cxsecret">坓</span>'),mutated);
  await runContent(blocked);
  await blocked.waitForFunction(()=>window.lastReport?.mode==='blocked');
  assert.match(await blocked.evaluate(()=>window.lastReport.status), /第 1 题特殊字体未完整解码/);
  await blocked.waitForTimeout(3500);
  assert.equal(await blocked.evaluate(()=>calls),0);
  assert.equal(await blocked.evaluate(()=>submits),0);
  results.push('完整content链路发送已还原且保留代码格式的题干并正常填答/确认；未知glyph从不调用solver或提交');
  } else skipped.push('SKIP: 本地专用 live-cx-font.ttf 不存在或显式禁用；真实课程字体分支跳过，合成字体、格式及控件验证仍执行。');
  const report={at:new Date().toISOString(),browser:await browser.version(),scope:'fully intercepted disposable browser; original synthetic font plus optional local-only real font; simulated extension transport/solver; no live submissions or model calls',font:font?{bytes:font.length,sha256:sha256(font)}:{available:false},checks:results,skipped};
  await writeFile(join(root,process.argv.includes('--without-live-font')?'test/font-synthetic-results.json':'test/font-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
