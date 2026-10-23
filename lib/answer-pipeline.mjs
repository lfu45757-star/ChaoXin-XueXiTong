import { validateAnswers } from './solver.mjs';

// A lookup adapter returns only candidates for the current request:
// { answers: [{ id, values, confidence, explanation, matchScore }] }.
// Undefined means no question bank was configured. No provider credentials or
// raw lookup responses are included in the public result.
export async function solveWithLookup(questions, { solver, lookup, minMatch = 0.95, ...options }) {
  if (!Number.isFinite(minMatch) || minMatch < 0 || minMatch > 1) throw new Error('题库匹配阈值必须在 0–1 之间');
  if (!lookup) return validateAnswers(await solver(questions, options), questions);
  let candidates, unavailable = false;
  try { candidates = await lookup(questions, options); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    unavailable = true;
  }
  if (!unavailable && candidates === undefined) return validateAnswers(await solver(questions, options), questions);
  unavailable ||= candidates?.unavailable === true;
  const accepted = new Map(), sources = new Map(), providerCandidates = new Map();
  const rows = Array.isArray(candidates?.answers) ? candidates.answers : [];
  for (const question of questions) {
    const matches = rows.filter(item => item?.id === question.id);
    if (matches.length !== 1) continue;
    const item = matches[0];
    const providerAccurate = item.provider === 'daxuesoutijiang' && item.matchBasis === 'provider-isAccurate' && item.providerAccurate === true;
    if (!providerAccurate && (!Number.isFinite(item.matchScore) || item.matchScore < minMatch || item.matchScore > 1)) continue;
    try {
      const answer = validateAnswers({ answers: [item] }, [question]).answers[0];
      // The provider's isAccurate flag describes its own match, not answer
      // correctness. Corroborate remote hits before allowing auto-submit.
      if (providerAccurate) { providerCandidates.set(question.id, answer); continue; }
      accepted.set(question.id, answer);
      sources.set(question.id, { id: question.id, source: 'question_bank', ...(providerAccurate ?
        { provider: 'daxuesoutijiang', matchBasis: 'provider-isAccurate', providerAccurate: true } : { matchScore: item.matchScore }) });
    } catch { /* A malformed bank hit is a miss, never an answer to fill. */ }
  }
  const missing = questions.filter(question => !accepted.has(question.id));
  if (missing.length) {
    options.signal?.throwIfAborted();
    const generated = validateAnswers(await solver(missing, options), missing);
    for (const answer of generated.answers) {
      const candidate = providerCandidates.get(answer.id);
      if (candidate && JSON.stringify(candidate.values) === JSON.stringify(answer.values)) {
        accepted.set(answer.id, { ...answer, confidence: Math.min(answer.confidence, candidate.confidence) });
        sources.set(answer.id, { id: answer.id, source: 'question_bank', provider: 'daxuesoutijiang', matchBasis: 'provider-isAccurate', providerAccurate: true, corroborated: true });
      } else if (candidate) {
        accepted.set(answer.id, { ...answer, confidence: Math.min(answer.confidence, 0.5), explanation: '大学搜题酱与 AI 答案不一致，需独立复核。' });
        sources.set(answer.id, { id: answer.id, source: 'conflict', provider: 'daxuesoutijiang' });
      } else {
        accepted.set(answer.id, answer);
        sources.set(answer.id, { id: answer.id, source: 'ai' });
      }
    }
  }
  options.signal?.throwIfAborted();
  return {
    ...validateAnswers({ answers: questions.map(question => accepted.get(question.id)) }, questions),
    sources: questions.map(question => sources.get(question.id)),
    lookup: { status: unavailable ? 'unavailable' : 'complete', hits: [...sources.values()].filter(source => source.source === 'question_bank').length,
      misses: [...sources.values()].filter(source => source.source !== 'question_bank').length },
  };
}

// Recheck only answers below the user's threshold with an independent AI pass.
// A failed or conflicting recheck preserves the original valid answer and its
// reported confidence; it never turns a guess into a high-confidence answer.
export async function reviewLowConfidence(questions, result, { solver, threshold, ...options }) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('复核置信度阈值无效');
  const original = validateAnswers(result, questions).answers;
  const byId = new Map(original.map(answer => [answer.id, answer]));
  const lowQuestions = questions.filter(question => byId.get(question.id).confidence < threshold);
  if (!lowQuestions.length) return result;
  let reviewed;
  try {
    options.signal?.throwIfAborted();
    reviewed = validateAnswers(await solver(lowQuestions, { ...options, review: true }), lowQuestions).answers;
  } catch (error) {
    options.signal?.throwIfAborted();
    return { ...result, review: { attempted: true, threshold,
      outcomes: lowQuestions.map(question => ({ id: question.id, status: 'failed' })) } };
  }
  const checked = new Map(reviewed.map(answer => [answer.id, answer]));
  const outcomes = [];
  for (const question of lowQuestions) {
    const before = byId.get(question.id), after = checked.get(question.id);
    if (before.confidence === 0 && after.confidence > 0) {
      byId.set(question.id, after);
      outcomes.push({ id: question.id, status: after.confidence >= threshold ? 'confirmed' : 'inconclusive' });
    } else if (JSON.stringify(before.values) !== JSON.stringify(after.values)) {
      outcomes.push({ id: question.id, status: 'disagreed' });
    } else {
      const confidence = Math.max(before.confidence, after.confidence);
      byId.set(question.id, { ...before, confidence,
        explanation: after.confidence >= before.confidence ? after.explanation : before.explanation });
      outcomes.push({ id: question.id, status: confidence >= threshold ? 'confirmed' : 'inconclusive' });
    }
  }
  return { ...result, answers: questions.map(question => byId.get(question.id)),
    review: { attempted: true, threshold, outcomes } };
}
