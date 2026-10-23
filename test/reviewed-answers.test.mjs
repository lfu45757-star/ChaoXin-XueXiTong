import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentServer } from '../server.mjs';
import { batchKey } from '../lib/batch.mjs';
import { createReviewedAnswer } from '../lib/reviewed-answers.mjs';

const token = 'fixture-review-token';
const context = { courseTitle: 'Python基础', chapterTitle: '循环', programmingLanguage: 'Python' };
const questions = ['1', '2', '15'].map(id => ({ id, type: 'single', text: `fixture ${id}`, slots: 0, options: [{ key: 'A', text: 'choice A' }, { key: 'D', text: 'choice D' }] }));
const original = { answers: questions.map((q, i) => ({ id: q.id, values: ['D'], confidence: [0.93, 0.97, 0.6][i], explanation: `original model ${q.id}` })) };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cx-reviewed-test-'));
  const runsDir = join(dir, 'runs'), reviewsDir = join(dir, 'reviewed'), runName = 'solve-fixture001', run = join(runsDir, runName);
  await mkdir(run, { recursive: true });
  await writeFile(join(run, 'questions.json'), JSON.stringify({ questions, context }));
  await writeFile(join(run, 'answer.json'), JSON.stringify(original));
  let calls = 0;
  const server = createAgentServer({ token, runsDir, reviewsDir, configPath: join(dir, 'provider.json'), env: {}, lookup: null, solver: async () => { calls++; return original; }, logPath: join(dir, 'events.jsonl') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (body = {}) => fetch(`http://127.0.0.1:${server.address().port}/solve`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ questions, context, ...body })
  });
  const review = (id = '15', values = ['A']) => createReviewedAnswer(runName, id, values, { token, runsDir, reviewsDir });
  return { post, review, run, runName, runsDir, reviewsDir, calls: () => calls };
}

test('精确人工复核覆盖已有低置信度缓存，仅目标题过门槛并保留原始模型证据', async t => {
  const f = await fixture(t);
  const before = await (await f.post()).json();
  assert.equal(before.answers[2].confidence, 0.6);
  const result = await f.review();
  const after = await (await f.post()).json();
  assert.equal(f.calls(), 1);
  assert.deepEqual(after.answers.slice(0, 2), original.answers.slice(0, 2));
  assert.equal(after.answers[2].confidence, 1);
  assert.deepEqual(after.answers[2].values, ['A']);
  assert.match(after.answers[2].explanation, /人工确认，模型原置信度0\.6/);
  assert.ok(after.answers.every(answer => answer.confidence >= 0.85));
  const record = JSON.parse(await readFile(result.path, 'utf8'));
  assert.deepEqual(record.originalAnswers, original);
  assert.deepEqual(record.context, context);
  assert.deepEqual(record.questions, questions);
  assert.equal(record.originRun, f.runName);
  assert.equal(record.review.source, 'user-confirmed');
  assert.equal(record.review.originalConfidence, 0.6);
  assert.deepEqual(JSON.parse(await readFile(join(f.run, 'answer.json'), 'utf8')), original);
  assert.equal(result.batchHash, batchKey(questions, { programmingLanguage: 'Python', chapterTitle: '循环', courseTitle: 'Python基础' }));
});

test('不同上下文不复用人工复核，改名复用或修改记录均拒绝且不回退旧缓存', async t => {
  const f = await fixture(t), result = await f.review();
  await f.post();
  const other = { ...context, programmingLanguage: 'Java' };
  const response = await f.post({ context: other });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answers[2].confidence, 0.6);
  assert.equal(f.calls(), 1);
  await copyFile(result.path, join(f.reviewsDir, batchKey(questions, other) + '.json'));
  assert.equal((await f.post({ context: other })).status, 400);
  const record = JSON.parse(await readFile(result.path, 'utf8'));
  record.review.values = ['D'];
  await writeFile(result.path, JSON.stringify(record));
  const tampered = await f.post();
  assert.equal(tampered.status, 400);
  assert.match((await tampered.json()).error, /完整性/);
  assert.equal(f.calls(), 1);
});

test('非法选项/运行路径不能创建复核，原始题组或答案变化使已有复核失效', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.review('15', ['Z']), /不存在的选项/);
  await assert.rejects(() => f.review('unknown', ['A']), /目标/);
  await assert.rejects(() => createReviewedAnswer('../solve-other', '15', ['A'], { token, runsDir: f.runsDir, reviewsDir: f.reviewsDir }), /名称无效/);
  assert.deepEqual(await readdir(f.reviewsDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  await f.review();
  const changed = structuredClone(questions); changed[0].text = 'different question';
  await writeFile(join(f.run, 'questions.json'), JSON.stringify({ questions: changed, context }));
  assert.equal((await f.post()).status, 400);
  await writeFile(join(f.run, 'questions.json'), JSON.stringify({ questions, context }));
  const changedAnswer = structuredClone(original); changedAnswer.answers[0].confidence = 0.9;
  await writeFile(join(f.run, 'answer.json'), JSON.stringify(changedAnswer));
  assert.equal((await f.post()).status, 400);
  assert.equal(f.calls(), 0);
});
