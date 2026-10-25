const el = id => document.getElementById(id);
const displayText = value => globalThis.ChaoxingStatusText?.(value) ?? String(value || '').slice(0, 160);
const send = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error || '��չδ����״̬����������չ'); return r.value; };
let tab, polling = false, timer, lastState, lastRender = 0, healthChecking = false, lastHealth = 0;
const notice = message => { el('notice').textContent = displayText(message); };
const extensionVersion = chrome.runtime.getManifest().version;
function showVersions(backendVersion) {
  el('versions').textContent = `�Ѽ�����չ ${extensionVersion} �� ���ط��� ${backendVersion || '��δ���'}` +
    (backendVersion && /^\d/.test(backendVersion) && backendVersion !== extensionVersion ? '���汾��ͬ�����������ط������¼�����չ��ˢ�¿γ�ҳ��' : '');
}
function connected(result) {
  showVersions(result.version);
  el('connection').textContent = '���ط���������';
}
function disconnected(error) {
  showVersions('δ����');
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
  el('status').textContent = (state.enabled ? '�й��� �� ' : '') + displayText(state.last || '��ǰҳ����δ��ʼ�й�') +
    (stale ? '\n���ڵȴ�ҳ��״̬���״ΰ�װ����º���ˢ�¿γ�ҳ��' : '');
  el('sync').textContent = state.enabled ? (stale ? '��δ�յ�����ҳ�汨��' : `���Զ�ͬ�� �� ${new Date(state.updatedAt).toLocaleTimeString()}`) : '״̬���Զ����£������ظ������ʼ';
  const p = state.enabled && !stale ? state.progress : null;
  el('progress').hidden = !p;
  el('progressText').textContent = p ? (p.kind === 'quiz' ? `��ϰ���ȣ�${p.filled ?? p.current ?? 0}/${p.total ?? '?'} ��${p.source ? ' �� ' + p.source : ''}` : p.kind === 'document' ? `�ĵ���${p.current ?? 0}/${p.total ?? '?'} ҳ` : `ý�壺${p.current ?? 0}/${p.total ?? '?'} ��`) : '';
  if (p?.kind === 'discussion') el('progressText').textContent = '���ۣ�' + displayText(state.last);
  const discussions = Object.values(state.discussions || {});
  const submitted = discussions.filter(item => item.status === 'submitted').length;
  const skipped = discussions.filter(item => item.status === 'skipped').length;
  el('discussionSummary').textContent = submitted || skipped ? `���ۣ���ȷ�Ϸ��� ${submitted} ������� ${skipped} �������������ɣ���` : '';
  el('discussionDetails').hidden = !skipped;
  if (!skipped) el('discussionDetails').open = false;
  el('discussionReasons').replaceChildren(...discussions.filter(item => item.status === 'skipped' && item.reason).map((item, index) => {
    const line = document.createElement('div'); line.textContent = `${index + 1}. ${displayText(item.reason)}`; return line;
  }));
  el('progress').max = Math.max(1, Number(p?.total) || 1);
  el('progress').value = Number(p?.filled ?? p?.current) || 0;
  el('start').textContent = state.enabled ? '�й��ѿ���' : '��ʼ�й�';
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
  } catch (e) { el('sync').textContent = `״̬ͬ��ʧ�ܣ�${displayText(e.message)}`; }
  finally { polling = false; }
}
async function save() {
  const result = await send({ type: 'saveConfig', value: {
    token: el('token').value, confidence: Number(el('confidence').value), autoSubmit: el('autoSubmit').checked, autoDiscuss: el('autoDiscuss').checked,
    programmingLanguage: el('programmingLanguage').value, documentMode: el('documentMode').value, autoSeekAudio: el('autoSeekAudio').checked, keepAwake: el('keepAwake').checked,
    nextSelector: el('nextSelector').value.trim(), completeSelector: el('completeSelector').value.trim()
  } });
  connected(result);
  notice(`�������ӳɹ���agent: ${result.provider || '������'}`);
  return result;
}
function showProvider(settings) {
  el('provider').value = settings.provider || 'codex';
  el('questionBank').value = settings.questionBank || 'local';
  for (const name of ['baseUrl', 'model', 'responseFormat']) el(name).value = settings[name] || (name === 'responseFormat' ? 'json_schema' : '');
  el('apiKey').value = ''; el('clearApiKey').checked = false;
  el('keyState').textContent = settings.hasApiKey ? '���ڱ��ر�����Կ�����ձ�������Կ������ԡ�' : '��δ������Կ��';
  el('httpSettings').hidden = el('provider').value === 'codex';
}
async function loadProvider() { showProvider(await send({ type: 'providerConfig' })); }
el('provider').onchange = () => {
  const provider = el('provider').value;
  el('httpSettings').hidden = provider === 'codex';
  el('apiKey').value = ''; el('clearApiKey').checked = false;
  el('keyState').textContent = '�л�������ַ����������д��Ӧ��Կ��';
  if (provider === 'deepseek') {
    el('baseUrl').value = 'https://api.deepseek.com';
    el('model').value = 'deepseek-flash';
    el('model').placeholder = '��д�˻����õ�ģ�� ID';
    el('responseFormat').value = 'json_object';
  } else {
    el('baseUrl').value = ''; el('model').value = ''; el('responseFormat').value = 'json_schema';
  }
};
el('loadProvider').onclick = () => loadProvider().then(() => notice('�Ѷ�ȡ���� AI ����')).catch(e => notice(e.message));
el('saveProvider').onclick = async () => {
  el('saveProvider').disabled = true;
  try {
    await save();
    const value = { provider: el('provider').value, questionBank: el('questionBank').value, baseUrl: el('baseUrl').value.trim(), model: el('model').value.trim(),
      responseFormat: el('responseFormat').value, apiKey: el('apiKey').value.trim(), clearApiKey: el('clearApiKey').checked };
    const settings = await send({ type: 'saveProviderConfig', value });
    showProvider(settings); notice('AI �����ѱ��浽������ʵ�ʵ��ý�����һ�ν���ʱ��֤��');
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
  try { render(await send({ type: 'control', tabId: tab.id, enabled: false })); notice('��ֹͣ�й�'); }
  catch (e) { notice(e.message); }
};
el('confirmUnsubmitted').onchange = () => { el('resetPending').disabled = !el('confirmUnsubmitted').checked; };
el('resetPending').onclick = async () => {
  if (!el('confirmUnsubmitted').checked) return;
  el('resetPending').disabled = true;
  try {
    const result = await send({ type: 'resetPending', tabId: tab.id, confirmed: true });
    notice(result.refreshRequired ? `����� ${result.clearedCount} ��δȷ�ϼ�¼��ֹͣ�йܡ���ˢ�¿γ�ҳ�����¿�ʼ��${result.warning || ''}` : '��ǰҳ��û�п������δȷ�ϼ�¼��');
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
  if (!tab?.id) throw new Error('δ�ҵ���ǰ��ǩҳ');
  const settings = await send({ type: 'config' });
  for (const name of ['token', 'confidence', 'nextSelector', 'completeSelector']) el(name).value = settings[name] ?? '';
  el('programmingLanguage').value = settings.programmingLanguage || 'auto';
  el('documentMode').value = settings.documentMode || 'fast';
  el('autoSeekAudio').checked = settings.autoSeekAudio !== false;
  el('autoSubmit').checked = settings.autoSubmit; el('autoDiscuss').checked = settings.autoDiscuss !== false; el('keepAwake').checked = settings.keepAwake !== false;
  await refresh();
  timer = setInterval(refresh, 1000);
  if (settings.token) loadProvider().catch(e => { el('keyState').textContent = `��ȡ AI ����ʧ�ܣ�${displayText(e.message)}`; });
}
window.addEventListener('pagehide', () => clearInterval(timer));
init().catch(e => notice(e.message));
