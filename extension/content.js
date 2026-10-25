(() => {
  const A = globalThis.ChaoxingAdapter;
  const displayText = value => globalThis.ChaoxingStatusText?.(value) ?? String(value || '').slice(0, 160);
  const topFrame = window === window.top;
  let working = false, status = '未开始', mode = 'idle', lastAction = 0, currentRoute = A.routeSignature();
  let blockedKey = '', skippedQuizKey = '', navigating = false, quizKey = '', filledOnPage = '';
  let documentSignature = '', documentViewed = false, documentFinish = null;
  let textObservation = null, untrackedTextViewed = false;
  let progress = null, tickActive = false, overlayStatus = '', scheduledTick = null;
  const ownedMedia = new Set();
  const mediaStates = new Map();
  let mediaEpoch = 0, mediaSequence = 0, mediaBusy = false, mediaEnabled = false;
  const send = async message => {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || '扩展后台未响应');
    return reply.value;
  };
  const documentKey = pages => location.href + ':' + pages.length + ':' + (pages[0]?.id || '') + ':' + (pages[0]?.querySelector('img')?.src || '');
  const report = () => {
    const jobs = A.jobs();
    const viewedPages = documentViewed ? A.documentPages() : [];
    const currentDocumentViewed = viewedPages.length > 0 && documentSignature === documentKey(viewedPages);
    return send({ type: 'report', value: { status, mode, busy: working, url: location.href, quizKey, progress,
      taskTitle: A.workTitle(),
      ...(mode === 'skipped' && skippedQuizKey === quizKey ? { skipReason: 'no-valid-answer' } : {}),
      jobTotal: jobs.length, jobDone: jobs.filter(job => job.done).length,
      skippedJobTotal: globalThis.ChaoxingDiscussion?.skippedCount(jobs) || 0,
      trackedJobTotal: A.all('.ans-job-icon').length, ...A.frameState(),
      untrackedDocumentViewed: currentDocumentViewed, documentPageCount: currentDocumentViewed ? viewedPages.length : 0,
      pdfParentVerified: currentDocumentViewed && ['invoked', 'unavailable', 'error'].includes(documentFinish?.status),
      pdfParentUrl: currentDocumentViewed && ['invoked', 'unavailable', 'error'].includes(documentFinish?.status) ? document.referrer : null,
      untrackedTextViewed: untrackedTextViewed && A.textReading()?.key === textObservation?.key,
      ...(topFrame ? { route: A.routeSignature() } : {}) } }).catch(() => {});
  };
  const event = (type, detail) => send({ type: 'event', value: { type, detail } }).catch(() => {});
  const alive = async () => (await send({ type: 'state' })).enabled;
  function requestTick() {
    if (scheduledTick !== null) return;
    scheduledTick = setTimeout(() => { scheduledTick = null; tick(); }, 100);
  }
  const mediaSource = item => item.getAttribute('src') || [...item.querySelectorAll('source')].map(source => source.getAttribute('src') + ':' + source.type).join('|') || item.currentSrc || '';
  const mediaCurrent = entry => entry.active && mediaEnabled && mediaStates.get(entry.item) === entry &&
    entry.epoch === mediaEpoch && entry.route === A.routeSignature() && entry.source === mediaSource(entry.item);
  async function releaseMedia(entry) {
    if (!entry.claimed) return;
    entry.claimed = false;
    await send({ type: 'releaseTask', key: entry.key }).catch(() => {});
  }
  function resetMedia() {
    mediaEpoch++; mediaBusy = false;
    for (const entry of mediaStates.values()) {
      const active = entry.active;
      entry.active = false;
      entry.item.removeEventListener('playing', entry.playing);
      entry.item.removeEventListener('volumechange', entry.volume);
      entry.item.removeEventListener('pause', entry.pause);
      if (active && entry.managed) entry.item.pause();
      releaseMedia(entry);
    }
    ownedMedia.clear();
  }
  function mediaState(item) {
    let entry = mediaStates.get(item);
    if (entry && mediaCurrent(entry)) return entry;
    if (entry) { item.removeEventListener('playing', entry.playing); item.removeEventListener('volumechange', entry.volume); item.removeEventListener('pause', entry.pause); }
    entry = { item, source: mediaSource(item), route: A.routeSignature(), epoch: mediaEpoch, key: `media:${++mediaSequence}`,
      active: true, managed: false, claimed: false, blocked: '', resumed: false, hasPlayed: false, seekAttempted: false, seekFailed: false,
      lastTime: item.currentTime, lastProgressAt: Date.now(), lastRestartAt: 0 };
    entry.playing = () => {
      if (!mediaCurrent(entry)) {
        if (!mediaStates.get(item)?.active) item.pause();
        return;
      }
      if (entry.managed) item.muted = true;
      if (!item.paused && !item.ended) {
        entry.resumed = true; entry.hasPlayed = true;
        if (working || navigating) item.pause();
        if (!mediaBusy) tick();
      }
    };
    entry.volume = () => { if (mediaCurrent(entry) && entry.managed && !item.muted) item.muted = true; };
    entry.pause = () => { if (mediaCurrent(entry) && entry.managed) requestTick(); };
    item.addEventListener('playing', entry.playing); item.addEventListener('volumechange', entry.volume);
    item.addEventListener('pause', entry.pause);
    mediaStates.set(item, entry);
    return entry;
  }
  function seekAudioToEnd(entry, config) {
    const item = entry.item;
    if (item.localName !== 'audio' || config.autoSeekAudio === false || entry.seekAttempted ||
        !Number.isFinite(item.duration) || item.duration <= 0) return;
    entry.seekAttempted = true;
    const target = Math.max(0, item.duration - 0.5);
    try {
      item.currentTime = target;
      entry.seekFailed = Math.abs(item.currentTime - target) > 1;
    } catch { entry.seekFailed = true; }
  }
  async function playMedia(items, config) {
    const pending = items.filter(item => !A.mediaCompleted(item));
    for (const entry of mediaStates.values()) if (entry.active && A.mediaCompleted(entry.item)) {
      entry.active = false;
      entry.item.removeEventListener('playing', entry.playing); entry.item.removeEventListener('volumechange', entry.volume); entry.item.removeEventListener('pause', entry.pause);
      if (entry.managed) entry.item.pause();
      ownedMedia.delete(entry.item); releaseMedia(entry);
    }
    const item = pending.find(media => !media.ended);
    if (!item) {
      for (const entry of mediaStates.values()) await releaseMedia(entry);
      mode = 'complete'; status = pending.length ? '媒体已播放结束，等待平台确认' : '平台已确认媒体任务完成，等待章节状态';
      progress = { kind: 'media', phase: pending.length ? 'awaiting-platform' : 'complete', current: items.filter(media => media.ended || A.mediaCompleted(media)).length, total: items.length };
      await advance(config); return;
    }
    const entry = mediaState(item);
    if (entry.blocked && !entry.resumed) {
      // Metadata may arrive after autoplay was denied. Seeking does not need
      // playback permission, so keep the timeline ready for the user's click.
      seekAudioToEnd(entry, config);
      mode = entry.blocked === 'NotAllowedError' ? 'awaiting-user-playback' : 'blocked';
      status = entry.message + (entry.seekAttempted && !entry.seekFailed ? '；音频已跳到结尾' : '');
      await releaseMedia(entry); return;
    }
    const epoch = mediaEpoch;
    mediaBusy = true;
    try {
      const claim = await send({ type: 'claimTask', key: entry.key });
      if (!mediaCurrent(entry)) { if (claim.ok) { entry.claimed = true; await releaseMedia(entry); } return; }
      if (!claim.ok) { item.pause(); mode = 'queued'; status = '等待前一个任务点完成'; return; }
      entry.claimed = true;
      if (!mediaCurrent(entry) || !(await alive())) { if (!mediaStates.get(item)?.active || mediaStates.get(item) === entry) item.pause(); await releaseMedia(entry); return; }
      entry.blocked = ''; entry.resumed = false;
      entry.managed = true; ownedMedia.add(item); item.muted = true;
      for (const other of ownedMedia) if (other !== item) other.pause();
      mode = 'media';
      try {
        if (item.error) {
          const error = new Error('媒体加载失败');
          error.name = item.error.code === 4 ? 'NotSupportedError' : item.error.code === 1 ? 'AbortError' : 'MediaError';
          throw error;
        }
        seekAudioToEnd(entry, config);
        const now = Date.now();
        if (Math.abs(item.currentTime - entry.lastTime) > 0.25) {
          entry.lastTime = item.currentTime; entry.lastProgressAt = now;
        }
        const stalled = entry.hasPlayed && !item.paused && !item.ended && item.readyState >= 3 &&
          now - entry.lastProgressAt >= 30000;
        if (stalled && now - entry.lastRestartAt >= 60000) {
          entry.lastRestartAt = now;
          item.pause();
        }
        if (item.paused) await item.play();
        if (!mediaCurrent(entry) || !(await alive())) { if (!mediaStates.get(item)?.active || mediaStates.get(item) === entry) item.pause(); await releaseMedia(entry); return; }
        item.muted = true;
        status = stalled ? '播放进度停滞，已尝试恢复，等待进度更新' :
          `${entry.seekFailed ? '音频跳转失败，' : entry.seekAttempted ? '音频已跳到结尾，' : ''}静音正常播放中 ${Math.floor(item.currentTime)} / ${Number.isFinite(item.duration) ? Math.floor(item.duration) : '?'} 秒`;
        progress = { kind: 'media', phase: 'playing', current: Math.floor(item.currentTime), total: Number.isFinite(item.duration) ? Math.floor(item.duration) : null };
      } catch (error) {
        if (!mediaCurrent(entry)) return;
        entry.blocked = error.name || 'MediaError'; entry.resumed = false;
        entry.message = error.name === 'NotAllowedError' ? '浏览器限制自动播放，请点击一次播放按钮' :
          error.name === 'AbortError' ? '媒体播放已中断，请在播放器中恢复播放' :
          error.name === 'NotSupportedError' ? '媒体格式不受支持，请检查资源或播放器' : `媒体播放失败：${error.message || error.name}`;
        mode = error.name === 'NotAllowedError' ? 'awaiting-user-playback' : 'blocked';
        status = entry.message + (entry.seekAttempted && !entry.seekFailed ? '；音频已跳到结尾' : '');
        await releaseMedia(entry);
      }
    } finally { if (epoch === mediaEpoch) mediaBusy = false; }
  }
  async function fingerprint(parsed) {
    const url = new URL(location.href);
    for (const name of [...url.searchParams.keys()]) if (/^(t|_t|timestamp|ut|cpi|enc|mooc2)$/i.test(name)) url.searchParams.delete(name);
    const bytes = new TextEncoder().encode(url.href + JSON.stringify(parsed.map(q => q.data)));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function remember(key, value) { await chrome.storage.local.set({ [`quiz:${key}`]: { ...value, at: Date.now() } }); }
  async function quiz(parsed, config) {
    mode = 'quiz';
    const videoQuiz = parsed.some(q => q.node.classList.contains('ans-videoquiz'));
    const key = await fingerprint(parsed);
    quizKey = key;
    let old = (await chrome.storage.local.get(`quiz:${key}`))[`quiz:${key}`];
    const context = A.courseContext();
    const effectiveContext = (source, settings) => ({ ...source, programmingLanguage: settings.programmingLanguage && settings.programmingLanguage !== 'auto' ? settings.programmingLanguage : source.programmingLanguage });
    const answerContext = effectiveContext(context, config);
    const sameContext = (source, expected = answerContext) => ['courseTitle', 'chapterTitle', 'programmingLanguage'].every(name => source?.[name] === expected[name]);
    let recoveryCount = old?.recoveryCount || 0;
    const finishIfPlatformComplete = async () => {
      const marker = A.platformWorkCompleted() || A.platformWorkCompleted(await send({ type: 'reports' }));
      const receipt = !marker && A.submissionSuccess();
      if (!marker && !receipt) return false;
      status = marker ? '平台任务点已完成，跳过解题并继续' : '平台已确认提交成功'; mode = 'complete';
      progress = { kind: 'quiz', phase: marker ? 'platform-complete' : 'submitted',
        current: parsed.length, total: parsed.length, filled: parsed.length };
      if (receipt) await remember(key, { stage: 'submitted' });
      return true;
    };
    if (await finishIfPlatformComplete()) return;
    if (blockedKey === key) {
      if (skippedQuizKey === key) { mode = 'skipped'; status = '本题无法给出有效答案，已跳过；平台仍记为未完成'; }
      return;
    }
    if (old?.stage === 'submitted') { status = '该任务已有提交记录，等待平台完成标记'; mode = 'awaiting-completion'; return; }
    if (old?.stage === 'submitting' || old?.stage === 'uncertain') {
      // A fresh platform page explicitly saying "待完成" can disprove an old
      // submission intent. Allow one recovery only after a generous grace
      // period; never infer failure from a stale page or missing marker.
      const answers = old.answers;
      const low = Array.isArray(answers) && answers.filter(answer => answer.confidence < config.confidence);
      const reusable = Array.isArray(answers) && answers.length === parsed.length &&
        answers.every(answer => Number.isFinite(answer.confidence) && answer.confidence > 0 &&
          parsed.some(question => question.data.id === answer.id)) && sameContext(old.context) &&
        (!low.length || (old.review?.attempted === true && old.review.threshold === config.confidence &&
          Array.isArray(old.review.outcomes) && low.every(answer => old.review.outcomes.some(item => item.id === answer.id))));
      const freshPending = Number.isFinite(old.at) && performance.timeOrigin > old.at + 1000 &&
        Date.now() - old.at >= 120000 && A.platformWorkPending();
      if (!freshPending || !reusable || recoveryCount >= 1) {
        status = '上次提交结果尚未确认，请检查平台；不会重复提交'; mode = 'blocked'; return;
      }
      recoveryCount = 1;
      old = { ...old, stage: 'filled', recoveryCount };
      await remember(key, old);
      status = '平台刷新后仍显示待完成，自动重试提交一次'; await report();
    }
    const blockedQuestion = parsed.find(q => !q.data.text || q.data.type === 'unsupported' || q.hasImages || q.hasEncodedFont);
    if (blockedQuestion) {
      const reason = !blockedQuestion.data.text ? '题干为空' : blockedQuestion.hasImages ? '包含图片' :
        blockedQuestion.hasEncodedFont ? '特殊字体未完整解码' : '题型或答题控件未适配';
      status = `第 ${blockedQuestion.data.id} 题${reason}，请人工处理后继续`; mode = 'blocked'; return;
    }
    const reusable = old?.stage === 'filled' && Array.isArray(old.answers) &&
      (old.answers.every(answer => answer.confidence >= config.confidence) ||
        (old.review?.attempted === true && old.review.threshold === config.confidence)) &&
      sameContext(old.context);
    const fillIdentity = key + ':' + JSON.stringify(answerContext);
    if (reusable && !config.autoSubmit && filledOnPage === fillIdentity) { status = '答案已填写，等待手动提交'; return; }
    const claim = await send({ type: 'claimTask', key });
    if (!claim.ok) { status = '另一任务点正在答题，等待完成'; return; }
    working = true;
    try {
      progress = { kind: 'quiz', phase: 'solving', current: 0, total: parsed.length, filled: 0 };
      status = `正在获取 ${parsed.length} 道练习答案，等待题库查询和 AI 解答结果`; await report();
      const result = reusable ? { answers: old.answers, sources: old.sources, review: old.review } :
        await send({ type: 'solve', key, context, questions: parsed.map(q => q.data) });
      if (await finishIfPlatformComplete()) return;
      const solutionContext = result.context || answerContext;
      const currentSettings = async () => {
        const state = await send({ type: 'state' });
        if (!state.enabled) return null;
        if (!sameContext(effectiveContext(A.courseContext(), state.config), solutionContext)) {
          status = '解题期间课程或语言设置已变化，等待重新解答'; mode = 'quiz'; return null;
        }
        return state.config;
      };
      const latestConfig = await currentSettings();
      if (!latestConfig) return;
      if (!Array.isArray(result.answers) || result.answers.length !== parsed.length ||
          result.answers.some(a => !Number.isFinite(a.confidence) || a.confidence <= 0)) {
        status = '本题无法给出有效答案，已跳过；平台仍记为未完成'; mode = 'skipped';
        skippedQuizKey = key; blockedKey = key;
        progress = { kind: 'quiz', phase: 'skipped', current: 0, total: parsed.length, filled: 0 };
        await event('blocked', status); return;
      }
      const lowAnswers = result.answers.filter(answer => answer.confidence < latestConfig.confidence);
      if (lowAnswers.length) {
        const outcomes = result.review?.outcomes;
        if (result.review?.attempted !== true || result.review.threshold !== latestConfig.confidence ||
            !Array.isArray(outcomes) || lowAnswers.some(answer => !outcomes.some(item => item.id === answer.id))) {
          status = '低置信度答案尚未完成复核，已暂停提交'; mode = 'blocked'; blockedKey = key; await event('blocked', status); return;
        }
        status = `已复核，仍有 ${lowAnswers.length} 道低置信度题，继续填写并提交`; await report();
      }
      // Preflight the whole batch before mutating any question. Then expose
      // each verified DOM update immediately, without claiming submission.
      A.validateAnswers(parsed, result.answers);
      for (const [index, question] of parsed.entries()) {
        if (!(await currentSettings()) || !question.node.isConnected) return;
        const source = result.sources?.find(item => item.id === question.data.id);
        const reviewed = result.review?.outcomes?.find(item => item.id === question.data.id);
        const sourceLabel = reviewed?.status === 'confirmed' ? 'AI 二次核对通过' : reviewed ?
          'AI 二次核对未确认，低置信度' : source?.source === 'conflict' ? '题库与 AI 答案有冲突' :
          source?.provider === 'daxuesoutijiang' ? '大学搜题酱（AI 已核对）' :
            source?.source === 'question_bank' ? '本地或自有题库' : 'AI 答案';
        progress = { kind: 'quiz', phase: 'filling', current: index + 1, total: parsed.length, questionId: question.data.id, filled: index, source: sourceLabel };
        status = `正在填写第 ${index + 1}/${parsed.length} 题`; await report();
        A.applyAnswers([question], result.answers);
        let badge = question.node.querySelector('[data-cx-agent-answer-progress]');
        if (!badge) {
          badge = document.createElement('div'); badge.setAttribute('data-cx-agent-answer-progress', ''); badge.setAttribute('role', 'status');
          badge.style.cssText = 'font:12px/1.6 system-ui;color:#17603a;padding:5px 8px;margin:6px 0;background:#edf8f0;border-radius:4px';
          question.node.append(badge);
        }
        badge.textContent = `Agent：第 ${index + 1}/${parsed.length} 题已填写并校验，等待提交确认 · ${sourceLabel}`;
        progress = { ...progress, phase: 'verified', filled: index + 1 };
        status = `已填写并校验 ${index + 1}/${parsed.length} 题`; await report();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      A.verifyAnswers(parsed, result.answers);
      filledOnPage = key + ':' + JSON.stringify(solutionContext);
      await remember(key, { stage: 'filled', answers: result.answers, context: solutionContext, recoveryCount,
        ...(result.sources ? { sources: result.sources } : {}), ...(result.review ? { review: result.review } : {}) });
      if (!latestConfig.autoSubmit) { status = '答案已填写，等待手动提交'; return; }
      const submit = A.submitButton();
      if (!submit) throw new Error('未找到可用的提交按钮');
      const submitConfig = await currentSettings();
      if (!submitConfig) return;
      if (!submitConfig.autoSubmit) { status = '答案已填写，等待手动提交'; return; }
      if (await finishIfPlatformComplete()) return;
      A.prepareClick(submit);
      // Persist intent before clicking, so reloads cannot submit twice.
      await remember(key, { stage: 'submitting', answers: result.answers, context: solutionContext, recoveryCount });
      A.safeClick(submit);
      mode = 'submitting';
      progress = { ...progress, phase: 'submitting' };
      status = '已点击提交，正在确认平台结果';
      await report();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (!(await alive())) return;
        if (A.submissionSuccess()) {
          await remember(key, { stage: 'submitted' }); status = '平台已确认提交成功'; mode = 'complete';
          progress = { ...progress, phase: 'submitted' };
          for (const badge of A.all('[data-cx-agent-answer-progress]')) badge.textContent = 'Agent：本任务已由平台确认提交';
          await event('submitted', key); return;
        }
        if (videoQuiz) {
          if (A.first(['#spanNotBackPoint', '#spanNot'])) throw new Error('视频题答案未通过，请人工检查');
          if (!parsed.some(q => A.visible(q.node))) {
            await remember(key, { stage: 'submitted' }); status = '视频题已提交，继续播放'; mode = 'complete';
            await event('submitted', key); return;
          }
          const next = A.first(['#videoquiz-continue']);
          if (next) { A.safeClick(next); continue; }
        }
        A.confirmSubmit(key);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await remember(key, { stage: 'uncertain', answers: result.answers, context: solutionContext, recoveryCount });
      throw new Error('提交结果未确认，已停止重复提交，请检查平台');
    } catch (error) {
      blockedKey = key; status = error.message; mode = 'blocked'; await event('blocked', status);
    } finally {
      working = false;
      await send({ type: 'releaseTask', key }).catch(() => {});
    }
  }
  async function advance(config, locallyConfirmed = false) {
    if (!topFrame) return;
    const frames = await send({ type: 'reports' });
    const children = frames.filter(f => f.frameId !== 0);
    const chapter = A.chapterReadiness(children);
    const markersComplete = chapter.ready && chapter.cards?.jobTotal > 0 &&
      chapter.cards.jobDone === chapter.cards.jobTotal && chapter.cards.trackedJobTotal === chapter.cards.jobTotal;
    const noTaskChapter = chapter.ready && chapter.cards?.noTaskContent === true &&
      chapter.cards.jobTotal === 0 && chapter.cards.trackedJobTotal === 0 &&
      chapter.cards.workFrameCount === 0;
    // A submission can time out while the site's confirmation modal remains
    // open. Finish that existing click, but never start a second submission.
    const pendingConfirmation = !markersComplete && !noTaskChapter && children.find(frame =>
      frame.mode === 'submitting' || (frame.mode === 'blocked' &&
        /提交结果未确认|上次提交结果尚未确认/.test(frame.status || '') && /^[a-f0-9]{64}$/.test(frame.quizKey || '')));
    if (config.autoSubmit && pendingConfirmation) A.confirmSubmit(pendingConfirmation.quizKey || '');
    // A blocked sibling must not hide another task's live confirmation dialog.
    // A platform-complete chapter can outlive an older blocked child report.
    // A full set of completed markers in the currently loaded cards document
    // is authoritative. Old child-frame activity and duplicate nested job
    // counts must not keep the chapter on its previous task.
    const active = markersComplete || noTaskChapter ? null : children.find(f => f.mode === 'submitting') ||
      children.find(f => f.busy && f.mode !== 'blocked' && f.mode !== 'skipped') ||
      children.find(f => ['quiz', 'media', 'document', 'text', 'discussion'].includes(f.mode)) ||
      children.find(f => f.mode === 'awaiting-user-playback') ||
      children.find(f => f.mode === 'blocked');
    if (active) {
      status = active.status; return;
    }
    if (Date.now() - lastAction < 7000) return;
    const icons = A.jobs();
    const jobTotal = icons.length + children.reduce((sum, f) => sum + (f.jobTotal || 0), 0);
    const jobDone = icons.filter(i => i.done).length + children.reduce((sum, f) => sum + (f.jobDone || 0), 0);
    const skippedJobs = (globalThis.ChaoxingDiscussion?.skippedCount(icons) || 0) +
      children.reduce((sum, f) => sum + (f.skippedJobTotal || 0), 0) + (chapter.skippedWorkJobTotal || 0);
    const pendingJobs = jobDone + skippedJobs < jobTotal;
    const complete = markersComplete || chapter.ready && !pendingJobs && (A.completion(config.completeSelector) ||
      (jobTotal > 0 && jobTotal === jobDone + skippedJobs) || (jobTotal === 0 && chapter.skippedWorkCount > 0));
    const currentCardComplete = chapter.ready && chapter.cards?.jobTotal > 0 &&
      chapter.cards.jobDone + (chapter.cards.skippedJobTotal || 0) + (chapter.skippedWorkJobTotal || 0) === chapter.cards.jobTotal;
    const hasTrackedJobs = A.all('.ans-job-icon').length > 0 || children.some(f => f.trackedJobTotal > 0);
    const viewedText = chapter.ready && !hasTrackedJobs && jobTotal === 0 && (untrackedTextViewed || children.some(f => f.untrackedTextViewed));
    const viewedDocument = chapter.ready && !hasTrackedJobs && jobTotal === 0 && chapter.untrackedDocumentComplete;
    if (complete || currentCardComplete || locallyConfirmed || viewedText || viewedDocument || noTaskChapter) {
      // A locally confirmed task may advance within the card strip; chapter
      // changes still require every platform job marker to be complete.
      const next = A.nextCard() || (complete || viewedText || viewedDocument || noTaskChapter ? A.nextAction(config.nextSelector) : null);
      if (!next) { status = complete ? '当前任务已完成，未发现下一任务入口；请检查是否为课程末尾' : '当前任务已完成，等待章节完成标记'; return; }
      if (!(await alive())) return;
      A.prepareClick(next);
      const before = A.routeSignature(), card = A.text(A.currentCard());
      status = chapter.skippedWorkCount ? '无法作答的练习已跳过，平台未完成标记保留；正在进入下一任务' :
        skippedJobs ? '讨论已处理或跳过，平台未完成标记保留；正在进入下一任务' :
          noTaskChapter ? '当前章节没有任务点，正在进入下一节' : '任务已完成，正在进入下一任务'; lastAction = Date.now();
      await event('next', A.text(next)); A.safeClick(next); navigating = true;
      try {
        let deadline = Date.now() + 12000, confirmed = false;
        while (Date.now() < deadline) {
          if (!(await alive())) return;
          if (A.routeSignature() !== before || A.text(A.currentCard()) !== card) return;
          const confirmation = A.nextChapterConfirmation();
          if (confirmation && !confirmed) {
            const currentFrames = (await send({ type: 'reports' })).filter(frame => frame.frameId !== 0);
            const currentJobs = A.jobs();
            const total = currentJobs.length + currentFrames.reduce((sum, frame) => sum + (frame.jobTotal || 0), 0);
            const done = currentJobs.filter(job => job.done).length + currentFrames.reduce((sum, frame) => sum + (frame.jobDone || 0), 0);
            const currentChapter = A.chapterReadiness(currentFrames);
            const ignored = (globalThis.ChaoxingDiscussion?.skippedCount(currentJobs) || 0) +
              currentFrames.reduce((sum, frame) => sum + (frame.skippedJobTotal || 0), 0) + (currentChapter.skippedWorkJobTotal || 0);
            const platformDone = currentChapter.ready && currentChapter.cards?.jobTotal > 0 &&
              currentChapter.cards.jobDone === currentChapter.cards.jobTotal && currentChapter.cards.trackedJobTotal === currentChapter.cards.jobTotal;
            const busyFrame = currentFrames.some(frame => frame.busy ||
              ['quiz','submitting','media','document','discussion','awaiting-user-playback'].includes(frame.mode) ||
              (frame.mode === 'blocked' && !platformDone));
            if ((!ignored && !currentChapter.skippedWorkCount) || done + ignored !== total || busyFrame || !currentChapter.ready) {
              status = '平台提示仍有未完成任务，当前条件不允许自动跳过，请检查任务状态'; mode = 'blocked'; blockedKey = 'navigation'; return;
            }
            if (!(await alive()) || A.routeSignature() !== before) return;
            status = '正在确认进入下一节；已跳过的任务仍保留未完成标记'; await report();
            A.safeClick(confirmation); confirmed = true; deadline = Date.now() + 12000;
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        blockedKey = 'navigation'; status = confirmed ? '已确认下一节但页面未切换，请检查网站响应' : '下一任务点击后页面未变化，请手动选择章节'; mode = 'blocked';
      } finally { navigating = false; }
    } else {
      status = !chapter.ready ? chapter.reason : jobTotal ? `等待平台任务完成标记（${jobDone}/${jobTotal}）` :
        chapter.cards?.documentOnly ? '文档预览尚未确认浏览完成；等待阅读器加载或检查网络' :
          '未识别到任务完成标记；请在章节内容页运行或配置选择器';
    }
  }
  async function readText(reading, config) {
    if (textObservation?.key !== reading.key) {
      textObservation = { key: reading.key, stableSince: Date.now() }; untrackedTextViewed = false;
    }
    if (untrackedTextViewed) { mode = 'complete'; status = '无任务点的文字章节已浏览'; await advance(config); return; }
    mode = 'text'; status = '文字章节已加载，正在确认内容稳定且没有嵌入任务';
    if (Date.now() - textObservation.stableSince < 6000) return;
    const claim = await send({ type: 'claimTask', key: 'text' });
    if (!claim.ok) { mode = 'queued'; status = '等待前一个任务点完成'; return; }
    working = true;
    try {
      const bounds = reading.root.getBoundingClientRect();
      const start = Math.max(0, bounds.top + window.scrollY);
      const end = Math.max(start, bounds.bottom + window.scrollY - window.innerHeight);
      const step = Math.max(200, window.innerHeight * 0.8), positions = [];
      for (let position = start; position < end; position += step) positions.push(position);
      positions.push(end);
      const dwell = Math.max(2000, Math.ceil(8000 / positions.length));
      for (let index = 0; index < positions.length; index++) {
        if (!(await alive()) || A.textReading()?.key !== reading.key) return;
        mode = 'text'; status = `正在浏览无任务点的文字章节 ${index + 1}/${positions.length}`;
        window.scrollTo({ top: positions[index], behavior: 'instant' });
        const until = Date.now() + dwell;
        while (Date.now() < until) {
          if (!(await alive()) || A.textReading()?.key !== reading.key) return;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      if (!(await alive()) || A.textReading()?.key !== reading.key) return;
      untrackedTextViewed = true; mode = 'complete'; status = '无任务点的文字章节已浏览';
    } finally { working = false; await send({ type: 'releaseTask', key: 'text' }).catch(() => {}); }
    if (untrackedTextViewed) await advance(config);
  }
  function panel() {
    if (!topFrame || document.getElementById('cx-agent-panel')) return;
    const host = document.createElement('div'); host.id = 'cx-agent-panel';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.style.cssText = 'font:13px/1.6 system-ui;background:#102a43;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 3px 16px #0004;max-width:350px;white-space:pre-wrap';
    shadow.append(box); document.documentElement.append(host);
    setInterval(() => { const next = '学习通本地 Agent\n' + displayText(overlayStatus || status); if (box.textContent !== next) box.textContent = next; }, 300);
  }
  async function tick() {
    let entered = false;
    try {
      const state = await send({ type: 'state' });
      overlayStatus = topFrame && state.enabled ? state.last || '' : '';
      if (!state.enabled) {
        mediaEnabled = false; resetMedia();
        status = '已停止；在扩展弹窗开始托管'; mode = 'idle'; blockedKey = ''; skippedQuizKey = ''; navigating = false;
        textObservation = null; untrackedTextViewed = false; progress = null; return;
      }
      mediaEnabled = true;
      if (A.routeSignature() !== currentRoute) { resetMedia(); currentRoute = A.routeSignature(); blockedKey = ''; skippedQuizKey = ''; quizKey = ''; lastAction = Date.now(); navigating = false; textObservation = null; untrackedTextViewed = false; progress = null; }
      if ([...mediaStates.values()].some(entry => entry.active && (entry.source !== mediaSource(entry.item) || !entry.item.isConnected))) resetMedia();
      if (tickActive || working || navigating || mediaBusy) return;
      tickActive = true; entered = true;
      if (A.gate()) { status = '页面需要登录或验证，请在浏览器处理'; mode = 'blocked'; return; }
      // The platform can keep rendering old questions after marking their task
      // complete. Check the exact work attachment before parsing or solving.
      if (A.isWorkPage() && (A.platformWorkCompleted() ||
          A.platformWorkCompleted(await send({ type: 'reports' })))) {
        status = '平台任务点已完成，跳过解题并继续'; mode = 'complete'; progress = null; quizKey = '';
        return;
      }
      const discussion = await globalThis.ChaoxingDiscussion?.handle({ send, state, alive,
        onProgress: async message => { mode = 'discussion'; status = message; progress = { kind: 'discussion', current: 0, total: 1 }; await report(); } });
      if (discussion?.active) { mode = discussion.mode; status = discussion.status; return; }
      const reading = A.textReading();
      if (!reading) { textObservation = null; untrackedTextViewed = false; }
      const parsed = A.parseQuestions();
      if (parsed.length) {
        await quiz(parsed, state.config);
        if (mode === 'complete' || mode === 'awaiting-completion') await advance(state.config, mode === 'complete');
        return;
      }
      quizKey = '';
      const media = A.mediaElements();
      if (media.length) {
        await playMedia(media, state.config); return;
      }
      if ([...mediaStates.values()].some(entry => entry.active)) resetMedia();
      const pages = A.documentPages();
      if (pages.length) {
        const signature = documentKey(pages);
        if (signature !== documentSignature) { documentSignature = signature; documentViewed = false; documentFinish = null; }
        if (!documentViewed) {
          const claim = await send({ type: 'claimTask', key: 'document' });
          if (!claim.ok) { status = '等待前一个任务点完成'; mode = 'queued'; return; }
          working = true; mode = 'document';
          try {
            const fast = state.config.documentMode !== 'paced';
            const route = A.routeSignature();
            const indices = fast ? [pages.length - 1] : pages.map((_, index) => index);
            for (const index of indices) {
              if (!(await alive())) return;
              progress = { kind: 'document', phase: 'scrolling', current: index + 1, total: pages.length };
              status = fast ? `已滚到文档末尾（${pages.length} 页），等待页面稳定` : `正在浏览文档 ${index + 1}/${pages.length} 页`;
              pages[index].scrollIntoView({ behavior: 'instant', block: fast ? 'end' : 'start' });
              await report();
              const until = Date.now() + (fast ? 600 : 8000);
              while (Date.now() < until) { if (!(await alive()) || A.routeSignature() !== route || !pages[index].isConnected) return; await new Promise(resolve => setTimeout(resolve, 200)); }
            }
            status = '正在滚动阅读器到底部并确认页面布局';
            progress = { kind: 'document', phase: 'settling-bottom', current: pages.length, total: pages.length };
            await report();
            if (!globalThis.ChaoxingDocumentScroller) throw new Error('文档滚动组件未加载，请重新加载扩展并刷新课程页');
            const bottom = await globalThis.ChaoxingDocumentScroller.settleBottom(pages[pages.length - 1], {
              active: async () => await alive() && A.routeSignature() === route &&
                A.documentPages().length === pages.length && pages.every(page => page.isConnected)
            });
            if (bottom.status !== 'bottom') {
              status = bottom.status === 'unstable' ? '文档底部布局仍在变化，等待稳定后继续' : '文档浏览已取消';
              return;
            }
            const currentPages = A.documentPages();
            if (!(await alive()) || currentPages.length !== pages.length || currentPages.some((page, index) => page !== pages[index])) return;
            documentViewed = true;
            documentFinish = globalThis.ChaoxingDocumentBridge ?
              await globalThis.ChaoxingDocumentBridge.finishViewedDocument(signature) : { status: 'not-supported' };
          } finally { working = false; await send({ type: 'releaseTask', key: 'document' }).catch(() => {}); }
        }
        mode = 'complete'; progress = { kind: 'document', phase: 'awaiting-platform', current: pages.length, total: pages.length };
        status = documentFinish?.status === 'invoked' ?
          '文档已浏览，已调用站点完成回调，等待平台完成标记' :
          '文档已浏览；站点完成回调不可用，等待平台或人工处理';
        await advance(state.config); return;
      }
      if (reading) { await readText(reading, state.config); return; }
      mode = 'page';
      if (!topFrame) { status = '等待任务点状态'; return; }
      await advance(state.config);
    } catch (error) { status = error.message; mode = 'blocked'; }
    finally { if (entered) tickActive = false; await report(); }
  }
  panel(); lastAction = Date.now();
  // Heartbeats remain active while a long agent request is in progress.
  setInterval(report, 2500);
  setInterval(() => { if (blockedKey !== 'navigation') tick(); }, 3000);
  chrome.runtime.onMessage?.addListener(message => {
    if (message.type === 'controlChanged') { blockedKey = ''; requestTick(); }
    if (message.type === 'heartbeat') void tick();
  });
  document.addEventListener('ended', requestTick, true);
  document.addEventListener('loadedmetadata', requestTick, true);
  document.addEventListener('visibilitychange', requestTick);
  // Completion classes and iframe/card changes are observable without a click
  // or popup reopening. Coalesce mutations and ignore our own status badges.
  new MutationObserver(changes => {
    if (changes.some(change => change.type === 'attributes' &&
      (change.target.matches('.ans-attach-ct,.ans-job-icon,iframe') || change.target.closest('.ans-tabs,.tabtags,#tab_ul')))) requestTick();
  }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'src'] });
  tick();
})();
