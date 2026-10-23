// Disposable intercepted browser: real layout, scroll events and delayed images.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw new Error('No fixture browser');
const [scrollSource, adapter, content] = await Promise.all(['document-scroll.js', 'adapter.js', 'content.js'].map(name => readFile(new URL('../extension/' + name, import.meta.url), 'utf8')));
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
async function fixture(html) {
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (route.request().url().endsWith('/late-image.svg')) {
      await new Promise(resolve => setTimeout(resolve, 1100));
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1200"></svg>' });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=fixture', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: scrollSource });
  await page.evaluate(() => { window.enabled = true; });
  return page;
}
const settle = (page, options = {}) => page.evaluate(options => ChaoxingDocumentScroller.settleBottom(document.getElementById('last'), { active: async () => enabled, ...options }), options);
const rootBottom = page => page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight - document.scrollingElement.scrollTop <= 2);
try {
  const footer = await fixture('<ul class="fileBox"><li id="last" style="height:160px">Short document</li></ul><footer style="height:1300px">End of reader</footer>');
  await footer.locator('#last').evaluate(element => element.scrollIntoView({block:'end'}));
  assert.equal(await rootBottom(footer), false);
  assert.equal((await settle(footer)).status, 'bottom');
  assert.equal(await rootBottom(footer), true);
  checks.push('短文档末页可见后继续滚到阅读器页后留白/页脚的实际底部');
  await footer.close();

  const nested = await fixture('<aside id="sidebar" style="height:100px;width:100px;overflow:auto;position:fixed"><div style="height:1000px">unrelated</div></aside><div id="outer" style="height:220px;overflow-y:auto;margin-top:450px"><div id="inner" style="height:300px;overflow-y:auto"><ul class="fileBox"><li id="last" style="height:180px">short page</li></ul><footer style="height:1200px">inside reader</footer></div><footer style="height:450px">outer end</footer></div><footer style="height:700px">root end</footer>');
  assert.equal((await settle(nested)).status, 'bottom');
  assert.deepEqual(await nested.evaluate(() => ['inner','outer'].map(id => {const e=document.getElementById(id);return e.scrollHeight-e.clientHeight-e.scrollTop<=2;})), [true,true]);
  assert.equal(await rootBottom(nested), true);
  assert.equal(await nested.locator('#sidebar').evaluate(element => element.scrollTop), 0);
  checks.push('嵌套阅读容器与文档root均滚到底，不滚动无关侧边栏');
  await nested.close();

  const growing = await fixture('<ul class="fileBox"><li id="last" style="height:600px">page</li></ul><footer id="footer" style="height:100px">footer</footer><script>addEventListener("scroll",()=>{if(!window.growth){window.growth=true;setTimeout(()=>document.getElementById("footer").style.height="950px",400)}},{once:true});</script>');
  const started = Date.now();
  assert.equal((await settle(growing)).status, 'bottom');
  assert.equal(await growing.locator('#footer').evaluate(element => element.clientHeight),950);
  assert.equal(await rootBottom(growing), true);
  assert.ok(Date.now()-started>=1100);
  checks.push('滚动触发异步增高后重新滚底，布局稳定后才返回成功');
  await growing.close();

  const image = await fixture('<ul class="fileBox"><li id="last"><img src="/late-image.svg" style="width:300px">Document</li></ul><footer style="height:200px">end</footer>');
  assert.equal((await settle(image)).status, 'bottom');
  assert.equal(await image.locator('img').evaluate(element => element.complete && element.naturalHeight === 1200), true);
  assert.equal(await rootBottom(image), true);
  checks.push('等待末页延迟图片真实加载和自然尺寸变化后滚到底');
  await image.close();

  const small = await fixture('<ul class="fileBox"><li id="last" style="height:40px">Fits without scrolling</li></ul>');
  assert.equal((await settle(small)).status, 'bottom');
  assert.equal(await rootBottom(small), true);
  checks.push('无滚动空间的短文档可正常稳定，不陷入重试');
  await small.close();

  const unstable = await fixture('<ul class="fileBox"><li id="last" style="height:700px">page</li></ul><footer id="footer" style="height:300px"></footer><script>setInterval(()=>footer.style.height=(footer.clientHeight+40)+"px",80)</script>');
  assert.equal((await settle(unstable,{maxMs:650,stableMs:300})).status,'unstable');
  checks.push('持续布局变化受时间预算限制，不将不稳定文档记为已浏览');
  await unstable.close();

  async function startContent(page) {
    await page.evaluate(() => {
      window.finishCalls=0;window.lastReport=null;
      window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async message=>{
        if(message.type==='state')return {ok:true,value:{enabled,config:{documentMode:'fast',autoSubmit:true}}};
        if(message.type==='report')lastReport=message.value;
        if(message.type==='reports')return {ok:true,value:[]};
        return {ok:true,value:{ok:true}};
      }}};
      window.ChaoxingDocumentBridge={finishViewedDocument:async()=>{
        const root=document.scrollingElement;
        if(root.scrollHeight-root.clientHeight-root.scrollTop>2)throw Error('Callback before actual bottom');
        finishCalls++;return {status:'invoked'};
      }};
    });
    await page.addScriptTag({ content: adapter });
    await page.addScriptTag({ content });
  }
  const integrated = await fixture('<ul class="fileBox"><li id="last" style="height:120px">short page</li></ul><footer style="height:1300px">reader end</footer>');
  await startContent(integrated);
  await integrated.waitForFunction(()=>finishCalls===1,null,{timeout:5000});
  assert.equal(await rootBottom(integrated),true);
  await integrated.waitForTimeout(3300);
  assert.equal(await integrated.evaluate(()=>finishCalls),1);
  checks.push('实际content脚本仅在阅读器实际到底并稳定后调用一次原站点完成桥接');
  await integrated.close();

  const cancelled = await fixture('<ul class="fileBox"><li id="last" style="height:120px">page</li></ul><footer style="height:1000px">end</footer>');
  await startContent(cancelled);
  await cancelled.waitForFunction(()=>lastReport?.progress?.phase==='settling-bottom',null,{timeout:3000});
  await cancelled.evaluate(()=>{enabled=false;});
  await cancelled.waitForTimeout(1500);
  assert.equal(await cancelled.evaluate(()=>finishCalls),0);
  assert.notEqual(await cancelled.evaluate(()=>lastReport.mode), 'complete');
  checks.push('底部稳定等待中停止托管立即取消，不调用完成回调');
  await cancelled.close();
  const changed = await fixture('<ul class="fileBox"><li id="last" style="height:120px">page</li></ul><footer style="height:1000px">end</footer>');
  await startContent(changed);
  await changed.waitForFunction(()=>lastReport?.progress?.phase==='settling-bottom',null,{timeout:3000});
  await changed.evaluate(()=>{history.pushState({},'',location.pathname+'?courseid=fixture&chapterId=other');document.getElementById('last').remove();});
  await changed.waitForTimeout(1300);
  assert.equal(await changed.evaluate(()=>finishCalls),0);
  checks.push('底部稳定等待中切换章节或移除文档时取消旧浏览，不调用完成回调');
  await changed.close();
  assert.deepEqual(errors,[]);
  await writeFile(new URL('./document-bottom-results.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),scope:'Disposable headless browser, fully intercepted URLs, real layout/scroll/image loading; actual content and helper with mocked extension transport; no real courses',passed:checks.length,checks,errors},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,checks}));
} finally { await browser.close(); }
