import { validateAnswers } from './solver.mjs';

export const daxueEndpoint = 'https://www.daxuesoutijiang.com/dxai/submit/exercise/solve';
const types = { single: '单选题', multiple: '多选题', boolean: '判断题', blank: '填空题', text: '简答题' };

export function parseDaxueAnswer(question, payload) {
  // The shipped client treats exactly 1 as "accurate". It is a categorical
  // provider flag, not a measured similarity or probability of correctness.
  if (payload?.errNo !== 0 || payload.data?.isAccurate !== 1 || typeof payload.data.option !== 'string') return;
  const option = payload.data.option.trim();
  if (!option) return;
  let values;
  if (question.options.length) {
    const keys = question.options.map(item => item.key);
    if (keys.includes(option)) values = [option];
    else if (question.type === 'multiple' && /^[A-Z\s,，、;；]+$/.test(option)) values = option.replace(/[\s,，、;；]/g, '').split('');
    else return;
  } else if (question.type === 'blank') values = option.replace(/^#+|#+$/g, '').split('#');
  else values = [option];
  try {
    const answer = validateAnswers({ answers: [{ id: question.id, values, confidence: 0.9,
      explanation: '大学搜题酱接口返回 isAccurate=1；本地已校验答案结构，此标记不保证答案正确。' }] }, [question]).answers[0];
    return { ...answer, provider: 'daxuesoutijiang', providerAccurate: true, matchBasis: 'provider-isAccurate' };
  } catch { return; }
}

export async function lookupDaxue(questions, { signal, fetchImpl = fetch, budgetMs = 30000 } = {}) {
  const answers = [], deadline = Date.now() + budgetMs;
  let unavailable = false;
  for (const question of questions) {
    signal?.throwIfAborted();
    if (!types[question.type]) continue;
    if (Date.now() >= deadline) { unavailable = true; break; }
    const form = new FormData();
    const fields = { questionText: question.text, questionType: types[question.type],
      options: JSON.stringify(question.options.map(item => /^[A-Z][.、．\s]/.test(item.text.trim()) ? item.text : `${item.key}. ${item.text}`)),
      appId: 'collegepcpi', vcname: '1.17.5', image: '', historyResult: '', questionId: '', blankNum: String(question.slots || 0) };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now())));
    try {
      const response = await fetchImpl(daxueEndpoint, { method: 'POST', body: form, credentials: 'omit', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) { unavailable = true; break; }
      let bytes = 0, text = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('题库响应过大');
        text += decoder.decode(chunk, { stream: true });
      }
      const payload = JSON.parse(text + decoder.decode());
      // No cookie acquisition, login emulation, entitlement bypass, or retries.
      if (payload.errNo !== 0) { unavailable = true; break; }
      const answer = parseDaxueAnswer(question, payload);
      if (answer) answers.push(answer);
    } catch (error) {
      if (signal?.aborted) throw error;
      unavailable = true; break;
    }
  }
  return { answers, unavailable };
}
