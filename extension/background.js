const defaults = { token: '', autoSubmit: true, autoDiscuss: true, confidence: 0.85, nextSelector: '', completeSelector: '', programmingLanguage: 'auto', documentMode: 'fast', autoSeekAudio: true, keepAwake: true };
const languages = new Set(['auto', 'Python', 'C', 'C++', 'Java', 'JavaScript']);
const controllers = new Map();
const pending = new Set();
const reports = new Map();
const locks = new Map();
const sessionUpdates = new Map();
const generations = new Map();
const stoppedTabs = new Set();
const controlVersions = new Map();
const missingTopFrames = new Map();
const tabKey = id => `tab:${id}`;
const reportLifetime = 12000;
async function config() { return { ...defaults, ...((await chrome.storage.local.get('config')).config || {}) }; }
async function session(id) { return (await chrome.storage.session.get(tabKey(id)))[tabKey(id)] || { enabled: false }; }
async function setTabDiscardable(id, value) {
  if (typeof value !== 'boolean' || !chrome.tabs.update) return;
  try { await chrome.tabs.update(id, { autoDiscardable: value }); }
  catch { /* Browser or tab may not support this setting. */ }
}
function freshReports(id, state) {
  if (!reports.has(id) && state?.frames?.length) reports.set(id, new Map(state.frames.map(r => [r.frameId, r])));
  return [...(reports.get(id)?.entries() || [])].filter(([, r]) => Date.now() - r.at < reportLifetime).map(([frameId, r]) => ({ ...r, frameId }));
}
function reportSummary(frames, owner) {
  // A quiet top frame must not hide active work in a nested task document.
  const rank = r => owner?.frameId === r.frameId ? 7 : r.busy ? 6 : r.mode === 'submitting' ? 5 : ['media', 'document', 'text'].includes(r.mode) ? 4 : r.mode === 'quiz' ? 3 : ['blocked', 'awaiting-user-playback'].includes(r.mode) ? (r.frameId === 0 ? 1 : 2) : r.frameId === 0 ? 1 : 0;
  // Periodic reports from several blocked exercises arrive in a different
  // order every tick. Keep the same task visible until its state changes.
  const selected = [...frames].sort((a, b) => rank(b) - rank(a) || a.frameId - b.frameId)[0];
  const blockedCount = frames.filter(r => r.frameId !== 0 && r.mode === 'blocked').length;
  const pendingLabel = selected?.mode === 'blocked' && blockedCount > 1 ? `${blockedCount} ����ϰ������ �� ` : '';
  return selected ? { last: `${pendingLabel}${String(selected.taskTitle || '').slice(0, 80)}${selected.taskTitle ? ' �� ' : ''}${String(selected.status || '�ȴ�ҳ��״̬')}`.slice(0, 500),
    progress: selected.progress || null, updatedAt: selected.at } : {};
}
async function restoreMissingChapterFrame(tabId, state) {
  if (!state.enabled || Number.isInteger(state.parentTab) || !chrome.tabs.reload) return;
  const frames = freshReports(tabId, state);
  if (frames.some(frame => frame.frameId === 0)) { missingTopFrames.delete(tabId); return; }
  const cards = frames.find(frame => {
    try {
      return frame.cardsReady === true && frame.jobTotal > 0 &&
        frame.jobTotal === frame.jobDone && frame.trackedJobTotal === frame.jobTotal &&
        /\/(?:mooc-ans\/)?knowledge\/cards\/?$/.test(new URL(frame.url).pathname);
    } catch { return false; }
  });
  if (!cards || frames.some(frame => frame.busy && ['quiz', 'submitting', 'discussion'].includes(frame.mode))) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  let page, card;
  try { page = new URL(tab.url); card = new URL(cards.url); } catch { return; }
  if (!/\/mycourse\/studentstudy\/?$/.test(page.pathname) ||
      page.origin !== card.origin ||
      page.searchParams.get('chapterId') !== card.searchParams.get('knowledgeid') ||
      page.searchParams.get('courseId') !== card.searchParams.get('courseid')) return;
  const previous = missingTopFrames.get(tabId);
  const record = previous?.url === tab.url ? previous : { url: tab.url, since: Date.now(), attempted: false };
  missingTopFrames.set(tabId, record);
  if (record.attempted || Date.now() - record.since < 12000) return;
  record.attempted = true;
  await chrome.tabs.reload(tabId).catch(() => {});
}
let powerUpdate = Promise.resolve();
function refreshPower() {
  powerUpdate = powerUpdate.catch(() => {}).then(async () => {
    if (!chrome.power) return;
    const all = await chrome.storage.session.get(null);
    const settings = await config();
    const active = settings.keepAwake && Object.entries(all).some(([key, value]) => key.startsWith('tab:') && value?.enabled);
    if (active) chrome.power.requestKeepAwake('system');
    else chrome.power.releaseKeepAwake();
  });
  return powerUpdate;
}
async function notifyControl(id) {
  try { await chrome.tabs.sendMessage?.(id, { type: 'controlChanged' }); } catch { /* Page may be loading. Its next tick reads stored state. */ }
}
function solveContext(value, settings) {
  if (value === undefined) value = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('�γ���������Ч');
  const context = {};
  for (const key of ['courseTitle', 'chapterTitle']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 500)) throw new Error('�γ̻��½ڱ������');
    context[key] = (value[key] || '').trim();
  }
  context.programmingLanguage = settings.programmingLanguage === 'auto' ? (value.programmingLanguage || 'auto') : settings.programmingLanguage;
  if (!languages.has(context.programmingLanguage)) throw new Error('���������Ч');
  return context;
}
async function updateSession(id, update) {
  // Read and write inside the same per-tab queue. A delayed heartbeat must not
  // restore an enabled snapshot after the user has stopped the tab.
  const previous = sessionUpdates.get(id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const next = update(await session(id));
    await chrome.storage.session.set({ [tabKey(id)]: next });
    return next;
  });
  sessionUpdates.set(id, operation);
  try { return await operation; }
  finally { if (sessionUpdates.get(id) === operation) sessionUpdates.delete(id); }
}
async function api(path, body, tabId, generation) {
  const settings = await config();
  if (!settings.token) throw new Error('��������չ������д�����������');
  if (generation !== undefined && (stoppedTabs.has(tabId) || generation !== (generations.get(tabId) || 0)))
    throw new Error('�й���ֹͣ��ҳ�����л�');
  const controller = new AbortController();
  if (tabId !== undefined) {
    if (!controllers.has(tabId)) controllers.set(tabId, new Set());
    controllers.get(tabId).add(controller);
  }
  try {
    const response = await fetch(`http://127.0.0.1:18765${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(path === '/health' ? 4000 : 240000)]),
      headers: { Authorization: `Bearer ${settings.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === 'TypeError' || /failed to fetch|fetch failed/i.test(error.message))
      throw new Error('�޷����ӱ��ط��� 127.0.0.1:18765�������� start.cmd �ָ���̨��������������������չ�ı�������Ȩ�ޡ�');
    if (path === '/health' && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw new Error('���ط������ӳ�ʱ��4�룩�������� start.cmd ������');
    throw error;
  } finally { controllers.get(tabId)?.delete(controller); }
}
function abortTab(id) {
  generations.set(id, (generations.get(id) || 0) + 1);
  for (const c of controllers.get(id) || []) c.abort();
  controllers.delete(id);
}
const discussionReplyPath = /^\/course\/topic\/v3\/bbs\/.*replysList\/?$/i;
const discussionRevision = 3;
const recognitionOnlySkip = /^(?:δ�ҵ��ɽ��������ҳ��|�޷�����ʶ���ʦ��Ŀ|�޷�ʶ��(?:��ʦ��Ŀ|Ψһ�ɼ��ظ��༭��|Ψһ�������))/;
function discussionUrl(value, replyOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('���۵�ַ��Ч'); }
  if (url.protocol !== 'https:' || !/(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname) || url.username || url.password ||
    !(discussionReplyPath.test(url.pathname) || (!replyOnly && (/\/ananas\/modules\/(?:discuss(?:ion)?|bbs|insertbbs)\//i.test(url.pathname) ||
      (/^\/(?:mooc-ans\/)?bbscircle\/chapter\/?$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get('mtopicid') || ''))))))
    throw new Error('δʶ��ѧϰͨ����ҳ��ַ');
  url.hash = '';
  for (const key of ['t', '_t', 'timestamp', '_']) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
async function closeDiscussionChildren(id) {
  const state = await session(id);
  for (const record of Object.values(state.discussions || {})) if (Number.isInteger(record.childTab)) {
    const child = await session(record.childTab);
    if (child.parentTab !== id) continue;
    abortTab(record.childTab);
    await updateSession(record.childTab, current => ({ ...current, enabled: false }));
    await chrome.tabs.remove?.(record.childTab).catch(() => {});
  }
}
async function endDiscussion(childId, key, status, reason) {
  const child = await session(childId);
  if (!Number.isInteger(child.parentTab) || child.discussionKey !== key) throw new Error('��Ч�����ۻ�ִ');
  const parent = await session(child.parentTab);
  if (!parent.enabled || parent.discussions?.[key]?.childTab !== childId) throw new Error('ԭ�γ��й���ֹͣ');
  if (locks.get(child.parentTab)?.frameId === -childId) locks.delete(child.parentTab);
  await updateSession(child.parentTab, current => ({ ...current, discussions: { ...current.discussions,
    [key]: { ...current.discussions[key], status, reason: String(reason || '').slice(0, 300), revision: discussionRevision, at: Date.now() } } }));
  await updateSession(childId, current => ({ ...current, enabled: false }));
  await notifyControl(child.parentTab); await refreshPower();
  // Reload only after a concrete reply receipt; unknown outcomes never trigger
  // another publish. Keep the checkpoint even if the task icon stays pending.
  if (status === 'submitted') await chrome.tabs.reload?.(child.parentTab).catch(() => {});
  await chrome.tabs.remove?.(childId).catch(() => {});
  return { status, reason };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const requestGeneration = generations.get(sender.tab?.id) || 0;
  const task = async () => {
    const extensionPage = !sender.tab && sender.id === chrome.runtime.id;
    const tabId = sender.tab?.id;
    if (message.type === 'config') return config();
    if (message.type === 'health' && extensionPage) return api('/health');
    if (message.type === 'saveConfig' && extensionPage) {
      const { token, autoSubmit, autoDiscuss = true, confidence, nextSelector, completeSelector, programmingLanguage = 'auto', documentMode = 'fast', autoSeekAudio = true, keepAwake = true } = message.value;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('���Ŷȱ���Ϊ 0�C1');
      if (!languages.has(programmingLanguage)) throw new Error('���������Ч');
      if (!['fast', 'paced'].includes(documentMode)) throw new Error('�ĵ����ģʽ��Ч');
      await chrome.storage.local.set({ config: { token: String(token).trim(), autoSubmit: !!autoSubmit, autoDiscuss: !!autoDiscuss, confidence, nextSelector: String(nextSelector), completeSelector: String(completeSelector), programmingLanguage, documentMode, autoSeekAudio: !!autoSeekAudio, keepAwake: !!keepAwake } });
      await refreshPower();
      return api('/health');
    }
    if (message.type === 'providerConfig' && extensionPage) return api('/config');
    if (message.type === 'saveProviderConfig' && extensionPage) return api('/config', message.value);
    if (message.type === 'resetPending') {
      if (!extensionPage || message.confirmed !== true || !Number.isInteger(message.tabId)) throw new Error('������չ������ȷȷ�Ϻ�������ǰҳ��¼');
      const latest = freshReports(message.tabId, await session(message.tabId));
      const keys = new Set(latest.map(report => report.quizKey).filter(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)));
      if (latest.some(report => keys.has(report.quizKey) && (report.busy || report.mode === 'submitting'))) throw new Error('��ǰ��Ŀ����ִ�У���ֹͣ���ȴ�ҳ�������������');
      // Checkpoints are shared local storage; never remove a key another tab is using.
      for (const [otherTab, frames] of reports) if (otherTab !== message.tabId) {
        for (const report of frames.values()) if (Date.now() - report.at < 12000) keys.delete(report.quizKey);
      }
      const names = [...keys].map(key => `quiz:${key}`);
      const stored = names.length ? await chrome.storage.local.get(names) : {};
      const eligible = names.filter(name => ['submitting', 'uncertain'].includes(stored[name]?.stage));
      if (!eligible.length) return { clearedCount: 0, refreshRequired: false };
      stoppedTabs.add(message.tabId);
      abortTab(message.tabId); locks.delete(message.tabId);
      controlVersions.set(message.tabId, (controlVersions.get(message.tabId) || 0) + 1);
      const priorDiscardable = (await session(message.tabId)).autoDiscardableBefore;
      await updateSession(message.tabId, current => {
        const { autoDiscardableBefore, ...rest } = current;
        return { ...rest, enabled: false, progress: null, last: '������δȷ�ϼ�¼����ˢ�¿γ�ҳ�����¿�ʼ' };
      });
      await chrome.alarms.clear(`keep:${message.tabId}`);
      await setTabDiscardable(message.tabId, priorDiscardable);
      await refreshPower(); await notifyControl(message.tabId);
      const current = await chrome.storage.local.get(eligible);
      const clear = eligible.filter(name => ['submitting', 'uncertain'].includes(current[name]?.stage));
      if (clear.length) await chrome.storage.local.remove(clear);
      let warning;
      try { await api('/event', { type: 'checkpoint_reset', detail: JSON.stringify({ tabId: message.tabId, clearedCount: clear.length }) }); }
      catch (error) { warning = `ҳ���¼��������ɣ����¼���־��¼ʧ�ܣ�${error.message}`; }
      return { clearedCount: clear.length, refreshRequired: true, ...(warning ? { warning } : {}) };
    }
    if (message.type === 'control' && extensionPage) {
      const version = (controlVersions.get(message.tabId) || 0) + 1;
      controlVersions.set(message.tabId, version);
      // Stop must cancel immediately, even if a preceding state write is slow.
      if (!message.enabled) {
        stoppedTabs.add(message.tabId);
        abortTab(message.tabId); reports.delete(message.tabId); locks.delete(message.tabId); missingTopFrames.delete(message.tabId);
        await closeDiscussionChildren(message.tabId);
      }
      const tab = await chrome.tabs.get(message.tabId);
      const url = new URL(tab.url);
      if (message.enabled && (!/(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname) || !/\/mycourse\/studentstudy|\/knowledge\/cards|\/mooc-ans\/mooc2\/work\/dowork/.test(url.pathname)))
        throw new Error('���Ƚ���γ��½�����ҳ����ҵ����ҳ���ٿ�ʼ�й�');
      const course = url.searchParams.get('courseid') || url.searchParams.get('courseId');
      let changed = false, controlGeneration, priorDiscardable;
      const state = await updateSession(tab.id, current => {
        if (controlVersions.get(tab.id) !== version) return current;
        const sameCourse = course && current.course ? course === current.course : current.url === tab.url;
        // Repeated starts keep the current request, frame lock and progress.
        if (message.enabled && current.enabled && sameCourse && !stoppedTabs.has(tab.id)) return current;
        changed = true;
        priorDiscardable = message.enabled ?
          (typeof current.autoDiscardableBefore === 'boolean' ? current.autoDiscardableBefore : tab.autoDiscardable) :
          current.autoDiscardableBefore;
        if (message.enabled) {
          stoppedTabs.add(tab.id);
          abortTab(tab.id); reports.delete(tab.id); locks.delete(tab.id);
        }
        controlGeneration = generations.get(tab.id);
        return { enabled: !!message.enabled, started: Date.now(), url: tab.url, course,
          ...(sameCourse ? { discussions: current.discussions || {} } : {}),
          ...(message.enabled && typeof priorDiscardable === 'boolean' ? { autoDiscardableBefore: priorDiscardable } : {}),
          last: message.enabled ? '�ѿ�ʼ���ȴ�ҳ��ʶ��' : '��ֹͣ' };
      });
      if (!changed || controlVersions.get(tab.id) !== version) { await refreshPower(); await notifyControl(tab.id); return state; }
      if (message.enabled && generations.get(tab.id) === controlGeneration) stoppedTabs.delete(tab.id);
      await setTabDiscardable(tab.id, message.enabled ? false : priorDiscardable);
      if (message.enabled) await chrome.alarms.create(`keep:${tab.id}`, { periodInMinutes: 0.5 });
      else await chrome.alarms.clear(`keep:${tab.id}`);
      await refreshPower(); await notifyControl(tab.id);
      api('/event', { type: message.enabled ? 'started' : 'stopped', detail: url.pathname }).catch(() => {});
      return state;
    }
    if (message.type === 'popupState' && extensionPage) {
      const current = await session(message.tabId);
      const frames = freshReports(message.tabId, current);
      const tab = current.enabled ? await chrome.tabs.get(message.tabId).catch(() => null) : null;
      const suspended = tab?.discarded ? 'Chrome �Ѷ����γ̱�ǩҳ�����лظñ�ǩҳ�ָ�' :
        tab?.frozen ? 'Chrome �Ѷ���γ̱�ǩҳ�����лظñ�ǩҳ�ָ�' : '';
      return { ...current, ...(current.enabled ? reportSummary(frames, locks.get(message.tabId)) : {}), frames,
        stale: !!suspended || current.enabled && !frames.length,
        ...(suspended ? { last: suspended, progress: null } : {}) };
    }
    if (tabId === undefined) throw new Error('��Ч��ҳ����Ϣ');
    const state = await session(tabId);
    if (message.type === 'state') return { ...state, config: await config() };
    if (message.type === 'report') {
      freshReports(tabId, state);
      if (sender.frameId === 0 && state.route && message.value.route && state.route !== message.value.route) {
        abortTab(tabId); reports.delete(tabId); locks.delete(tabId);
      }
      if (!reports.has(tabId)) reports.set(tabId, new Map());
      reports.get(tabId).set(sender.frameId, { ...message.value, at: Date.now() });
      const lockTab = state.parentTab ?? tabId, lockFrame = Number.isInteger(state.parentTab) ? -tabId : sender.frameId;
      const owner = locks.get(lockTab);
      if (owner?.frameId === lockFrame) {
        if (message.value.busy || ['quiz', 'submitting', 'media', 'document', 'text', 'discussion'].includes(message.value.mode)) owner.at = Date.now();
        else locks.delete(lockTab);
      }
      await updateSession(tabId, current => current.enabled && !stoppedTabs.has(tabId) ? {
        ...current,
        ...(sender.frameId === 0 ? { route: message.value.route } : {}),
        frames: freshReports(tabId), ...reportSummary(freshReports(tabId), locks.get(tabId))
      } : current);
      await restoreMissingChapterFrame(tabId, state);
      return { ok: true };
    }
    if (message.type === 'reports') return freshReports(tabId, state);
    if (!state.enabled || stoppedTabs.has(tabId) || requestGeneration !== (generations.get(tabId) || 0)) throw new Error('�й���ֹͣ��ҳ�����л�');
    if (message.type === 'discussionStatus') {
      // Retry only older adapter recognition failures. Never erase publication
      // intent, unknown outcomes, closed pages or manually preserved drafts.
      const retryKeys = Object.entries(state.discussions || {}).filter(([, record]) => record.status === 'skipped' &&
        (record.revision || 0) < discussionRevision && recognitionOnlySkip.test(record.reason || '')).map(([key]) => key);
      if (retryKeys.length) await updateSession(tabId, current => {
        const records = { ...current.discussions };
        for (const key of retryKeys) if (records[key]?.status === 'skipped' && (records[key].revision || 0) < discussionRevision && recognitionOnlySkip.test(records[key].reason || '')) delete records[key];
        return { ...current, discussions: records };
      });
      for (const [key, record] of Object.entries(state.discussions || {})) {
        if (['opening', 'working'].includes(record.status) && Date.now() - record.at > 300000) {
          await updateSession(tabId, current => ({ ...current, discussions: { ...current.discussions,
            [key]: { ...record, status: 'skipped', reason: '����ҳ�洦����ʱ���������ұ���δ��ɱ��' } } }));
          if (Number.isInteger(record.childTab)) {
            abortTab(record.childTab); await updateSession(record.childTab, current => ({ ...current, enabled: false }));
            await chrome.tabs.remove?.(record.childTab).catch(() => {});
          }
        }
      }
      return (await session(tabId)).discussions || {};
    }
    if (message.type === 'skipDiscussion' || message.type === 'openDiscussion') {
      if (state.parentTab !== undefined) throw new Error('������ҳ�����ٴ���������');
      const key = discussionUrl(message.key);
      if (message.type === 'skipDiscussion') {
        const record = { status: 'skipped', reason: String(message.reason || '�޷�ʶ�����ۣ�������').slice(0, 300), revision: discussionRevision, at: Date.now() };
        await updateSession(tabId, current => ({ ...current, discussions: { ...current.discussions, [key]: record } }));
        return record;
      }
      const href = discussionUrl(message.href, true);
      let created = false;
      const updated = await updateSession(tabId, current => {
        if (current.discussions?.[key]) return current;
        created = true;
        return { ...current, discussions: { ...current.discussions, [key]: { status: 'opening', href, revision: discussionRevision, at: Date.now() } } };
      });
      if (!created) return updated.discussions[key];
      let child;
      try {
        child = await chrome.tabs.create({ url: 'about:blank', active: false });
        const latest = await session(tabId);
        if (!latest.enabled || stoppedTabs.has(tabId)) { await chrome.tabs.remove(child.id); throw new Error('�й���ֹͣ'); }
        await updateSession(child.id, () => ({ enabled: true, parentTab: tabId, discussionKey: key, assignedUrl: href,
          course: state.course, last: '���ڼ��ؽ�ʦ������' }));
        await updateSession(tabId, current => ({ ...current, discussions: { ...current.discussions,
          [key]: { ...current.discussions[key], childTab: child.id, status: 'working' } } }));
        await chrome.tabs.update(child.id, { url: href }); await refreshPower();
        return (await session(tabId)).discussions[key];
      } catch (error) {
        if (Number.isInteger(child?.id)) {
          abortTab(child.id); await updateSession(child.id, current => ({ ...current, enabled: false }));
          await chrome.tabs.remove?.(child.id).catch(() => {});
        }
        const record = { status: 'skipped', reason: '�޷���������ҳ�棺' + error.message, revision: discussionRevision, at: Date.now() };
        await updateSession(tabId, current => ({ ...current, discussions: { ...current.discussions, [key]: record } }));
        return record;
      }
    }
    if (message.type === 'finishDiscussion') {
      if (!['submitted', 'skipped'].includes(message.status)) throw new Error('���۽����Ч');
      if (!discussionReplyPath.test(new URL(sender.url || state.assignedUrl || '').pathname)) throw new Error('���ۻ�ִ��Դ��Ч');
      if (message.status === 'submitted' && discussionUrl(sender.url || state.assignedUrl, true) !== state.assignedUrl)
        throw new Error('����ҳ���Ѹı䣬����ȷ��ԭ�ⷢ���ɹ�');
      return endDiscussion(tabId, message.key, message.status, message.reason);
    }
    if (message.type === 'discussion') {
      if (!state.discussionKey || message.key !== state.discussionKey || !Number.isInteger(state.parentTab) || !(await session(state.parentTab)).enabled)
        throw new Error('����δ�󶨵������йܵĿγ�');
      if (discussionUrl(sender.url || state.assignedUrl, true) !== state.assignedUrl) throw new Error('����ҳ���Ѹı䣬δ���ɻظ�');
      const settings = await config();
      if (!settings.autoDiscuss) throw new Error('�Զ������ѹر�');
      return api('/discussion', { topic: message.topic, context: solveContext(message.context, settings) }, tabId, requestGeneration);
    }
    if (message.type === 'claimTask') {
      const lockTab = state.parentTab ?? tabId, frameId = Number.isInteger(state.parentTab) ? -tabId : sender.frameId;
      let owner = locks.get(lockTab);
      if (owner && Date.now() - owner.at > 15000) { locks.delete(lockTab); owner = undefined; }
      if (owner && owner.frameId !== frameId) return { ok: false };
      locks.set(lockTab, { key: message.key, frameId, at: Date.now() }); return { ok: true };
    }
    if (message.type === 'releaseTask') {
      const lockTab = state.parentTab ?? tabId, frameId = Number.isInteger(state.parentTab) ? -tabId : sender.frameId;
      if (locks.get(lockTab)?.key === message.key && locks.get(lockTab)?.frameId === frameId) locks.delete(lockTab);
      return { ok: true };
    }
    if (message.type === 'solve') {
      const key = `${tabId}:${message.key}`;
      if (pending.has(key)) throw new Error('ͬһ����� agent �������ڴ�����');
      pending.add(key);
      try {
        const settings = await config();
        const context = solveContext(message.context, settings);
        const result = await api('/solve', { questions: message.questions, context,
          confidenceThreshold: settings.confidence }, tabId, requestGeneration);
        return { ...result, context };
      }
      finally { pending.delete(key); }
    }
    if (message.type === 'event') return api('/event', message.value, tabId, requestGeneration);
    throw new Error('δ֪��Ϣ');
  };
  task().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(async alarm => {
  const match = alarm.name.match(/^keep:(\d+)$/);
  if (!match) return;
  const id = Number(match[1]);
  if (!(await session(id)).enabled) { await chrome.alarms.clear(alarm.name); await refreshPower(); return; }
  await refreshPower();
  // Hidden pages can have their timers throttled. A worker alarm still wakes
  // the content script to check playback and publish fresh progress.
  try { await chrome.tabs.sendMessage?.(id, { type: 'heartbeat' }); } catch { /* Page may be loading. */ }
});
chrome.tabs.onRemoved.addListener(async id => {
  const state = await session(id);
  if (Number.isInteger(state.parentTab)) {
    if (locks.get(state.parentTab)?.frameId === -id) locks.delete(state.parentTab);
    await updateSession(state.parentTab, current => {
      const record = current.discussions?.[state.discussionKey];
      if (!record || !['opening', 'working'].includes(record.status)) return current;
      return { ...current, discussions: { ...current.discussions, [state.discussionKey]: { ...record,
        status: 'skipped', reason: '����ҳ���ѹرգ�����δ��ɱ�ǲ�����', at: Date.now() } } };
    });
  } else await closeDiscussionChildren(id);
  abortTab(id); reports.delete(id); locks.delete(id); missingTopFrames.delete(id);
  await updateSession(id, current => ({ ...current, enabled: false }));
  await chrome.storage.session.remove(tabKey(id)); await chrome.alarms.clear(`keep:${id}`);
  await refreshPower();
});
chrome.tabs.onUpdated.addListener(async (id, change) => {
  const state = await session(id);
  if (!state.enabled) return;
  if (change.status === 'loading') {
    abortTab(id); reports.delete(id); locks.delete(id);
    await updateSession(id, current => ({ ...current, frames: [], progress: null, updatedAt: null, route: null, last: 'ҳ�����ڼ��أ��йܽ��Զ�����' }));
  }
  if (!change.url) return;
  const url = new URL(change.url);
  if (Number.isInteger(state.parentTab)) {
    if (change.url === 'about:blank') return;
    try {
      if (discussionUrl(change.url, true) !== state.assignedUrl) throw new Error('different topic');
      return;
    }
    catch { await endDiscussion(id, state.discussionKey, 'skipped', '������ת���޷�ʶ���ҳ�棬������').catch(() => {}); return; }
  }
  const course = url.searchParams.get('courseid') || url.searchParams.get('courseId');
  if (!/(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname) || !/\/mycourse\/studentstudy|\/knowledge\/cards|\/mooc-ans\/mooc2\/work\/dowork/.test(url.pathname) || (state.course && course && state.course !== course)) {
    abortTab(id); reports.delete(id); locks.delete(id); missingTopFrames.delete(id);
    stoppedTabs.add(id);
    await updateSession(id, current => {
      const { autoDiscardableBefore, ...rest } = current;
      return { ...rest, enabled: false, frames: [], progress: null, last: '���뿪ԭ�γ��½�ҳ���й��Զ�ֹͣ' };
    });
    await chrome.alarms.clear(`keep:${id}`);
    await setTabDiscardable(id, state.autoDiscardableBefore);
    await refreshPower(); await notifyControl(id);
  }
});
// MV3 workers may restart while a tab is still managed.
refreshPower().catch(() => {});
