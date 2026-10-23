// Disposable browser + mocked extension transport. No course or provider calls.
import { createRequire } from 'node:module';
import { access, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
let executablePath;
for (const candidate of [process.env.CX_TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch {}
}
if (!executablePath) throw new Error('未发现测试浏览器');
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const html = (await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8')).replace(/<script src="(?:status-text|popup)\.js"><\/script>/g, '');
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.example/popup');
  await page.evaluate(() => {
    window.messages = []; window.state = { enabled: false }; window.changes = [];
    window.settings = { token: 'fixture', confidence: 0.85, autoSubmit: true, programmingLanguage: 'auto', documentMode: 'fast', keepAwake: true };
    window.provider = { provider: 'codex', hasApiKey: false };
    window.chrome = {
      tabs: { query: async () => [{ id: 7 }] },
      storage: { onChanged: { addListener: fn => changes.push(fn) } },
      runtime: { sendMessage: async m => {
        messages.push(m);
        let value;
        if (m.type === 'health') { if (window.healthFailure) return { ok: false, error: '无法连接本地服务 127.0.0.1:18765，请运行 start.cmd' }; value = { version: window.backendVersion || '0.2.2' }; }
        else if (m.type === 'config') value = settings;
        else if (m.type === 'popupState') value = structuredClone(state);
        else if (m.type === 'saveConfig') { settings = m.value; value = { provider: provider.provider, version: window.backendVersion || '0.2.2' }; }
        else if (m.type === 'control') { state = { enabled: m.enabled, last: m.enabled ? '已开始' : '已停止' }; value = state; }
        else if (m.type === 'providerConfig') value = provider;
        else if (m.type === 'saveProviderConfig') { const { apiKey, clearApiKey, ...safe } = m.value; provider = { ...safe, hasApiKey: !!apiKey }; value = provider; }
        else value = {};
        return { ok: true, value };
      }, getManifest: () => ({ version: '0.2.2' }) }
    };
    window.report = state => { window.state = state; for (const fn of changes) fn({ 'tab:7': { newValue: state } }, 'session'); };
  });
  await page.addScriptTag({ content: await readFile(new URL('../extension/status-text.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8') });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('尚未开始'));
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('已开始'));
  await page.evaluate(() => report({ enabled: true, last: '已填写并校验 1/3 题', updatedAt: Date.now(), progress: { kind: 'quiz', current: 1, total: 3, filled: 1 } }));
  assert.match(await page.locator('#status').innerText(), /1\/3/);
  assert.equal(await page.locator('#progress').evaluate(e => e.value), 1);
  assert.match(await page.locator('#progressText').innerText(), /1\/3/);
  checks.push('不重开弹窗、不再点击开始，storage事件立即更新逐题进度');
  await page.locator('#token').fill('unsaved-edit');
  await page.evaluate(() => { state = { enabled: true, last: '已填写并校验 2/3 题', updatedAt: Date.now(), progress: { kind: 'quiz', current: 2, total: 3, filled: 2 } }; });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('2/3'));
  assert.equal(await page.locator('#token').inputValue(), 'unsaved-edit');
  assert.equal(await page.evaluate(() => messages.filter(m => m.type === 'control' && m.enabled).length), 1);
  checks.push('轮询补偿缺失事件，且不覆盖正在编辑的设置');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('连接成功'));
  assert.match(await page.locator('#status').innerText(), /2\/3/);
  checks.push('连接通知与持续任务状态分开显示');
  assert.match(await page.locator('#versions').innerText(), /已加载扩展 0\.2\.2 · 本地服务 0\.2\.2/);
  await page.evaluate(() => { window.backendVersion = '0.1.0'; });
  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('versions').textContent.includes('版本不同'));
  assert.match(await page.locator('#status').innerText(), /2\/3/);
  checks.push('显示实际已加载版本，旧后端给出升级提示且不覆盖任务进度');
  await page.evaluate(() => { window.backendVersion = '0.2.2'; });
  await page.evaluate(() => report({ enabled: true, last: '旧进度', updatedAt: Date.now() - 20000, progress: { kind: 'quiz', current: 3, total: 3 } }));
  assert.match(await page.locator('#status').innerText(), /等待页面状态/);
  assert.equal(await page.locator('#progress').isHidden(), true);
  checks.push('过期页面报告显示等待且不伪装为实时完成');
  await page.evaluate(() => report({enabled:true,last:'等待下一任务',updatedAt:Date.now(),discussions:{a:{status:'skipped',reason:'无法识别唯一发布入口'},b:{status:'skipped',reason:'<img src=x onerror=alert(1)>'}}}));
  assert.equal(await page.locator('#discussionReasons').isVisible(),false);
  await page.locator('#discussionDetails summary').click();
  assert.match(await page.locator('#discussionReasons').innerText(),/无法识别唯一发布入口/);
  assert.match(await page.locator('#discussionReasons').innerText(),/<img/);
  assert.equal(await page.locator('#discussionReasons img').count(),0);
  checks.push('逐项显示讨论跳过原因，错误文本不能作为HTML或脚本执行');
  await page.locator('#discussionDetails summary').click();
  await page.evaluate(() => {
    const error='讨论处理失败，已跳过：Codex 退出码 1: 必须使用给出的 key；填空/简答按输入框顺序给 values。 '+JSON.stringify({context:{courseTitle:'fixture'},questions:[{id:'discussion',text:'PRIVATE_PROMPT_SENTINEL'}]});
    report({enabled:true,last:error,updatedAt:Date.now(),progress:{kind:'discussion',current:0,total:1},discussions:{old:{status:'skipped',reason:error},submitted:{status:'submitted'}}});
  });
  assert.equal(await page.locator('#discussionReasons').isVisible(),false);
  assert.match(await page.locator('#discussionSummary').innerText(),/已确认发布 1 项；已跳过 1 项/);
  assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE_PROMPT_SENTINEL|必须使用给出的 key|"questions"/);
  await page.locator('#discussionDetails summary').click();
  assert.match(await page.locator('#discussionReasons').innerText(),/Codex 退出码 1/);
  assert.doesNotMatch(await page.locator('#status').innerText(),/必须使用|"context"/);
  checks.push('跳过详情默认收起，旧会话的长Codex错误在状态、进度与展开详情中均仅显示短提示，发布计数保留');
  await page.locator('#discussionDetails summary').click();
  await page.locator('summary').filter({ hasText: 'AI 服务设置' }).click();
  await page.locator('#provider').selectOption('deepseek');
  assert.equal(await page.locator('#baseUrl').inputValue(), 'https://api.deepseek.com');
  assert.equal(await page.locator('#responseFormat').inputValue(), 'json_object');
  assert.equal(await page.locator('#model').inputValue(), 'deepseek-flash');
  await page.locator('#model').fill('fixture-model');
  await page.locator('#apiKey').fill('fixture-secret');
  await page.locator('#saveProvider').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('AI 设置已保存'));
  assert.equal(await page.locator('#apiKey').inputValue(), '');
  assert.equal((await page.locator('body').innerText()).includes('fixture-secret'), false);
  const saved = await page.evaluate(() => messages.find(m => m.type === 'saveProviderConfig').value);
  assert.equal(saved.apiKey, 'fixture-secret'); assert.equal(saved.responseFormat, 'json_object');
  checks.push('DeepSeek配置通过专用消息保存，密钥保存后清空且不显示');
  await page.locator('#provider').selectOption('codex');
  assert.equal(await page.locator('#model').inputValue(), '');
  assert.equal(await page.locator('#baseUrl').inputValue(), '');
  checks.push('切回本机Codex时不沿用外部服务的模型和地址');
  await page.locator('#stop').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '已停止');
  assert.equal(await page.locator('#progress').isHidden(), true);
  checks.push('停止即时更新面板且移除进行中进度');
  await page.evaluate(() => { window.healthFailure = true; });
  await page.waitForFunction(() => document.getElementById('connection').textContent.includes('start.cmd'), null, { timeout: 7000 });
  assert.match(await page.locator('#versions').innerText(), /本地服务 未连接/);
  assert.equal(await page.locator('#status').innerText(), '已停止');
  await page.evaluate(() => { window.healthFailure = false; });
  await page.waitForFunction(() => document.getElementById('connection').textContent === '本地服务已连接', null, { timeout: 7000 });
  assert.match(await page.locator('#versions').innerText(), /本地服务 0\.2\.2/);
  checks.push('服务断开提示明确恢复步骤，服务恢复后自动重新检测且不改变托管状态');
  const overlay = await browser.newPage();
  overlay.on('pageerror',e=>errors.push(e.message));
  await overlay.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<p>Course fixture</p>'}));
  await overlay.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?courseid=fixture');
  await overlay.evaluate(() => {
    const original=Element.prototype.attachShadow; Element.prototype.attachShadow=function(options){return original.call(this,{...options,mode:'open'});};
    const state={enabled:true,last:'Codex 退出码 1: OLD_OVERLAY_PROMPT '+JSON.stringify({context:{},questions:[]}),config:{autoSubmit:true,confidence:.85}};
    window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async message=>({ok:true,value:message.type==='state'?state:message.type==='reports'?[]:{}})}};
  });
  for(const name of ['status-text.js','adapter.js','content.js']) await overlay.addScriptTag({content:await readFile(new URL('../extension/'+name,import.meta.url),'utf8')});
  await overlay.waitForFunction(()=>document.querySelector('#cx-agent-panel')?.shadowRoot?.textContent.includes('Codex 退出码 1'));
  const overlayText=await overlay.locator('#cx-agent-panel').evaluate(e=>e.shadowRoot.textContent);
  assert.doesNotMatch(overlayText,/OLD_OVERLAY_PROMPT|"context"|"questions"/);
  checks.push('页面浮窗对旧后台状态同样隐藏原始提示词，仅显示短错误'); await overlay.close();
  assert.deepEqual(errors, []);
  await writeFile(new URL('./popup-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), scope: '真实弹窗HTML/JS，一次性无头浏览器，模拟chrome扩展消息与storage事件；未验证已安装扩展或真实课程', checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
