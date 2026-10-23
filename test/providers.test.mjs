import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createAgentServer } from '../server.mjs';
import { solve } from '../lib/solver.mjs';
import { configFromEnv, normalizeProviderConfig, publicProviderConfig, providerEnv, createProviderConfigStore } from '../lib/agent-config.mjs';
import { solveWithLookup } from '../lib/answer-pipeline.mjs';
import { createQuestionBankLookup, matchLocalEntry } from '../lib/question-bank.mjs';

const question = { id: 'q1', type: 'single', text: '2 + 2 = ?', slots: 0, options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }] };
const answer = { id: 'q1', values: ['B'], confidence: 0.99, explanation: '加法' };
const headers = { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' };
async function start(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cx-providers-'));
  const configPath = join(dir, 'provider.json');
  const logPath = join(dir, 'events.jsonl');
  const server = createAgentServer({ token: 'fixture-token', configPath, logPath, env: {}, lookup: null, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { base, post, configPath, logPath };
}

test('配置预设、端点安全、切换来源不沿用旧密钥，Codex 模型仍遵循配置', () => {
  const deepseek = configFromEnv({ AGENT_PROVIDER: 'deepseek', AGENT_API_KEY: 'fixture-deepseek-key' });
  assert.equal(deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(deepseek.responseFormat, 'json_object');
  assert.equal(deepseek.model, 'deepseek-flash');
  assert.equal(publicProviderConfig(deepseek).hasApiKey, true);
  assert.ok(!Object.hasOwn(publicProviderConfig(deepseek), 'apiKey'));
  assert.equal(normalizeProviderConfig({ model: 'other', apiKey: '' }, deepseek).apiKey, deepseek.apiKey);
  const changed = normalizeProviderConfig({ provider: 'http', baseUrl: 'https://example.com/v1', model: 'custom' }, deepseek);
  assert.equal(changed.apiKey, '');
  const sameProvider = normalizeProviderConfig({ apiKey: 'other-key' }, changed);
  assert.equal(normalizeProviderConfig({ baseUrl: 'https://other.example/v1' }, sameProvider).apiKey, '');
  assert.equal(normalizeProviderConfig({ clearApiKey: true }, sameProvider).apiKey, '');
  for (const baseUrl of ['http://remote.example/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/#secret'])
    assert.throws(() => normalizeProviderConfig({ provider: 'http', baseUrl, model: 'x' }));
  assert.throws(() => normalizeProviderConfig({ ...deepseek, baseUrl: 'https://example.com' }));
  const codex = configFromEnv({ CODEX_MODEL: 'local-choice' });
  assert.equal(codex.model, 'local-choice');
  assert.equal(providerEnv({ ...codex, model: 'new-choice' }, {}).CODEX_MODEL, 'new-choice');
});

test('DeepSeek 发送 json_object 和示例，空答案、截断及格式错误均不填入', async () => {
  const env = { AGENT_PROVIDER: 'deepseek', AGENT_API_KEY: 'fixture-secret' };
  let observed;
  const result = await solve([question], { env, fetchImpl: async (url, request) => {
    observed = { url: String(url), request, body: JSON.parse(request.body) };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: [answer] }) } }] });
  } });
  assert.deepEqual(result, { answers: [answer] });
  assert.equal(observed.url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(observed.body.response_format, { type: 'json_object' });
  assert.match(observed.body.messages[0].content, /JSON Schema/);
  assert.match(observed.body.messages[0].content, /格式示例/);
  assert.equal(observed.request.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(observed.request.redirect, 'error');
  assert.equal(observed.body.max_tokens, 8192);
  for (const [choice, pattern] of [
    [{ message: { content: '' } }, /空答案/],
    [{ finish_reason: 'length', message: { content: '{' } }, /截断/],
    [{ message: { content: '```json\n{}\n```' } }, /完整 JSON/],
    [{ message: { refusal: 'no' } }, /拒绝/],
  ]) await assert.rejects(solve([question], { env, fetchImpl: async () => Response.json({ choices: [choice] }) }), pattern);
  await assert.rejects(solve([question], { env, fetchImpl: async () => { throw new Error('fixture-secret'); } }), error => !error.message.includes('fixture-secret'));
});

test('自定义 text 格式省略 response_format，完整端点不会追加两次路径', async () => {
  let observed;
  await solve([question], { env: { AGENT_PROVIDER: 'http', AGENT_BASE_URL: 'https://example.com/v1/chat/completions', AGENT_MODEL: 'custom', AGENT_RESPONSE_FORMAT: 'text' },
    fetchImpl: async (url, request) => { observed = { url: String(url), body: JSON.parse(request.body) }; return Response.json({ choices: [{ message: { content: JSON.stringify({ answers: [answer] }) } }] }); } });
  assert.equal(observed.url, 'https://example.com/v1/chat/completions');
  assert.ok(!Object.hasOwn(observed.body, 'response_format'));
});

