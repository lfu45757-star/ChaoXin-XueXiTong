import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createAgentServer } from '../server.mjs';
import { solve, validateQuestions, validateAnswers, validateContext, promptFor } from '../lib/solver.mjs';

const questions = [{ id: '1', type: 'single', text: '2 + 2 = ?', slots: 0, options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }] }];
const answer = { answers: [{ id: '1', values: ['B'], confidence: 0.99, explanation: '加法' }] };
test('拒绝重复题目、未知选项、错误填空数和越界置信度', () => {
  assert.throws(() => validateQuestions({ questions: [questions[0], questions[0]] }));
  assert.throws(() => validateAnswers({ answers: [{ ...answer.answers[0], values: ['Z'] }] }, questions));
  assert.throws(() => validateAnswers({ answers: [{ ...answer.answers[0], confidence: 2 }] }, questions));
  assert.throws(() => validateAnswers({ answers: [{ ...answer.answers[0], values: ['x'] }] }, [{ ...questions[0], type: 'blank', options: [], slots: 2 }]));
  assert.deepEqual(validateAnswers(answer, questions), answer);
});

test('课程上下文校验限长及语言，提示保留课程与题目语言优先规则', () => {
  assert.deepEqual(validateContext(), { courseTitle: '', chapterTitle: '', programmingLanguage: 'auto' });
  assert.throws(() => validateContext(null));
  assert.throws(() => validateContext({ courseTitle: 'x'.repeat(501) }));
  assert.throws(() => validateContext({ chapterTitle: 1 }));
  assert.throws(() => validateContext({ programmingLanguage: 'Go' }));
  assert.throws(() => validateContext({ extra: 'unexpected' }));
  for (const programmingLanguage of ['auto', 'Python', 'C', 'C++', 'Java', 'JavaScript']) assert.equal(validateContext({ programmingLanguage }).programmingLanguage, programmingLanguage);
  const prompt = promptFor(questions, { courseTitle: 'Python 程序设计', chapterTitle: '循环', programmingLanguage: 'Python' });
  assert.match(prompt, /明确指定语言时以题目为准/);
  assert.match(prompt, /题目未指定时/);
  assert.match(prompt, /"programmingLanguage":"Python"/);
  assert.match(prompt, /Python 程序设计/);
});

test('HTTP 配对、真实请求解析、答案去重、事件记录', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-agent-test-'));
  const logPath = join(dir, 'events.jsonl');
  let calls = 0;
  const server = createAgentServer({ token: 'test-token', logPath, configPath: join(dir, 'provider.json'), env: {}, lookup: null, solver: async qs => { calls++; assert.deepEqual(qs, questions); return answer; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/health')).status, 401);
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  assert.equal((await (await fetch(base + '/health', { headers })).json()).ok, true);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + '/solve', { method: 'POST', headers, body: JSON.stringify({ questions }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), answer);
  }
  assert.equal(calls, 1);
  assert.equal((await fetch(base + '/solve', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/solve', { method: 'POST', headers, body: JSON.stringify({ questions: [] }) })).status, 400);
  assert.equal((await fetch(base + '/event', { method: 'POST', headers, body: JSON.stringify({ type: 'submitted', detail: 'fixture-only' }) })).status, 200);
  assert.equal(JSON.parse((await readFile(logPath, 'utf8')).trim()).detail, 'fixture-only');
});

test('并发请求不会启动多个 agent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-concurrent-'));
  let finish;
  const server = createAgentServer({ token: 'test', configPath: join(dir, 'provider.json'), env: {}, lookup: null, solver: () => new Promise(resolve => { finish = resolve; }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/solve`;
  const request = { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ questions }) };
  const pending = fetch(url, request);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await fetch(url, request)).status, 429);
  finish(answer); assert.equal((await pending).status, 200);
});

test('服务拒绝 agent 返回未提供的选项', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-invalid-answer-'));
  const server = createAgentServer({ token: 'test', configPath: join(dir, 'provider.json'), env: {}, lookup: null, solver: async () => ({ answers: [{ ...answer.answers[0], values: ['Z'] }] }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/solve`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ questions }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /不存在/);
});

test('服务传递规范化上下文，缓存区分语言课程并允许 checkpoint_reset 事件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-agent-context-'));
  const logPath = join(dir, 'events.jsonl'), seen = [];
  const server = createAgentServer({ token: 'test', logPath, configPath: join(dir, 'provider.json'), env: {}, lookup: null, solver: async (qs, options) => { seen.push(options.context); return answer; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
  const post = body => fetch(base + '/solve', { method: 'POST', headers, body: JSON.stringify({ questions, ...body }) });
  for (const context of [undefined, {}, { programmingLanguage: 'C' }, { programmingLanguage: 'Python' }, { programmingLanguage: 'Python', courseTitle: 'Python基础' }]) assert.equal((await post({ context })).status, 200);
  assert.equal(seen.length, 4);
  assert.equal(seen[2].programmingLanguage, 'Python');
  assert.equal(seen[3].courseTitle, 'Python基础');
  assert.equal((await post({ context: { programmingLanguage: 'Go' } })).status, 400);
  assert.equal(seen.length, 4);
  const event = await fetch(base + '/event', { method: 'POST', headers, body: JSON.stringify({ type: 'checkpoint_reset', detail: 'fixture-only' }) });
  assert.equal(event.status, 200);
  assert.equal(JSON.parse((await readFile(logPath, 'utf8')).trim()).type, 'checkpoint_reset');
});

test('HTTP agent 适配器发送结构化协议并解析返回答案', async t => {
  let observed;
  const provider = http.createServer(async (req,res) => {
    let data='';for await (const chunk of req)data+=chunk;
    observed={path:req.url,body:JSON.parse(data),authorization:req.headers.authorization};
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const result=await solve(questions,{context:{courseTitle:'Python基础',chapterTitle:'循环',programmingLanguage:'Python'},env:{AGENT_PROVIDER:'http',AGENT_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`,AGENT_MODEL:'fixture',AGENT_API_KEY:'fixture-key'}});
  assert.deepEqual(result,answer);
  assert.equal(observed.path,'/v1/chat/completions');
  assert.equal(observed.body.response_format.json_schema.strict,true);
  assert.equal(observed.authorization,'Bearer fixture-key');
  assert.match(observed.body.messages[0].content,/2 \+ 2/);
  assert.match(observed.body.messages[0].content,/"programmingLanguage":"Python"/);
  assert.match(observed.body.messages[0].content,/Python基础/);
});
