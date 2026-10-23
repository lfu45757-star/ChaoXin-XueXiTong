import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAnswers } from './solver.mjs';
import { validateBaseUrl } from './agent-config.mjs';
import { lookupDaxue } from './daxue-question-bank.mjs';

const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();

// Local entries carry their own option keys. Compare option text and map each
// selected key back onto this page, so a shuffled option list cannot invert it.
export function matchLocalEntry(question, entry, context = {}) {
  const stored = entry?.question;
  if (!stored || stored.type !== question.type || stored.slots !== question.slots || normalize(stored.text) !== normalize(question.text)) return;
  if (entry.context && Object.entries(entry.context).some(([key, value]) => context[key] !== value)) return;
  if (!Array.isArray(stored.options) || stored.options.length !== question.options.length ||
      stored.options.some(option => !option || typeof option.key !== 'string' || typeof option.text !== 'string')) return;
  const oldByKey = new Map(stored.options.map(option => [option.key, normalize(option.text)]));
  const currentByText = new Map(question.options.map(option => [normalize(option.text), option.key]));
  if (oldByKey.size !== stored.options.length || currentByText.size !== question.options.length ||
      new Set(oldByKey.values()).size !== oldByKey.size || [...oldByKey.values()].some(text => !text || !currentByText.has(text))) return;
  const answer = entry.answer;
  if (!answer || !Array.isArray(answer.values)) return;
  const values = question.options.length ? answer.values.map(key => currentByText.get(oldByKey.get(key))) : answer.values;
  try {
    return { ...validateAnswers({ answers: [{ ...answer, id: question.id, values }] }, [question]).answers[0], matchScore: 1 };
  } catch { return; }
}

async function loadLocal(path) {
  try {
    if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('本地题库超过 5 MiB');
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(data.entries) || data.entries.length > 10000) throw new Error('本地题库格式无效');
    return data.entries;
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
}

export function createQuestionBankLookup({ path, env = process.env }) {
  const lookup = async function lookup(questions, { signal, context, env: requestEnv = env }) {
    const entries = await loadLocal(env.QUESTION_BANK_FILE || path);
    const provider = requestEnv.QUESTION_BANK_PROVIDER || (env.QUESTION_BANK_URL ? 'generic' : 'local');
    const remote = provider === 'generic' ? env.QUESTION_BANK_URL : '';
    if (entries === undefined && !remote && provider !== 'daxuesoutijiang') return;
    const answers = [];
    for (const question of questions) {
      const matches = (entries || []).map(entry => matchLocalEntry(question, entry, context)).filter(Boolean);
      // Conflicting entries are not resolved by arbitrary file order.
      if (matches.length && matches.every(answer => JSON.stringify(answer.values) === JSON.stringify(matches[0].values))) {
        const hit = matches.reduce((a, b) => a.confidence < b.confidence ? a : b);
        answers.push(hit);
      }
    }
    const missing = questions.filter(question => !answers.some(answer => answer.id === question.id));
    if (provider === 'daxuesoutijiang' && missing.length) {
      const result = await lookupDaxue(missing, { signal });
      return { answers: [...answers, ...result.answers], unavailable: result.unavailable };
    }
    if (!remote || !missing.length) return { answers };
    const timeout = Number(env.QUESTION_BANK_TIMEOUT_MS || 10000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw new Error('题库超时应为 1000–30000 毫秒');
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    try {
      const response = await fetch(validateBaseUrl(remote), {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', ...(env.QUESTION_BANK_API_KEY ? { Authorization: `Bearer ${env.QUESTION_BANK_API_KEY}` } : {}) },
        body: JSON.stringify({ questions: missing, context }),
      });
      if (!response.ok) throw new Error(`题库 HTTP ${response.status}`);
      let bytes = 0, text = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error('题库响应超过 2 MiB');
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload.answers)) throw new Error('题库响应缺少 answers');
      return { answers: [...answers, ...payload.answers.filter(answer => missing.some(question => question.id === answer?.id))] };
    } catch (error) {
      if (signal?.aborted) throw error;
      // Preserve valid local hits even if the optional remote bank is down.
      return { answers, unavailable: true };
    }
  };
  lookup.cacheKey = async () => {
    let local = 'missing';
    try { const info = await stat(env.QUESTION_BANK_FILE || path, { bigint: true }); local = `${info.size}:${info.mtimeNs}`; }
    catch (error) { if (error.code !== 'ENOENT') local = 'unavailable'; }
    return createHash('sha256').update(JSON.stringify([env.QUESTION_BANK_FILE || path, local,
      env.QUESTION_BANK_URL || '', env.QUESTION_BANK_API_KEY || '', env.QUESTION_BANK_MIN_MATCH || '0.95'])).digest('hex');
  };
  return lookup;
}
