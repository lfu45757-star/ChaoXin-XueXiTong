const el = id => document.getElementById(id);
const displayText = value => globalThis.ChaoxingStatusText?.(value) ?? String(value || '').slice(0, 160);
const send = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error || '扩展未返回状态，请重载扩展'); return r.value; };
let tab, polling = false, timer, lastState, lastRender = 0, healthChecking = false, lastHealth = 0;
const notice = message => { el('notice').textContent = displayText(message); };
const extensionVersion = chrome.runtime.getManifest().version;
function showVersions(backendVersion) {
  el('versions').textContent = `已加载扩展 ${extensionVersion} · 本地服务 ${backendVersion || '尚未检测'}` +
    (backendVersion && /^\d/.test(backendVersion) && backendVersion !== extensionVersion ? '；版本不同，请重启本地服务并重新加载扩展、刷新课程页。' : '');
}
function connected(result) {
  showVersions(result.version);
  el('connection').textContent = '本地服务已连接';
}
function disconnected(error) {
  showVersions('未连接');
  el('connection').textContent = displayText(error.message);
}
async function checkHealth() {
  if (healthChecking) return;
  healthChecking = true; lastHealth = Date.now();
  try { connected(await send({ type: 'health' })); }
  catch (error) { disconnected(error); }
  finally { healthChecking = false; }
}

