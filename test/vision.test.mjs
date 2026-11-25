import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuestions, promptFor, solve } from '../lib/solver.mjs';
import { solveWithLookup } from '../lib/answer-pipeline.mjs';
import { configFromEnv, normalizeProviderConfig } from '../lib/agent-config.mjs';
import { createProviderConfigStore } from '../lib/agent-config.mjs';
import { createAgentServer } from '../server.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uN8AAAAASUVORK5CYII=';
const question = { id: '1', type: 'single', text: '请选择图中结果', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], slots: 0,
  images: [{ label: '题干', dataUrl }] };
const answer = { id: '1', values: ['B'], confidence: .9, explanation: 'fixture' };

test('图片格式受限，提示词不含 base64，图片题不交给题库', async () => {
  assert.deepEqual(validateQuestions({ questions: [question] }), [question]);
  assert.doesNotMatch(promptFor([question], {}), /iVBORw0KGgo/);
  assert.throws(() => validateQuestions({ questions: [{ ...question, images: [{ label: '题干', dataUrl: 'data:text/html;base64,YQ==' }] }] }), /图片无效/);
  let lookedUp = false, solved = false;
  const result = await solveWithLookup([question], { lookup: async () => { lookedUp = true; }, solver: async () => { solved = true; return { answers: [answer] }; } });
  assert.equal(lookedUp, false); assert.equal(solved, true); assert.deepEqual(result.answers, [answer]);
});

test('兼容 API 识图默认关闭，明确授权后仅将当前题图发送到已配置端点', async () => {
  const env = { AGENT_PROVIDER: 'http', AGENT_BASE_URL: 'https://fixture.example/v1', AGENT_MODEL: 'vision-fixture' };
  let calls = 0, observed;
  const fetchImpl = async (url, request) => {
    calls++; observed = { url: String(url), body: JSON.parse(request.body) };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ answers: [answer] }) } }] });
  };
  await assert.rejects(solve([question], { env, fetchImpl }), /尚未授权/);
  assert.equal(calls, 0);
  assert.deepEqual((await solve([question], { env: { ...env, AGENT_ALLOW_VISION_API: '1' }, fetchImpl })).answers, [answer]);
  assert.equal(observed.url, 'https://fixture.example/v1/chat/completions');
  assert.deepEqual(observed.body.messages[0].content.at(-1), { type: 'image_url', image_url: { url: dataUrl } });
  assert.equal(observed.body.messages[0].content[0].text.includes(dataUrl), false);
});

test('AI 助手模式和 API 图片授权可保存，切换地址后取消旧授权', () => {
  const config = normalizeProviderConfig({ provider: 'http', baseUrl: 'https://fixture.example/v1', model: 'vision-fixture', solveMode: 'assistant', allowVisionApi: true });
  assert.equal(config.solveMode, 'assistant'); assert.equal(config.allowVisionApi, true);
  assert.equal(normalizeProviderConfig({ baseUrl: 'https://other.example/v1' }, config).allowVisionApi, false);
  assert.equal(configFromEnv({ AGENT_SOLVE_MODE: 'assistant' }).solveMode, 'assistant');
});

test('服务端 AI 助手模式绕过题库，图片 API 未授权时不调用模型', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cx-vision-'));
  const store = createProviderConfigStore({ path: join(directory, 'provider.json'), env: {} });
  await store.update({ provider: 'http', baseUrl: 'https://fixture.example/v1', model: 'vision-fixture', solveMode: 'assistant' });
  let lookupCalls = 0, solverCalls = 0;
  const server = createAgentServer({ token: 'fixture-token', configStore: store, lookup: async () => { lookupCalls++; return { answers: [] }; },
    solver: async () => { solverCalls++; return { answers: [answer] }; }, logPath: join(directory, 'events.jsonl') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = questions => fetch(`http://127.0.0.1:${server.address().port}/solve`, { method: 'POST',
    headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ questions }) });
  assert.equal((await post([question])).status, 400);
  assert.equal(solverCalls, 0); assert.equal(lookupCalls, 0);
  await store.update({ allowVisionApi: true });
  assert.equal((await post([{ ...question, images: undefined }])).status, 200);
  assert.equal(solverCalls, 1); assert.equal(lookupCalls, 0);
});