test('配置接口要求认证、持久化密钥但不回传，修改配置使缓存失效', async t => {
  const calls = [];
  const { base, post, configPath } = await start(t, { solver: async (questions, options) => { calls.push(options.env); return { answers: [answer] }; } });
  assert.equal((await fetch(base + '/config')).status, 401);
  let response = await post('/config', { provider: 'deepseek', apiKey: 'fixture-config-secret' });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.hasApiKey, true);
  assert.ok(!JSON.stringify(saved).includes('fixture-config-secret'));
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).apiKey, 'fixture-config-secret');
  assert.equal((await createProviderConfigStore({ path: configPath, env: {} }).read()).apiKey, 'fixture-config-secret');
  const send = () => post('/solve', { questions: [question] });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal(calls.length, 1);
  await post('/config', { model: 'new-model', apiKey: '' });
  assert.equal((await send()).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].AGENT_MODEL, 'new-model');
  assert.equal(calls[1].AGENT_API_KEY, 'fixture-config-secret');
  const reread = await (await fetch(base + '/config', { headers })).json();
  assert.equal(reread.model, 'new-model');
  assert.ok(!Object.hasOwn(reread, 'apiKey'));
  response = await post('/config', { clearApiKey: true });
  assert.equal((await response.json()).hasApiKey, false);
});

test('solve 按当前门槛复核低置信度答案并缓存复核结果', async t => {
  const calls = [];
  const { post } = await start(t, { solver: async (_questions, options) => {
    calls.push(options.review === true);
    return { answers: [{ ...answer, confidence: options.review ? .6 : .5 }] };
  } });
  const request = { questions: [question], confidenceThreshold: .9 };
  const first = await (await post('/solve', request)).json();
  assert.deepEqual(calls, [false, true]);
  assert.equal(first.answers[0].confidence, .6);
  assert.deepEqual(first.review.outcomes, [{ id: 'q1', status: 'inconclusive' }]);
  const second = await (await post('/solve', request)).json();
  assert.deepEqual(second, first);
  assert.deepEqual(calls, [false, true]);
  assert.equal((await post('/solve', { ...request, confidenceThreshold: 2 })).status, 400);
});

test('活动请求期间拒绝切换配置，响应和事件记录隐藏密钥', async t => {
  let finish;
  const { base, post, logPath } = await start(t, { env: { AGENT_API_KEY: 'fixture-sensitive' }, solver: () => new Promise((resolve, reject) => { finish = () => reject(new Error('provider fixture-sensitive failed')); }) });
  const pending = post('/solve', { questions: [question] });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await post('/config', { provider: 'deepseek' })).status, 409);
  finish();
  assert.ok(!(await (await pending).text()).includes('fixture-sensitive'));
  await post('/event', { type: 'blocked', detail: 'fixture-sensitive fixture-token' });
  const log = await readFile(logPath, 'utf8');
  assert.ok(!log.includes('fixture-sensitive'));
  assert.ok(!log.includes('fixture-token'));
  const malformed = await fetch(base + '/config', { method: 'POST', headers, body: '{"apiKey":"new-unrecognized-secret"' });
  assert.ok(!(await malformed.text()).includes('new-unrecognized-secret'));
});