function render(state) {
  lastState = state;
  const age = state.updatedAt ? Date.now() - state.updatedAt : Infinity;
  const stale = state.enabled && (state.stale || age > 12000);
  el('status').textContent = (state.enabled ? '托管中 · ' : '') + displayText(state.last || '当前页面尚未开始托管') +
    (stale ? '\n正在等待页面状态；首次安装或更新后请刷新课程页。' : '');
  el('sync').textContent = state.enabled ? (stale ? '尚未收到新鲜页面报告' : `已自动同步 · ${new Date(state.updatedAt).toLocaleTimeString()}`) : '状态会自动更新，无需重复点击开始';
  const p = state.enabled && !stale ? state.progress : null;
  el('progress').hidden = !p;
  el('progressText').textContent = p ? (p.kind === 'quiz' ? `练习进度：${p.filled ?? p.current ?? 0}/${p.total ?? '?'} 题${p.source ? ' · ' + p.source : ''}` : p.kind === 'document' ? `文档：${p.current ?? 0}/${p.total ?? '?'} 页` : `媒体：${p.current ?? 0}/${p.total ?? '?'} 秒`) : '';
  if (p?.kind === 'discussion') el('progressText').textContent = '讨论：' + displayText(state.last);
  const discussions = Object.values(state.discussions || {});
  const submitted = discussions.filter(item => item.status === 'submitted').length;
  const skipped = discussions.filter(item => item.status === 'skipped').length;
  el('discussionSummary').textContent = submitted || skipped ? `讨论：已确认发布 ${submitted} 项；已跳过 ${skipped} 项（跳过不代表完成）。` : '';
  el('discussionDetails').hidden = !skipped;
  if (!skipped) el('discussionDetails').open = false;
  el('discussionReasons').replaceChildren(...discussions.filter(item => item.status === 'skipped' && item.reason).map((item, index) => {
    const line = document.createElement('div'); line.textContent = `${index + 1}. ${displayText(item.reason)}`; return line;
  }));
  el('progress').max = Math.max(1, Number(p?.total) || 1);
  el('progress').value = Number(p?.filled ?? p?.current) || 0;
  el('start').textContent = state.enabled ? '托管已开启' : '开始托管';
  el('stop').disabled = !state.enabled;
  // Do not overwrite form inputs while periodic reports arrive.
  lastRender++;
}
async function refresh() {
  if (Date.now() - lastHealth >= 5000) void checkHealth();
  if (!tab?.id || polling) return;
  polling = true;
  const version = lastRender;
  try {
    const state = await send({ type: 'popupState', tabId: tab.id });
    if (version === lastRender) render(state);
  } catch (e) { el('sync').textContent = `状态同步失败：${displayText(e.message)}`; }
  finally { polling = false; }
}
async function save() {
  const result = await send({ type: 'saveConfig', value: {
    token: el('token').value, confidence: Number(el('confidence').value), autoSubmit: el('autoSubmit').checked, autoDiscuss: el('autoDiscuss').checked,
    programmingLanguage: el('programmingLanguage').value, documentMode: el('documentMode').value, keepAwake: el('keepAwake').checked,
    nextSelector: el('nextSelector').value.trim(), completeSelector: el('completeSelector').value.trim()
  } });
  connected(result);
  notice(`本地连接成功，agent: ${result.provider || '已连接'}`);
  return result;
}
function showProvider(settings) {
  el('provider').value = settings.provider || 'codex';
  el('questionBank').value = settings.questionBank || 'local';
  for (const name of ['baseUrl', 'model', 'responseFormat']) el(name).value = settings[name] || (name === 'responseFormat' ? 'json_schema' : '');
  el('apiKey').value = ''; el('clearApiKey').checked = false;
  el('keyState').textContent = settings.hasApiKey ? '已在本地保存密钥；留空保留，密钥不会回显。' : '尚未配置密钥。';
  el('httpSettings').hidden = el('provider').value === 'codex';
}
async function loadProvider() { showProvider(await send({ type: 'providerConfig' })); }
el('provider').onchange = () => {
  const provider = el('provider').value;
  el('httpSettings').hidden = provider === 'codex';
  el('apiKey').value = ''; el('clearApiKey').checked = false;
  el('keyState').textContent = '切换服务或地址后需重新填写对应密钥。';
  if (provider === 'deepseek') {
    el('baseUrl').value = 'https://api.deepseek.com';
    el('model').value = 'deepseek-flash';
    el('model').placeholder = '填写账户可用的模型 ID';
    el('responseFormat').value = 'json_object';
  } else {
    el('baseUrl').value = ''; el('model').value = ''; el('responseFormat').value = 'json_schema';
  }
};
el('loadProvider').onclick = () => loadProvider().then(() => notice('已读取本地 AI 设置')).catch(e => notice(e.message));
el('saveProvider').onclick = async () => {
  el('saveProvider').disabled = true;
  try {
    await save();
    const value = { provider: el('provider').value, questionBank: el('questionBank').value, baseUrl: el('baseUrl').value.trim(), model: el('model').value.trim(),
      responseFormat: el('responseFormat').value, apiKey: el('apiKey').value.trim(), clearApiKey: el('clearApiKey').checked };
    const settings = await send({ type: 'saveProviderConfig', value });
    showProvider(settings); notice('AI 设置已保存到本机。实际调用将在下一次解题时验证。');
  } catch (e) { notice(e.message); }
  finally { el('apiKey').value = ''; el('saveProvider').disabled = false; }
};
el('save').onclick = () => save().catch(e => notice(e.message));
el('start').onclick = async () => {
  el('start').disabled = true;
  try { await save(); render(await send({ type: 'control', tabId: tab.id, enabled: true })); await refresh(); }
  catch (e) { notice(e.message); }
  finally { el('start').disabled = false; }
};
el('stop').onclick = async () => {
  try { render(await send({ type: 'control', tabId: tab.id, enabled: false })); notice('已停止托管'); }
  catch (e) { notice(e.message); }
};
el('confirmUnsubmitted').onchange = () => { el('resetPending').disabled = !el('confirmUnsubmitted').checked; };
el('resetPending').onclick = async () => {
  if (!el('confirmUnsubmitted').checked) return;
  el('resetPending').disabled = true;
  try {
    const result = await send({ type: 'resetPending', tabId: tab.id, confirmed: true });
    notice(result.refreshRequired ? `已清除 ${result.clearedCount} 条未确认记录并停止托管。请刷新课程页后重新开始。${result.warning || ''}` : '当前页面没有可清除的未确认记录。');
    await refresh();
  } catch (e) { notice(e.message); }
  finally { el('confirmUnsubmitted').checked = false; el('resetPending').disabled = true; }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && tab && changes[`tab:${tab.id}`]?.newValue) render(changes[`tab:${tab.id}`].newValue);
});
async function init() {
  showVersions();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('未找到当前标签页');
  const settings = await send({ type: 'config' });
  for (const name of ['token', 'confidence', 'nextSelector', 'completeSelector']) el(name).value = settings[name] ?? '';
  el('programmingLanguage').value = settings.programmingLanguage || 'auto';
  el('documentMode').value = settings.documentMode || 'fast';
  el('autoSubmit').checked = settings.autoSubmit; el('autoDiscuss').checked = settings.autoDiscuss !== false; el('keepAwake').checked = settings.keepAwake !== false;
  await refresh();
  timer = setInterval(refresh, 1000);
  if (settings.token) loadProvider().catch(e => { el('keyState').textContent = `读取 AI 设置失败：${displayText(e.message)}`; });
}
window.addEventListener('pagehide', () => clearInterval(timer));
init().catch(e => notice(e.message));
