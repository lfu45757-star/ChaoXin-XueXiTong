import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLowConfidence } from '../lib/answer-pipeline.mjs';
import { reviewPromptFor } from '../lib/solver.mjs';

const questions = [
  { id: '1', type: 'single', text: '遍历字典的键和值使用哪个方法？', options: [
    { key: 'A', text: 'keys()' }, { key: 'B', text: 'values()' }, { key: 'C', text: 'items()' }, { key: 'D', text: 'get()' }], slots: 0 },
  { id: '2', type: 'single', text: '1 + 1 = ?', options: [
    { key: 'A', text: '1' }, { key: 'B', text: '2' }], slots: 0 }
];
const answer = (id, key, confidence) => ({ id, values: [key], confidence, explanation: 'fixture' });
const original = { answers: [answer('1', 'C', .5), answer('2', 'B', .99)], sources: [{ id: '1', source: 'conflict' }] };

test('只复核低置信题；独立同答且高置信时提高置信度', async () => {
  let calls = 0;
  const result = await reviewLowConfidence(questions, original, { threshold: .9, solver: async (selected, options) => {
    calls++;
    assert.deepEqual(selected.map(q => q.id), ['1']);
    assert.equal(options.review, true);
    return { answers: [answer('1', 'C', .96)] };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.answers.map(a => a.confidence), [.96, .99]);
  assert.deepEqual(result.review.outcomes, [{ id: '1', status: 'confirmed' }]);
  assert.deepEqual(result.sources, original.sources);
});

test('复核失败、不同答或仍不确定时保留可提交的低置信原答', async () => {
  const cases = [
    { solver: async () => { throw new Error('offline'); }, status: 'failed', confidence: .5 },
    { solver: async () => ({ answers: [answer('1', 'D', .98)] }), status: 'disagreed', confidence: .5 },
    { solver: async () => ({ answers: [answer('1', 'C', .7)] }), status: 'inconclusive', confidence: .7 },
    { solver: async () => ({ answers: [answer('1', 'invalid', .98)] }), status: 'failed', confidence: .5 }
  ];
  for (const item of cases) {
    const result = await reviewLowConfidence(questions, original, { threshold: .9, solver: item.solver });
    assert.equal(result.answers[0].values[0], 'C');
    assert.equal(result.answers[0].confidence, item.confidence);
    assert.equal(result.review.outcomes[0].status, item.status);
  }
});

test('首轮无答案仅接受复核给出的有效答案；取消请求不作降级提交', async () => {
  const empty = { answers: [answer('1', 'C', 0), answer('2', 'B', .99)] };
  const result = await reviewLowConfidence(questions, empty, { threshold: .9,
    solver: async () => ({ answers: [answer('1', 'C', .6)] }) });
  assert.equal(result.answers[0].confidence, .6);
  const abort = new AbortController();
  await assert.rejects(reviewLowConfidence(questions, original, { threshold: .9, signal: abort.signal,
    solver: async () => { abort.abort(); throw new Error('canceled'); } }), /abort/i);
});

test('复核提示不包含原答案，要求独立核对', () => {
  const prompt = reviewPromptFor([questions[0]], { programmingLanguage: 'Python' });
  assert.match(prompt, /独立复核者/);
  assert.match(prompt, /Python/);
  assert.ok(!prompt.includes('"values":["C"]'));
});