test('题库仅采纳高匹配有效答案，只让 AI 处理剩余题并恢复原顺序', async () => {
  const questions = [question, { ...question, id: 'q2' }, { ...question, id: 'q3' }, { ...question, id: 'q4' }];
  let missing;
  const result = await solveWithLookup(questions, {
    lookup: async () => ({ answers: [
      { ...answer, matchScore: 0.99 },
      { ...answer, id: 'q2', matchScore: 0.5 },
      { ...answer, id: 'q3', values: ['unknown'], matchScore: 1 },
      { ...answer, id: 'q4', matchScore: 1 }, { ...answer, id: 'q4', values: ['A'], matchScore: 1 },
    ] }),
    solver: async questions => { missing = questions.map(q => q.id); return { answers: [...questions].reverse().map(q => ({ ...answer, id: q.id })) }; },
  });
  assert.deepEqual(missing, ['q2', 'q3', 'q4']);
  assert.deepEqual(result.answers.map(a => a.id), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(result.lookup, { status: 'complete', hits: 1, misses: 3 });
  assert.equal(result.sources[0].source, 'question_bank');
  assert.equal(result.sources[1].source, 'ai');
  const onlyBank = await solveWithLookup([question], { lookup: async () => ({ answers: [{ ...answer, matchScore: 1 }] }), solver: () => { throw new Error('AI must not be called'); } });
  assert.equal(onlyBank.lookup.hits, 1);
});

test('题库故障转 AI；用户取消后不继续启动 AI', async () => {
  const result = await solveWithLookup([question], { lookup: async () => { throw new Error('private bank error'); }, solver: async () => ({ answers: [answer] }) });
  assert.equal(result.lookup.status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('private bank error'));
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(solveWithLookup([question], { signal: controller.signal, lookup: async () => { controller.abort(); throw new Error('canceled'); }, solver: () => { calls++; } }));
  assert.equal(calls, 0);
});

test('本地题库按文字精确匹配并映射乱序选项，冲突答案不采纳', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-bank-'));
  const path = join(dir, 'bank.json');
  const entry = { question: { ...question, options: [{ key: 'A', text: '4' }, { key: 'B', text: '3' }] }, answer: { ...answer, values: ['A'] } };
  assert.deepEqual(matchLocalEntry(question, entry).values, ['B']);
  assert.equal(matchLocalEntry({ ...question, text: '2 + 3 = ?' }, entry), undefined);
  assert.equal(matchLocalEntry(question, { ...entry, context: { programmingLanguage: 'Python' } }, { programmingLanguage: 'C' }), undefined);
  const lookup = createQuestionBankLookup({ path, env: {} });
  assert.equal(await lookup([question], {}), undefined);
  await writeFile(path, JSON.stringify({ entries: [entry] }));
  assert.deepEqual((await lookup([question], {})).answers[0].values, ['B']);
  await writeFile(path, JSON.stringify({ entries: [entry, { ...entry, answer: { ...answer, values: ['B'] } }] }));
  assert.deepEqual((await lookup([question], {})).answers, []);
});

test('授权题库通用适配器只传当前缺失题目，使用独立密钥且保留匹配度', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-bank-http-'));
  let observed;
  const provider = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    observed = { body: JSON.parse(data), auth: req.headers.authorization };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answers: [{ ...answer, matchScore: 0.98 }] }));
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const lookup = createQuestionBankLookup({ path: join(dir, 'missing.json'), env: { QUESTION_BANK_URL: `http://127.0.0.1:${provider.address().port}/lookup`, QUESTION_BANK_API_KEY: 'fixture-bank-key' } });
  const result = await lookup([question], { context: { courseTitle: '数学' } });
  assert.deepEqual(observed.body.questions, [question]);
  assert.equal(observed.auth, 'Bearer fixture-bank-key');
  assert.equal(result.answers[0].matchScore, 0.98);
});

test('添加本地题库后旧 AI 缓存失效，题库可直接接管下次请求', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-bank-cache-'));
  const path = join(dir, 'bank.json');
  let calls = 0;
  const lookup = createQuestionBankLookup({ path, env: {} });
  const { post } = await start(t, { lookup, solver: async () => { calls++; return { answers: [answer] }; } });
  assert.equal((await post('/solve', { questions: [question] })).status, 200);
  assert.equal(calls, 1);
  await writeFile(path, JSON.stringify({ entries: [{ question, answer }] }));
  const result = await (await post('/solve', { questions: [question] })).json();
  assert.equal(result.sources[0].source, 'question_bank');
  assert.equal(calls, 1);
});

test('远程题库故障仍保留本地命中，且故障结果不进入缓存', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-bank-outage-'));
  const path = join(dir, 'bank.json');
  await writeFile(path, JSON.stringify({ entries: [{ question, answer }] }));
  // An invalid non-HTTPS URL fails locally; no external request is performed.
  const lookup = createQuestionBankLookup({ path, env: { QUESTION_BANK_URL: 'http://remote.invalid/lookup' } });
  const q2 = { ...question, id: 'q2', text: '3 + 3 = ?' };
  let calls = 0;
  const { post } = await start(t, { lookup, env: { QUESTION_BANK_PROVIDER: 'generic' }, solver: async questions => {
    calls++; assert.deepEqual(questions.map(q => q.id), ['q2']);
    return { answers: [{ ...answer, id: 'q2' }] };
  } });
  for (let i = 0; i < 2; i++) {
    const result = await (await post('/solve', { questions: [question, q2] })).json();
    assert.equal(result.sources[0].source, 'question_bank');
    assert.deepEqual(result.lookup, { status: 'unavailable', hits: 1, misses: 1 });
  }
  assert.equal(calls, 2);
});
