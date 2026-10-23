/* Teacher-topic discussion adapter. Only verified page receipts prove a post. */
(() => {
  const A = globalThis.ChaoxingAdapter;
  const modulePath = /\/ananas\/modules\/(?:discuss(?:ion)?|bbs|insertbbs)\//i;
  const previewPath = /^\/(?:mooc-ans\/)?bbscircle\/chapter\/?$/i;
  const replyPath = /^\/course\/topic\/v3\/bbs\/.*replysList\/?$/i;
  const seen = new Map(), dispositions = new Map();
  const normalize = value => String(value || '').replace(/\s+/gu, ' ').trim();
  function canonical(value, base = location.href) {
    try {
      const url = new URL(value, base);
      if (url.protocol !== 'https:' || !/(^|\.)(chaoxing|xuexitong)\.com$/.test(url.hostname)) return null;
      url.hash = '';
      for (const key of ['t', '_t', 'timestamp', '_']) url.searchParams.delete(key);
      url.searchParams.sort(); return url.href;
    } catch { return null; }
  }
  const replyUrl = (value, base) => { const url = canonical(value, base); return url && replyPath.test(new URL(url).pathname) ? url : null; };
  function previewKey(value, base) {
    const canonicalUrl = canonical(value, base);
    if (!canonicalUrl) return null;
    const url = new URL(canonicalUrl);
    if (!previewPath.test(url.pathname) || !/^\d+$/.test(url.searchParams.get('mtopicid') || '')) return null;
    // insertbbs wrapper URLs repeat for every topic. The preview's topic ID is
    // the identity; signatures, timestamps and viewer tokens are not identity.
    const identity = new URL(url.origin + url.pathname);
    for (const name of ['mtopicid', 'courseid', 'clazzid', 'cpi'])
      if (url.searchParams.has(name)) identity.searchParams.set(name, url.searchParams.get(name));
    identity.searchParams.sort(); return identity.href;
  }
  function linkWithin(root, depth = 0) {
    if (depth > 6) return null;
    // The native preview stores its ordinary destination URL in `data`.
    // Read only that URL; never evaluate onclick or execute attribute strings.
    for (const topic of root.querySelectorAll('#topicMainDiv[data]')) {
      const href = replyUrl(topic.getAttribute('data'), topic.ownerDocument.URL);
      if (href) return href;
    }
    for (const item of root.querySelectorAll('a[href],iframe[src]')) {
      const href = replyUrl(item.getAttribute('href') || item.getAttribute('src'), item.ownerDocument.URL);
      if (href) return href;
      if (item.localName === 'iframe') {
        try { const nested = item.contentDocument && linkWithin(item.contentDocument, depth + 1); if (nested) return nested; } catch {}
      }
    }
    return null;
  }
  function previewWithin(root, depth = 0) {
    if (depth > 6) return null;
    const own = root.nodeType === 9 && previewKey(root.URL);
    if (own) return own;
    for (const frame of root.querySelectorAll('iframe[src]')) {
      const key = previewKey(frame.getAttribute('src'), frame.ownerDocument.URL);
      if (key) return key;
      try { const nested = frame.contentDocument && previewWithin(frame.contentDocument, depth + 1); if (nested) return nested; } catch {}
    }
    return null;
  }
  function wrapperKey(frame, attachment) {
    const url = new URL(frame.src);
    if (!/\/insertbbs\//i.test(url.pathname)) return canonical(url.href);
    const owner = new URL(frame.ownerDocument.URL);
    url.searchParams.set('__cxChapter', owner.searchParams.get('knowledgeid') || owner.searchParams.get('chapterId') || owner.pathname);
    url.searchParams.set('__cxAttachment', String([...frame.ownerDocument.querySelectorAll('.ans-attach-ct')].indexOf(attachment)));
    return canonical(url.href);
  }
  function task(attachment) {
    const frame = [...attachment.querySelectorAll('iframe[src]')].find(frame => {
      const url = canonical(frame.getAttribute('src'), frame.ownerDocument.URL); return url && (modulePath.test(new URL(url).pathname) || replyUrl(url) || previewKey(url));
    });
    if (!frame) return null;
    const frameUrl = canonical(frame.getAttribute('src'), frame.ownerDocument.URL);
    const href = replyUrl(frameUrl) || linkWithin(attachment);
    const key = previewWithin(attachment) || (/\/insertbbs\//i.test(new URL(frameUrl).pathname) && href) || wrapperKey(frame, attachment);
    return { key, href, attachment };
  }
  function frameTaskCompleted() {
    let view = window;
    while (view !== view.top) {
      try {
        const frame = view.frameElement;
        if (!frame) return false;
        const attachment = frame.closest('.ans-attach-ct');
        if (attachment) return attachment.classList.contains('ans-job-finished') ||
          [...attachment.querySelectorAll('.ans-job-icon')].some(icon => icon.closest('.ans-attach-ct') === attachment && icon.classList.contains('ans-job-finished'));
        view = frame.ownerDocument.defaultView;
      } catch { return false; }
    }
    return false;
  }
  function tasks() {
    if ((modulePath.test(location.pathname) || previewPath.test(location.pathname)) && frameTaskCompleted()) return [];
    if (previewPath.test(location.pathname)) {
      const key = previewKey(location.href); return key ? [{ key, href: linkWithin(document) }] : [];
    }
    if (modulePath.test(location.pathname)) {
      const href = linkWithin(document), preview = previewWithin(document);
      if (/\/insertbbs\//i.test(location.pathname) && !preview && !href) return [];
      return [{ key: preview || (/\/insertbbs\//i.test(location.pathname) && href) || canonical(location.href), href }];
    }
    return [...document.querySelectorAll('.ans-attach-ct')].map(task).filter(Boolean);
  }
  function skippedCount(jobs) {
    return jobs.filter(job => {
      if (job.done) return false;
      const attachment = job.icon.closest('.ans-attach-ct'), info = attachment && task(attachment);
      return info && ['skipped', 'submitted'].includes(dispositions.get(info.key)?.status);
    }).length;
  }
  function teacherTopic() {
    const roots = ['#bbsTopicDetail .topicDetail_head .topicDetail_title', '#bbsTopicDetail .topicDetail_main']
      .map(selector => document.querySelector(selector)).filter(root => root && A.visible(root));
    const parts = [];
    for (const root of roots) {
      const copy = root.cloneNode(true);
      copy.querySelectorAll('.topicDetail_info,.detail_bottom,.topicDetail_title_right,.tag,.replyList,.reply_list,textarea,[contenteditable],script,style').forEach(node => node.remove());
      if (copy.querySelector('img,canvas,.font-cxsecret')) return '';
      const value = normalize(copy.textContent);
      if (value && value !== '无标题' && !parts.includes(value)) parts.push(value);
    }
    return parts.join('\n');
  }
  function editor() {
    const fields = [...document.querySelectorAll('textarea:not([disabled]):not([readonly]),[contenteditable="true"]')].filter(A.visible);
    for (const frame of document.querySelectorAll('.edui-editor-iframeholder iframe,iframe[id^="ueditor_"]')) {
      try { if (A.visible(frame) && frame.contentDocument?.body.isContentEditable) fields.push(frame.contentDocument.body); } catch {}
    }
    const unique = [...new Set(fields)].filter(field => !field.closest('#bbsTopicDetail .topicDetail_main'));
    return unique.length === 1 ? unique[0] : null;
  }
  function submitButton(field) {
    const allowed = /^(发表|发布|回复|提交|发表评论|发表回复|发布回复)$/;
    const scope = field.closest('form,.replyEditor,.reply_editor,.replyBox,.reply_box,.replyEdit') || document;
    const candidates = [...scope.querySelectorAll('button,a,input[type="submit"],input[type="button"],.replyEdit .addReply')].filter(node =>
      A.visible(node) && !node.matches(':disabled,[aria-disabled="true"]') && allowed.test(normalize(node.value || A.text(node))) &&
      !node.closest('.replyList,.reply_list,#bbsTopicDetail .topicDetail_main'));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function receiptSnapshot(reply) {
    const expected = normalize(reply);
    return { replies: new Set([...document.querySelectorAll('.replyContent,.reply_list .reply_content,.reply-list .reply-content,.reply-item .reply-content')].filter(node =>
      !node.closest('#bbsTopicDetail,.replyEdit,.editContainer,textarea,[contenteditable]') && A.visible(node) && normalize(node.textContent) === expected)),
      alerts: new Set([...document.querySelectorAll('[role="alert"],.layui-layer-content,.toast,.success-tip')].filter(node => A.visible(node) && /^(?:回复|发表|发布|评论)成功[！!。.]?$/.test(normalize(node.textContent)))) };
  }
  function receipt(reply, baseline) {
    if (!normalize(reply)) return false;
    const now = receiptSnapshot(reply);
    if ([...now.replies].some(node => !baseline.replies.has(node))) return true;
    const ack = [...now.alerts].some(node => !baseline.alerts.has(node));
    const field = editor();
    return ack && field && !normalize(field.value ?? field.textContent);
  }
  const delay = () => new Promise(resolve => setTimeout(resolve, 250));
  async function handle({ send, state, alive, onProgress }) {
    if (replyPath.test(location.pathname) && state.discussionKey) {
      const key = state.discussionKey, route = location.href;
      const finish = (status, reason) => send({ type: 'finishDiscussion', key, status, reason });
      const assigned = canonical(state.assignedUrl);
      if (!assigned || canonical(location.href) !== assigned) {
        await finish('skipped', '讨论页面与原任务不一致，已跳过');
        return { active: true, status: '讨论页面已改变，未发布', mode: 'skipped' };
      }
      const current = async () => {
        if (location.href !== route || canonical(location.href) !== assigned || !(await alive())) return false;
        if ((await send({ type: 'config' })).autoDiscuss === false) throw new Error('自动讨论已关闭，已跳过后续发布');
        return true;
      };
      const checkpointIdentity = previewKey(state.discussionKey) || canonical(location.href);
      const storageKey = 'discussion:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(checkpointIdentity)))].map(b => b.toString(16).padStart(2, '0')).join('');
      let old = (await chrome.storage.local.get(storageKey))[storageKey];
      if (old?.stage === 'submitted') {
        await finish('submitted', '已观察到讨论回复，刷新原课程页'); return { active: true, status: '讨论已发表，正在返回课程', mode: 'complete' };
      }
      if (['submitting', 'uncertain'].includes(old?.stage)) {
        await finish('skipped', '上次讨论发布结果未确认，已跳过且不会重复发布'); return { active: true, status: '讨论发布结果待人工确认', mode: 'skipped' };
      }
      if (!seen.has(key)) seen.set(key, Date.now());
      const topic = teacherTopic(), field = editor(), button = field && submitButton(field);
      if (topic.length < 8 || topic.length > 12000 || !field || !button) {
        if (Date.now() - seen.get(key) < 12000) return { active: true, status: '正在等待教师讨论题和回复编辑区加载', mode: 'discussion' };
        const missing = [topic.length < 8 || topic.length > 12000 ? '教师题目' : '', !field ? '唯一可见回复编辑区' : '', field && !button ? '唯一发布入口' : ''].filter(Boolean).join('、');
        await finish('skipped', '无法识别' + missing + '，已跳过讨论');
        return { active: true, status: '无法识别讨论页面，已跳过', mode: 'skipped' };
      }
      if (normalize(field.value ?? field.textContent) && old?.reply !== (field.value ?? field.textContent)) {
        await finish('skipped', '讨论编辑区已有内容，已保留并跳过自动发布'); return { active: true, status: '已保留原有讨论草稿', mode: 'skipped' };
      }
      const claim = await send({ type: 'claimTask', key: 'discussion:' + key });
      if (!claim.ok) return { active: true, status: '等待前一个任务完成后处理讨论', mode: 'queued' };
      try {
        const originalDraft = field.value ?? field.textContent;
        await onProgress('正在根据教师题目生成讨论回复');
        const result = old?.topic === topic && old?.stage === 'filled' ? old : await send({ type: 'discussion', key, topic, context: A.courseContext() });
        if (!(await current())) return { active: true, status: '讨论已停止', mode: 'idle' };
        const reply = result.reply?.trim();
        if (!reply || reply.length < 20 || reply.length > 3000 || !Number.isFinite(result.confidence) || result.confidence < state.config.confidence) {
          await finish('skipped', '讨论回复无效或置信度不足，已跳过'); return { active: true, status: '讨论回复未通过校验', mode: 'skipped' };
        }
        if (teacherTopic() !== topic || editor() !== field || !field.isConnected || !button.isConnected || (field.value ?? field.textContent) !== originalDraft) {
          await finish('skipped', '生成期间讨论题或编辑区变化，未发布'); return { active: true, status: '讨论页面变化，已跳过', mode: 'skipped' };
        }
        const parsed = [{ node: field, data: { id: 'discussion' }, options: [], fields: [field], mirrors: [[]] }];
        A.applyAnswers(parsed, [{ id: 'discussion', values: [reply] }]);
        old = { stage: 'filled', topic, reply, confidence: result.confidence, at: Date.now() };
        await chrome.storage.local.set({ [storageKey]: old });
        if (!(await current())) return { active: true, status: '讨论已停止', mode: 'idle' };
        A.prepareClick(button);
        await chrome.storage.local.set({ [storageKey]: { ...old, stage: 'submitting' } });
        if (!(await current())) return { active: true, status: '讨论已停止，待核查发布状态', mode: 'idle' };
        if (teacherTopic() !== topic || editor() !== field || submitButton(field) !== button) throw new Error('发布前讨论页面发生变化，未点击发布');
        A.verifyAnswers(parsed, [{ id: 'discussion', values: [reply] }]);
        const baseline = receiptSnapshot(reply);
        A.safeClick(button); await onProgress('已点击发布，正在核查讨论回执');
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          if (!(await current())) return { active: true, status: '讨论已停止', mode: 'idle' };
          if (receipt(reply, baseline)) {
            await chrome.storage.local.set({ [storageKey]: { ...old, stage: 'submitted' } });
            await finish('submitted', '平台页面已出现对应回复，刷新原课程页');
            return { active: true, status: '已确认讨论发布，正在刷新原课程页', mode: 'complete' };
          }
          await delay();
        }
        await chrome.storage.local.set({ [storageKey]: { ...old, stage: 'uncertain' } });
        await finish('skipped', '讨论发布回执未确认，已跳过且不会重复发布');
        return { active: true, status: '讨论发布回执未确认', mode: 'skipped' };
      } catch (error) {
        if (/agent 正在处理另一请求|AI 正在处理请求/.test(error.message) && await alive())
          return { active: true, status: 'AI 正在处理另一任务，讨论排队等待', mode: 'discussion' };
        await chrome.storage.local.set({ ['discussion-error:' + storageKey.slice('discussion:'.length)]: {
          message: String(error.message || error), at: Date.now()
        } }).catch(() => {});
        const message = globalThis.ChaoxingStatusText?.('讨论处理失败，已跳过：' + error.message) || '讨论处理失败，已跳过';
        if (await alive()) await finish('skipped', message);
        return { active: true, status: message, mode: 'skipped' };
      } finally { await send({ type: 'releaseTask', key: 'discussion:' + key }).catch(() => {}); }
    }
    const pending = tasks().filter(info => !info.attachment || !A.jobs().filter(job => job.icon.closest('.ans-attach-ct') === info.attachment).every(job => job.done));
    if (!pending.length) return null;
    const records = await send({ type: 'discussionStatus' });
    for (const [key, value] of Object.entries(records)) dispositions.set(key, value);
    for (const info of pending) if (!seen.has(info.key)) seen.set(info.key, Date.now());
    for (const info of pending) {
      if (['skipped', 'submitted'].includes(dispositions.get(info.key)?.status)) continue;
      if (['opening', 'working'].includes(dispositions.get(info.key)?.status))
        return { active: true, status: '正在处理教师讨论题，等待发布结果', mode: 'discussion' };
      if (!seen.has(info.key)) seen.set(info.key, Date.now());
      if (state.config.autoDiscuss === false || (!info.href && Date.now() - seen.get(info.key) >= 12000)) {
        const record = await send({ type: 'skipDiscussion', key: info.key, reason: state.config.autoDiscuss === false ? '已关闭自动讨论，保留未完成标记并跳过' : '未找到可进入的讨论页面，保留未完成标记并跳过' });
        dispositions.set(info.key, record); continue;
      }
      if (info.href) {
        const record = await send({ type: 'openDiscussion', key: info.key, href: info.href });
        dispositions.set(info.key, record);
        if (['skipped', 'submitted'].includes(record.status)) continue;
      }
      return { active: true, status: info.href ? '正在处理教师讨论题，等待发布结果' : '正在识别讨论入口；无法进入时将自动跳过', mode: 'discussion' };
    }
    return null;
  }
  globalThis.ChaoxingDiscussion = Object.freeze({ handle, skippedCount });
})();
