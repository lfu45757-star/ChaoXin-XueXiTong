/* DOM adapters; no private API calls and no progress fabrication. */
(() => {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = node => !!node && !!(node.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
  const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const first = (selectors, parent = document) => {
    for (const selector of selectors) { const node = all(selector, parent).find(visible); if (node) return node; }
    return null;
  };
  function prepareClick(target) {
    if (target?.nodeType !== 1 || typeof target.dispatchEvent !== 'function') throw new Error('未找到可用的点击目标');
    if (target.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,[inert]')) throw new Error('点击目标已禁用');
    const attributes = [];
    for (let node = target; node; node = node.parentElement) {
      if (node.localName !== 'a') continue;
      for (const attr of [...node.attributes]) {
        if (attr.localName !== 'href' || (attr.namespaceURI && attr.namespaceURI !== 'http://www.w3.org/1999/xlink')) continue;
        let url;
        try { url = new URL(attr.value, node.ownerDocument.baseURI); } catch { continue; }
        if (url.protocol !== 'javascript:') continue;
        // Only an empty JavaScript URL or the literal void(0) placeholder is
        // inert. Never evaluate or silently discard a URL that performs work.
        if (!/^\s*(?:;\s*)*(?:void\s*\(\s*0\s*\)\s*(?:;\s*)*)?$/.test(url.href.slice(url.protocol.length)))
          throw new Error('发现非空 JavaScript 链接，已停止点击，请人工处理');
        attributes.push({ node, namespace: attr.namespaceURI, name: attr.name, localName: attr.localName, value: attr.value });
      }
    }
    return { target, attributes };
  }
  function safeClick(target) {
    // Recheck immediately before dispatch, even when a caller preflighted a
    // batch before changing answers or persisting submission intent.
    const plan = prepareClick(target);
    try {
      for (const attr of plan.attributes) attr.node.removeAttributeNS(attr.namespace, attr.localName);
      if (typeof target.click === 'function') target.click();
      else {
        const view = target.ownerDocument.defaultView;
        target.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view }));
      }
    } finally {
      for (const attr of plan.attributes) if (!attr.node.hasAttributeNS(attr.namespace, attr.localName))
        attr.node.setAttributeNS(attr.namespace, attr.name, attr.value);
    }
  }
  function courseContext() {
    const documents = [document];
    // Read only ancestors that the browser already permits this frame to read.
    let ancestor = window;
    while (ancestor !== ancestor.top) {
      try {
        ancestor = ancestor.parent;
        const doc = ancestor.document;
        if (!documents.includes(doc)) documents.push(doc);
      } catch { break; }
    }
    try { if (!documents.includes(window.top.document)) documents.push(window.top.document); } catch {}
    const visibleTitle = node => {
      if (!visible(node)) return false;
      let view = node.ownerDocument.defaultView;
      while (view && view !== view.top) {
        let frame;
        try { frame = view.frameElement; } catch { break; }
        if (!frame) break;
        if (!visible(frame)) return false;
        view = frame.ownerDocument.defaultView;
      }
      return true;
    };
    const findTitle = selectors => {
      for (const selector of selectors) for (const doc of documents) {
        for (const node of doc.querySelectorAll(selector)) {
          if (!visibleTitle(node)) continue;
          const title = (node.getAttribute('title') || text(node.querySelector('h1,h2,h3') || node)).replace(/\s+/g, ' ').trim();
          if (title && title.length <= 300) return title;
        }
      }
      return '';
    };
    const courseTitle = findTitle(['#courseName', '.courseName', '.course-name', '.course_name', '#courseTitle', '.courseTitle', '.course-title', '.course_title']);
    const chapterTitle = findTitle(['.prev_title', '#chapterTitle', '.chapterTitle', '.chapter-title', '.chapter_name', '.chapterName', '.knowledgeTitle', '.knowledge-title',
      '.posCatalog_active .posCatalog_name', '.posCatalog_select .posCatalog_name', '.ceyan_name h3']);
    const titles = courseTitle + '\n' + chapterTitle;
    const languages = [];
    if (/\bPython(?:\s*\d+(?:\.\d+)*)?\b/i.test(titles)) languages.push('Python');
    if (/\bC\s*\+\s*\+/i.test(titles)) languages.push('C++');
    if (/\bJavaScript\b|\bECMAScript\b/i.test(titles)) languages.push('JavaScript');
    if (/\bJava\b/i.test(titles)) languages.push('Java');
    if (/(?:^|[^A-Za-z0-9_])C\s*(?:语言|程序|编程|language\b|programming\b)|\bprogramming\s+in\s+C\b(?!\s*\+)|^C$/im.test(titles)) languages.push('C');
    return { courseTitle, chapterTitle, programmingLanguage: languages.length === 1 ? languages[0] : 'auto' };
  }
  function questionText(root) {
    let value = '', unresolved = false;
    const newline = () => { if (value && !value.endsWith('\n')) value += '\n'; };
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const decoded = globalThis.ChaoxingFontDecoder?.read(node);
        value += (decoded?.text ?? node.nodeValue ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
        unresolved ||= decoded?.unresolved ?? (!!node.parentElement?.closest('.font-cxsecret') && /\p{Unified_Ideograph}/u.test(node.nodeValue || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const style = getComputedStyle(node);
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA'].includes(node.tagName) || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return;
      if (node.tagName === 'BR') { value += '\n'; return; }
      const block = ['block', 'list-item', 'table-row', 'flex', 'grid', 'flow-root'].includes(style.display);
      if (block) newline();
      for (const child of node.childNodes) walk(child);
      if (block) newline();
    };
    if (root) walk(root);
    return { text: value.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ''), unresolved };
  }
  const roots = () => {
    for (const selector of ['.singleQuesId', '.TiMu', '.questionLi', '.question-item', '.mark_item', '.queBox', '.ans-videoquiz']) {
      const nodes = all(selector).filter(visible);
      if (nodes.length) return nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
    }
    return [];
  };
  function fieldsOf(node) {
    // Standalone mooc2 work uses a hidden textarea plus a UEditor iframe.
    if (node.matches('.questionLi[typename="填空题"],.questionLi[typename="简答题"]')) {
      const editors = node.getAttribute('typename') === '填空题' ? all('.Answer .textDIV', node) : all('.eidtDiv', node);
      const fields = [], mirrors = [];
      for (const editor of editors) {
        let body = null;
        try { body = editor.querySelector('iframe')?.contentDocument?.body; } catch {}
        if (!body || !visible(editor)) continue;
        fields.push(body); mirrors.push(all('textarea', editor));
      }
      if (fields.length) return { fields, mirrors };
    }
    const slots = all('.blankItemDiv', node);
    const editors = slots.length ? slots : all('.Zy_ulTk li', node);
    if (editors.length) {
      const fields = [], mirrors = [];
      for (const editor of editors) {
        let body = null;
        try { body = editor.querySelector('iframe')?.contentDocument?.body; } catch {}
        const candidates = [editor.querySelector('textarea'), editor.querySelector('.InpDIV'), body].filter(Boolean);
        if (!candidates.length) continue;
        fields.push(candidates[0]); mirrors.push(candidates.slice(1));
      }
      if (fields.length) return { fields, mirrors };
    }
    const fields = all('textarea, input[type="text"], [contenteditable="true"]', node).filter(visible);
    return { fields: fields.filter(field => !fields.some(other => other !== field && other.contains(field))), mirrors: [] };
  }
  function parseQuestions() {
    globalThis.ChaoxingFontDecoder?.prepare(document);
    return roots().map((node, index) => {
      const title = first(['.Zy_TItle', '.mark_name', '.question-title', '.stem', '.qtContent', '.tkTopic', '.title'], node);
      const titleText = questionText(title);
      const stem = titleText.text;
      const controls = all('input[type="radio"],input[type="checkbox"]', node);
      let options = controls.map((input, i) => {
        const label = input.closest('label,li,.option,.answerBg') || (input.id ? node.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) || input.parentElement;
        const labelText = questionText(label).text;
        const key = labelText.match(/^\s*([A-Z])[.、．\s]/)?.[1] || String.fromCharCode(65 + i);
        return { key, text: labelText, control: input, target: label };
      });
      if (!controls.length) {
        let candidates = all('.before-after, .before-after-checkbox, .ans-videoquiz-opt', node).filter(visible);
        if (!candidates.length) candidates = all('.Zy_ulTop li, .answerList li, .answerBg', node).filter(visible);
        options = candidates.map((target, i) => ({
          key: target.querySelector('.num_option,.num_option_dx')?.textContent?.trim() || questionText(target).text.match(/^\s*([A-Z])[.、．\s]/)?.[1] || String.fromCharCode(65 + i),
          text: target.matches('.answerBg') ? questionText(target.querySelector('.answer_p')).text : questionText(target).text,
          control: target.querySelector('[name^="answer"]'), target
        }));
      }
      const { fields, mirrors } = fieldsOf(node);
      const typeCode = node.querySelector('input[id^="answertype"],input[name^="type"]')?.value || node.querySelector('.TiMu[data]')?.getAttribute('data');
      const typeLabel = title?.querySelector('.newZy_TItle')?.textContent || stem.match(/^\s*(?:\d+\s*)?【\s*[^】]+题\s*】/)?.[0] || '';
      const workType = node.matches('.questionLi[typename]') ? ({ '多选题': 'multiple', '判断题': 'boolean', '填空题': 'blank', '简答题': 'text', '单选题': 'single' })[node.getAttribute('typename')] : null;
      let type = workType || ({ '0': 'single', '1': 'multiple', '2': 'blank', '3': 'boolean', '4': 'text' })[typeCode] ||
        (/多选题/.test(typeLabel) || controls.some(c => c.type === 'checkbox') ? 'multiple' :
          /判断题/.test(typeLabel) ? 'boolean' : /填空题/.test(typeLabel) ? 'blank' :
            /简答题/.test(typeLabel) ? 'text' : options.length ? 'single' : fields.length ? 'text' : 'unsupported');
      if (!workType && typeCode && !['0', '1', '2', '3', '4'].includes(typeCode)) type = 'unsupported';
      if ((type === 'blank' || type === 'text') && !fields.length) type = 'unsupported';
      if (['single', 'multiple', 'boolean'].includes(type) && !options.length) type = 'unsupported';
      if (options.length && new Set(options.map(o => o.key)).size !== options.length) type = 'unsupported';
      // Math rendered as text remains usable; image-only questions need a visual adapter.
      const hasImages = !!title?.querySelector('img,canvas') || options.some(o => !!o.target?.querySelector('img,canvas'));
      const hasEncodedFont = titleText.unresolved || options.some(option => questionText(option.target).unresolved);
      return { node, fields, mirrors, options, hasImages, hasEncodedFont, data: { id: String(index + 1), text: stem, type,
        options: options.map(({ key, text }) => ({ key, text })), slots: fields.length } };
    });
  }
  function selected(option) {
    if (option.control && /^(radio|checkbox)$/.test(option.control.type) && typeof option.control.checked === 'boolean') return option.control.checked;
    const markers = [...new Set([option.control, option.target, option.target?.querySelector('.num_option,.num_option_dx')].filter(Boolean))];
    const aria = markers.map(marker => marker.getAttribute('aria-checked')).filter(value => value !== null);
    if (aria.some(value => !['true', 'false'].includes(value))) return null;
    const classSelected = markers.some(marker => /(^|\s)(check_answer_dx|check_answer|selected|active)(\s|$)/.test(marker.className));
    if (aria.includes('true') || classSelected) return true;
    if (aria.includes('false')) return false;
    // These known Chaoxing widgets express the unselected state by absence of
    // their selection class. An arbitrary custom widget has unknown state.
    if (option.target?.matches('.before-after,.before-after-checkbox,.ans-videoquiz-opt,.answerBg[onclick^="addChoice"],.answerBg[onclick^="addMultipleChoice"]')) return false;
    return null;
  }
  const needsPreservedWhitespace = value => /[\r\n\t]| {2}|^ | $/.test(value);
  function writeField(field, value) {
    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
      const view = field.ownerDocument.defaultView;
      const proto = field.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
    } else if (needsPreservedWhitespace(value)) {
      const pre = field.ownerDocument.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap'; pre.style.margin = '0';
      // Chaoxing's code toolbar assumes every PRE contains CODE, including on
      // mouseover. A CODE text node also protects a leading LF in HTML parsing.
      const code = field.ownerDocument.createElement('code');
      code.setAttribute('lang', 'Plain Text'); code.className = 'language-plain';
      code.textContent = value; pre.append(code);
      field.replaceChildren(pre);
    } else field.textContent = value;
    const EventType = field.ownerDocument.defaultView.Event;
    field.dispatchEvent(new EventType('input', { bubbles: true }));
    field.dispatchEvent(new EventType('change', { bubbles: true }));
  }
  function fieldAccepted(field, value) {
    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') return field.value === value;
    if (field.textContent !== value) return false;
    const normalize = source => source.replace(/\r\n?/g, '\n');
    // UEditor saves its body HTML. Verify that the safe DOM serialization keeps
    // the text, and that multiline code is actually displayed as multiline text.
    const view = field.ownerDocument.defaultView;
    const serialized = new view.DOMParser().parseFromString(field.innerHTML, 'text/html');
    if (normalize(serialized.body.textContent) !== normalize(value)) return false;
    if (needsPreservedWhitespace(value)) {
      const pre = field.querySelector('pre');
      const code = pre?.querySelector('code');
      if (!code || code.textContent !== value || !['pre', 'pre-wrap', 'break-spaces'].includes(view.getComputedStyle(pre).whiteSpace)) return false;
      if (visible(field) && normalize(field.innerText) !== normalize(value)) return false;
    }
    return true;
  }
  function answerPlans(parsed, answers) {
    // Validate everything before changing any answer.
    return parsed.map(q => {
      if (q.hasEncodedFont) throw new Error('题目字体未完整解码，已停止填写');
      const answer = answers.find(a => a.id === q.data.id);
      if (!answer || !Array.isArray(answer.values)) throw new Error('缺少题目答案');
      if (q.options.length) {
        if (answer.values.some(v => !q.options.some(o => o.key === v))) throw new Error('agent 选择了不存在的选项');
        if (q.data.type !== 'multiple' && answer.values.length !== 1) throw new Error('单选/判断的答案数量无效');
        if (q.options.some(option => selected(option) === null)) throw new Error('无法验证自定义选项状态，已停止填写');
      } else if (answer.values.length !== q.fields.length) throw new Error('填空答案数量不一致');
      const clicks = q.options.filter(option => {
        const wanted = answer.values.includes(option.key);
        return wanted !== selected(option) && (q.data.type === 'multiple' || wanted);
      }).map(option => option.control && (typeof option.control.checked === 'boolean' || q.data.type === 'multiple') ? option.control : option.target);
      clicks.forEach(prepareClick);
      return { q, answer, clicks };
    });
  }
  function validateAnswers(parsed, answers) { answerPlans(parsed, answers); }
  function applyAnswers(parsed, answers) {
    const plans = answerPlans(parsed, answers);
    for (const { q, answer, clicks } of plans) {
      if (q.options.length) {
        clicks.forEach(safeClick);
      } else {
        q.fields.forEach((field, i) => {
          writeField(field, answer.values[i]);
          for (const mirror of q.mirrors[i] || []) writeField(mirror, answer.values[i]);
        });
      }
    }
    verifyAnswers(parsed, answers);
  }
  function verifyAnswers(parsed, answers) {
    for (const q of parsed) {
      const answer = answers.find(answer => answer.id === q.data.id);
      if (!answer) throw new Error('缺少题目答案');
      if (q.options.length) {
        if (q.options.some(option => selected(option) === null)) throw new Error('无法验证自定义选项状态，已停止提交');
        const checked = q.options.filter(selected).map(o => o.key).sort();
        if (JSON.stringify(checked) !== JSON.stringify([...answer.values].sort())) throw new Error('页面未接受选项，已停止提交');
      } else if (!q.options.length && q.fields.some((field, index) => !fieldAccepted(field, answer.values[index]) || (q.mirrors[index] || []).some(mirror => !fieldAccepted(mirror, answer.values[index]))))
        throw new Error('页面未接受文字答案，已停止提交');
    }
  }
  function button(pattern, parent = document) {
    return all('button,a,input[type="button"],input[type="submit"],[role="button"]', parent).find(node =>
      visible(node) && !node.disabled && pattern.test(text(node) || node.value || ''));
  }
  function submissionSuccess() {
    if (first(['.testTit_status_complete', '.submitSuccess', '.submit-success', '.workSubmitSuccess'])) return true;
    const workStatus = first(['.testTit_status']);
    if (workStatus && /待批阅|已完成|已提交/.test(text(workStatus))) return true;
    return /提交成功|作业已提交|已完成本次答题|本次作业已完成/.test(text(document.body)) ||
      (!!first(['.mark_score', '.totalScore', '.resultScore']) && !submitButton());
  }
  function submitButton() { return first(['.btnSubmit.workBtnIndex', '#videoquiz-submit']) || button(/^(提交|提交作业|提交答案|确认提交)$/); }
  function confirmSubmit() {
    const dialog = first(['#workpop', '#workpopFocus', '.layui-layer-dialog', '[role="dialog"]', '.cxDialog', '.popbg', '.popDiv']);
    if (!dialog || !/提交/.test(text(dialog))) return false;
    if (/未做完|未完成|未达到及格线|不能提交/.test(text(dialog))) throw new Error('平台提示练习未完成或未通过，请检查题目');
    const confirm = first(['#popok'], dialog) || button(/^(确定|确认|提交|确认提交)$/ , dialog);
    if (confirm) { safeClick(confirm); return true; }
    return false;
  }
  function gate() {
    return !!first(['#captcha', '.captcha', '.yidun_popup', '.geetest_panel', 'iframe[src*="captcha"]']) ||
      (/人脸识别|请完成验证|请先登录/.test(text(document.body)) && !first(['video', 'audio']));
  }
  function jobs() {
    // Collapsed/off-screen tasks still belong to this chapter. Only the task's
    // own marker/container can establish its completion.
    return all('.ans-job-icon').map(icon => ({ icon, done: icon.classList.contains('ans-job-finished') ||
      !!icon.closest('.ans-attach-ct')?.classList.contains('ans-job-finished') }));
  }
  function mediaCompleted(item) {
    // Only the attachment containing this exact frame owns its media job.
    // Cross-origin/inaccessible parents and other completed tasks prove nothing.
    try {
      const attachment = item.ownerDocument.defaultView.frameElement?.closest('.ans-attach-ct');
      if (!attachment) return false;
      return attachment.classList.contains('ans-job-finished') || [...attachment.querySelectorAll('.ans-job-icon')].some(icon =>
        icon.closest('.ans-attach-ct') === attachment && icon.classList.contains('ans-job-finished'));
    } catch { return false; }
  }
  function mediaElements() {
    return all('video,audio').filter(item => {
      if (visible(item)) return true;
      // Audio with custom controls commonly has no visible native box. Limit
      // this exception to the site's audio module, so hidden quiz clips and
      // incidental page sounds are not started as course tasks.
      return item.localName === 'audio' && /\/ananas\/modules\/audio\//.test(location.pathname) &&
        !!(item.currentSrc || item.getAttribute('src') || item.querySelector('source[src]'));
    });
  }
  const cardsPath = /^\/(?:mooc-ans\/)?knowledge\/cards\/?$/;
  const workPath = /^\/(?:mooc-ans\/)?(?:work\/(?:doHomeWorkNew|selectWorkQuestionYiPiYue)|api\/work)\/?$/;
  const loadingSelectors = ['[aria-busy="true"]', '.loading', '.loading-mask', '.loadmask', '.layui-layer-loading'];
  function frameState() {
    const cards = cardsPath.test(location.pathname);
    const workFrames = cards ? all('.ans-attach-ct iframe').filter(frame => {
      try { return /\/ananas\/modules\/work\//.test(new URL(frame.getAttribute('src'), location.href).pathname); } catch { return false; }
    }) : [];
    return {
      cardsReady: cards && document.readyState === 'complete' && !first(loadingSelectors),
      workFrameCount: workFrames.length,
      workFrameUrls: workFrames.map(frame => new URL(frame.getAttribute('src'), location.href).href),
      workFrameJobs: workFrames.map(frame => {
        const attachment = frame.closest('.ans-attach-ct');
        const icon = attachment?.querySelector('.ans-job-icon');
        return { url: new URL(frame.getAttribute('src'), location.href).href, hasMarker: !!icon,
          done: !!icon && (icon.classList.contains('ans-job-finished') || attachment.classList.contains('ans-job-finished')) };
      }),
      childFrameUrls: /\/ananas\/modules\/work\//.test(location.pathname) ? all('iframe[src]').map(frame => {
        try { return new URL(frame.getAttribute('src'), location.href).href; } catch { return null; }
      }).filter(Boolean) : [],
      submissionConfirmed: workPath.test(location.pathname) && submissionSuccess()
    };
  }
  function sameFrameUrl(left, right) {
    try {
      const normalize = value => {
        const url = new URL(value);
        url.hash = '';
        for (const key of ['t', '_t', 'timestamp', '_']) url.searchParams.delete(key);
        url.searchParams.sort();
        return url.href;
      };
      return normalize(left) === normalize(right);
    } catch { return false; }
  }
  function platformWorkCompleted(reports = []) {
    if (!workPath.test(location.pathname)) return false;
    // Prefer the task's own native marker, walking through the nested work
    // module when those frames are same-origin.
    try {
      let frame = window.frameElement;
      for (let depth = 0; frame && depth < 4; depth++) {
        const attachment = frame.closest('.ans-attach-ct');
        const icon = attachment?.querySelector('.ans-job-icon');
        if (icon) return icon.classList.contains('ans-job-finished') || attachment.classList.contains('ans-job-finished');
        frame = frame.ownerDocument.defaultView.frameElement;
      }
    } catch { /* Cross-origin ancestors are resolved through fresh reports. */ }
    const fresh = report => !Number.isFinite(report.at) || Date.now() - report.at < 12000;
    const modules = reports.filter(report => fresh(report) && report.childFrameUrls?.some(url => sameFrameUrl(url, location.href)));
    return modules.some(module => reports.some(cards => fresh(cards) && cards.cardsReady === true &&
      cards.workFrameJobs?.some(job => job.hasMarker && job.done && sameFrameUrl(job.url, module.url))));
  }
  function chapterReadiness(reports) {
    if (!/\/mycourse\/studentstudy\/?$/.test(location.pathname)) return { ready: true };
    const wait = reason => ({ ready: false, reason });
    let source;
    try {
      const src = document.querySelector('#iframe')?.getAttribute('src');
      if (!src) return wait('章节内容尚未加载，等待任务状态');
      source = new URL(src, location.href);
    } catch { return wait('章节内容尚未加载，等待任务状态'); }
    if (!cardsPath.test(source.pathname)) return wait('章节内容尚未加载，等待任务状态');
    const current = new URL(location.href);
    const chapter = current.searchParams.get('chapterId') || current.searchParams.get('knowledgeid');
    if (chapter && source.searchParams.get('knowledgeid') !== chapter) return wait('章节正在切换，等待当前任务状态');
    const fresh = report => !Number.isFinite(report.at) || Date.now() - report.at < 12000;
    const cards = reports.find(report => {
      try {
        const url = new URL(report.url);
        return fresh(report) && report.cardsReady === true && sameFrameUrl(url.href, source.href);
      } catch { return false; }
    });
    if (!cards) return wait('章节任务状态尚未就绪，等待内容加载');
    // Trace each actual work iframe through its module report. Work documents
    // can be cross-origin or omit knowledgeid; their concrete parent iframe
    // URL binds them more precisely than a chapter query parameter does.
    if (cards.workFrameUrls?.length) {
      const skipped = [];
      const resolved = cards.workFrameUrls.every(moduleUrl => {
        const module = reports.find(report => fresh(report) && sameFrameUrl(report.url, moduleUrl));
        const children = module?.childFrameUrls?.map(childUrl => reports.find(report =>
          fresh(report) && sameFrameUrl(report.url, childUrl))).filter(Boolean) || [];
        if (children.some(report => report.submissionConfirmed)) return true;
        if (children.some(report => report.mode === 'skipped' && report.skipReason === 'no-valid-answer' &&
          /^[a-f0-9]{64}$/.test(report.quizKey || ''))) { skipped.push(moduleUrl); return true; }
        return false;
      });
      // A completed native task marker is the platform's own chapter state.
      // Review pages can remain at "待批阅" and never expose the receipt DOM
      // expected by submissionSuccess(), even after the marker is complete.
      if (!resolved && !(cards.jobTotal > 0 && cards.jobDone === cards.jobTotal && cards.trackedJobTotal === cards.jobTotal))
        return wait('章节练习尚未确认全部提交，等待平台回执');
      return { ready: true, cards, skippedWorkCount: skipped.length,
        skippedWorkJobTotal: (cards.workFrameJobs || []).filter(job =>
          job.hasMarker && !job.done && skipped.some(url => sameFrameUrl(url, job.url))).length };
    }
    const work = new Map();
    for (const report of reports) {
      try {
        const url = new URL(report.url);
        if (!fresh(report) || !workPath.test(url.pathname) || url.origin !== source.origin ||
          url.searchParams.get('knowledgeid') !== source.searchParams.get('knowledgeid')) continue;
        const identity = url.searchParams.get('workAnswerId') || url.searchParams.get('workId') || url.searchParams.get('oldWorkId');
        if (identity) work.set(identity, report);
      } catch {}
    }
    if (work.size < (cards.workFrameCount || 0) || [...work.values()].some(report => !report.submissionConfirmed))
      return wait('章节练习尚未确认全部提交，等待平台回执');
    return { ready: true, cards };
  }
  function completion(selector) {
    if (selector) return !!first([selector]);
    const markers = jobs();
    return markers.length > 0 && markers.every(job => job.done);
  }
  function nextAction(selector) {
    if (selector) return first([selector]);
    return first(['#prevNextFocusNext', '.nextChapter', 'a[title="下一节"]', 'button[title="下一节"]']) || button(/^(下一节|下一章节|下一个任务点|下一任务点)$/);
  }
  function nextChapterConfirmation() {
    const marker = document.querySelector('#jobFinishTipFocus');
    if (!visible(marker)) return null;
    let root = marker;
    for (let depth = 0; root && root !== document.body && depth < 6; depth++, root = root.parentElement) {
      if (!/当前章节还有任务点未完成[，,]?\s*是否去完成[？?]?/.test(text(root))) continue;
      const choices = all('a,button', root).filter(node => visible(node) && text(node) === '下一节' && node.id !== 'prevNextFocusNext');
      if (choices.length === 1) return choices[0];
      if (choices.length > 1) return null;
    }
    return null;
  }
  function currentCard() {
    return first(['.ans-tabs .ans-tab.on', '.ans-tabs .ans-tab.active', '.tabtags .curr', '.tabtags .on', '#tab_ul .cur']);
  }
  function nextCard() {
    const current = currentCard();
    // Some templates put the active class on the anchor inside a tab LI.
    const item = current?.closest('li') || current;
    let sibling = item?.nextElementSibling;
    while (sibling && !visible(sibling)) sibling = sibling.nextElementSibling;
    const target = sibling?.querySelector('a,button') || sibling;
    return target && !target.matches(':disabled,[aria-disabled="true"]') ? target : null;
  }
  function documentPages() {
    const files = all('.fileBox li').filter(node => node.getBoundingClientRect().height > 0);
    if (files.length) return files;
    return all('#viewer .page, .pdfViewer .page').filter(node => node.getBoundingClientRect().height > 0);
  }
  function textReading() {
    // Only a loaded native cards document can establish that a chapter has no
    // tracked tasks. An empty wrapper or a frame still loading is not reading.
    if (!/^\/(?:mooc-ans\/)?knowledge\/cards\/?$/.test(location.pathname) || document.readyState !== 'complete') return null;
    if (document.querySelector('iframe,object,embed,video,audio,.ans-job-icon,.ans-attach-ct,.singleQuesId,.TiMu,.questionLi,.question-item,.mark_item,.queBox,.ans-videoquiz')) return null;
    if (first(['[aria-busy="true"]', '.loading', '.loading-mask', '.loadmask', '.layui-layer-loading'])) return null;
    const root = first(['.ans-cc']);
    if (!root) return null;
    const bodyText = text(root);
    if (bodyText.length < 40 || !all('p,h1,h2,h3,h4,li,blockquote,article', root).some(node => visible(node) && text(node).length >= 20)) return null;
    return { root, key: location.href + '\n' + bodyText };
  }
  function routeSignature() {
    const card = currentCard();
    return JSON.stringify({ href: location.href, mainFrame: document.querySelector('#iframe')?.getAttribute('src') || '',
      card: card ? [...card.parentElement.children].indexOf(card) + ':' + (card.id || '') + ':' + text(card) : '' });
  }
  globalThis.ChaoxingAdapter = { text, questionText, courseContext, visible, all, first, prepareClick, safeClick, parseQuestions, validateAnswers, applyAnswers, verifyAnswers, submitButton,
    submissionSuccess, confirmSubmit, gate, jobs, mediaCompleted, mediaElements, frameState, isWorkPage: () => workPath.test(location.pathname), platformWorkCompleted, chapterReadiness, completion, nextAction, nextChapterConfirmation, nextCard, currentCard, documentPages, textReading, routeSignature };
})();
