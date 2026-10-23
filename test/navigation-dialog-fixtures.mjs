// Actual navigation scripts, reconstructed native dialog, no live course calls.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../rea-runtime/package.json',import.meta.url));
const {chromium}=require('playwright-core');
let executablePath;
for(const path of [process.env.CX_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)){
  try{await access(path);executablePath=path;break;}catch{}
}
if(!executablePath)throw Error('No fixture browser');
const names=['adapter.js','discussion.js','content.js'];
const sources=await Promise.all(names.map(name=>readFile(new URL('../extension/'+name,import.meta.url),'utf8')));
const browser=await chromium.launch({executablePath,headless:true});
const scenarios=['continue','new-task','busy','stop','unrelated-dialog','unchanged'];
async function check(scenario){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const key='https://mooc1.chaoxing.com/ananas/modules/discuss/index.html?task=fixture';
  const html=`<div class="ans-attach-ct"><span class="ans-job-icon"></span><iframe src="${key}"></iframe></div><button id="prevNextFocusNext">下一节</button><div class="maskDiv jobFinishTip" style="display:none"><div class="popDiv"><div id="jobFinishTipFocus" class="popHead">提示</div><p id="message">当前章节还有任务点未完成，是否去完成？</p><a href="javascript:" style="display:none">上一节</a><a href="javascript:" id="confirmNext">下一节</a><a href="javascript:" id="goStudy">去学习</a></div></div>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().includes('/ananas/')?'Module fixture':html}));
  await page.goto('https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=fixture');
  await page.evaluate(({scenario,key})=>{
    window.enabled=true;window.footerClicks=0;window.confirmClicks=0;window.latestReport={};window.currentFrames=[];
    document.querySelector('#prevNextFocusNext').onclick=()=>{
      footerClicks++;document.querySelector('.jobFinishTip').style.display='block';
      if(scenario==='new-task'){const task=document.createElement('div');task.className='ans-attach-ct';task.innerHTML='<span class="ans-job-icon"></span><iframe src="/unknown"></iframe>';document.body.append(task);}
      if(scenario==='busy')currentFrames=[{frameId:9,mode:'quiz',busy:true,jobTotal:0,jobDone:0,at:Date.now()}];
      if(scenario==='stop')enabled=false;
      if(scenario==='unrelated-dialog')document.querySelector('#message').textContent='这是不同的操作，是否继续？';
    };
    document.querySelector('#confirmNext').onclick=()=>{confirmClicks++;if(scenario!=='unchanged'){history.replaceState({},'',location.href+'&next=1');document.querySelector('.jobFinishTip').style.display='none';enabled=false;}};
    window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
      let value={ok:true};
      if(message.type==='state')value={enabled,config:{autoSubmit:true,autoDiscuss:true,confidence:.85,nextSelector:'',completeSelector:''}};
      if(message.type==='reports')value=currentFrames;
      if(message.type==='report')latestReport=message.value;
      if(message.type==='discussionStatus')value={[key]:{status:'skipped',reason:'fixture entry unavailable'}};
      return {ok:true,value};
    }}};
  },{scenario,key});
  for(const source of sources)await page.addScriptTag({content:source});
  if(scenario==='continue')await page.waitForFunction(()=>confirmClicks===1,null,{timeout:16000});
  else if(scenario==='stop')await page.waitForFunction(()=>footerClicks===1&&!enabled,null,{timeout:16000});
  else await page.waitForFunction(()=>latestReport.mode==='blocked',null,{timeout:25000});
  const result=await page.evaluate(()=>({footerClicks,confirmClicks,status:latestReport.status,url:location.href,done:document.querySelectorAll('.ans-job-finished').length}));
  assert.equal(result.footerClicks,1);assert.equal(result.confirmClicks,['continue','unchanged'].includes(scenario)?1:0);assert.equal(result.done,0);assert.deepEqual(errors,[]);
  if(scenario==='continue')assert.ok(result.url.includes('next=1'));
  if(scenario==='unchanged')assert.match(result.status,/已确认下一节但页面未切换/);
  if(['new-task','busy'].includes(scenario))assert.match(result.status,/不允许自动跳过/);
  await page.close();return {scenario,passed:true,...result};
}
try{
  const results=await Promise.all(scenarios.map(check));
  const output={at:new Date().toISOString(),passed:results.length,results,sourceSha256:Object.fromEntries(names.map((name,i)=>[name,createHash('sha256').update(sources[i]).digest('hex')])),scope:'Actual adapter/discussion/content with real DOM click handlers and reconstructed native HTML dialog. Intercepted browser, simulated storage/transport, no real course progression.'};
  await writeFile(new URL('./navigation-dialog-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}finally{await browser.close();}
