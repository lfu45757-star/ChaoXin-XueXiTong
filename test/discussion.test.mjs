import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import { createAgentServer } from '../server.mjs';

test('讨论接口按教师题目和所选AI生成，不查询题库；必须认证并校验返回', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx-discussion-'));
  const reply = 'Online communication can help people understand each other, but trust also requires time, honesty and shared experiences.';
  let seen, calls = 0;
  const server = createAgentServer({ token: 'fixture', configPath: join(dir, 'provider.json'), env: {},
    lookup: () => { throw Error('must not query a question bank'); }, solver: async (questions, options) => {
      calls++; seen = { questions, options };
      return { answers: [{ id: 'discussion', values: [reply], confidence: .95, explanation: 'fixture' }] };
    } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/discussion`;
  const topic = 'Do you believe people can truly get to know each other simply via online communication? Why or why not?';
  const request = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' }, body: JSON.stringify({ topic }) };
  assert.equal((await fetch(url, { ...request, headers: { 'Content-Type': 'application/json' } })).status, 401);
  const response = await fetch(url, request);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { reply, confidence: .95 });
  assert.ok(seen.questions[0].text.includes(topic)); assert.ok(seen.questions[0].text.includes('题目语言'));
  assert.equal(seen.options.env.AGENT_PROVIDER, 'codex'); assert.equal(calls, 1);
  assert.equal((await fetch(url, { ...request, body: JSON.stringify({ topic: '' }) })).status, 400);
  assert.equal(calls, 1);
});

async function background({ offline = false } = {}) {
  const local = { config: { token: 'fixture' } }, sessions = {}, created = [], removed = [], reloaded = [], fetched = [];
  let listener, updated, closed;
  const area = data => ({ get: async keys => structuredClone(keys === null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: async value => Object.assign(data, structuredClone(value)), remove: async key => { delete data[key]; } });
  const chrome = { runtime: { id: 'fixture', onMessage: { addListener: fn => listener = fn } },
    storage: { local: area(local), session: area(sessions) }, alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener() {} } },
    tabs: { get: async id => ({ id, url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=fixture' }), sendMessage: async () => {},
      create: async options => { const tab = { id: 50 + created.length, ...options }; created.push(tab); return tab; }, update: async () => {},
      reload: async id => reloaded.push(id), remove: async id => removed.push(id), onUpdated: { addListener: fn => updated = fn }, onRemoved: { addListener: fn => closed = fn } } };
  const fetch = async (url, options) => { fetched.push(url); if (offline) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => ({ ok: true, version: '0.2.2' }) }; };
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), { chrome, fetch, URL, Date, Map, Set, String, Number, AbortSignal, AbortController });
  const send = (message, tabId, frameId = 0, url) => new Promise(resolve => listener(message, tabId === undefined ? { id: 'fixture' } : { id: 'fixture', tab: { id: tabId }, frameId, url }, resolve));
  return { send, sessions, created, removed, reloaded, fetched, updated, closed };
}
const key = 'https://mooc1.chaoxing.com/ananas/modules/discuss/index.html?task=fixture';
const href = 'https://groupweb.chaoxing.com/course/topic/v3/bbs/fixture/replysList';
test('讨论子页只创建一次并绑定原课程；确认发布后只刷新原课程', async () => {
  const f = await background(); await f.send({ type: 'control', tabId: 7, enabled: true });
  const [a, b] = await Promise.all([f.send({ type: 'openDiscussion', key, href }, 7, 1), f.send({ type: 'openDiscussion', key, href }, 7, 2)]);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(f.created.length, 1); assert.equal(f.created[0].active, false);
  assert.equal(f.sessions['tab:50'].parentTab, 7);
  assert.equal((await f.send({ type: 'finishDiscussion', key, status: 'submitted', reason: 'receipt' }, 50, 0, href)).ok, true);
  assert.deepEqual(f.reloaded, [7]); assert.deepEqual(f.removed, [50]);
  assert.equal(f.sessions['tab:7'].discussions[key].status, 'submitted');
});
test('不同题目跳转不能发布或认作原讨论完成；停止原课程同时停止子页', async () => {
  const f = await background(); await f.send({ type: 'control', tabId: 7, enabled: true });
  await f.send({ type: 'openDiscussion', key, href }, 7, 1);
  const other = href.replace('fixture', 'other');
  assert.equal((await f.send({ type: 'discussion', key, topic: 'another topic' }, 50, 0, other)).ok, false);
  assert.equal((await f.send({ type: 'finishDiscussion', key, status: 'submitted' }, 50, 0, other)).ok, false);
  await f.send({ type: 'control', tabId: 7, enabled: false });
  assert.equal(f.sessions['tab:50'].enabled, false); assert.ok(f.removed.includes(50)); assert.deepEqual(f.reloaded, []);
});
test('无法进入/被关闭的讨论只跳过，不刷新、不记作平台完成', async () => {
  const f = await background(); await f.send({ type: 'control', tabId: 7, enabled: true });
  assert.equal((await f.send({ type: 'openDiscussion', key, href: 'https://evil.example/replysList' }, 7)).ok, false);
  await f.send({ type: 'openDiscussion', key, href }, 7);
  await f.closed(50);
  assert.equal(f.sessions['tab:7'].discussions[key].status, 'skipped'); assert.deepEqual(f.reloaded, []);
});
test('服务离线返回可操作诊断，健康检查不接受课程页面消息', async () => {
  const f = await background({ offline: true });
  const result = await f.send({ type: 'health' });
  assert.equal(result.ok, false); assert.match(result.error, /18765.*start\.cmd/);
  assert.equal((await f.send({ type: 'health' }, 7)).ok, false);
});

test('讨论与原课程共享执行锁，子页结束立即释放锁', async () => {
  const f = await background(); await f.send({ type: 'control', tabId: 7, enabled: true });
  await f.send({ type: 'openDiscussion', key, href }, 7, 1);
  assert.equal((await f.send({ type: 'claimTask', key: 'document' }, 7, 2)).value.ok, true);
  assert.equal((await f.send({ type: 'claimTask', key: 'discussion:' + key }, 50, 0)).value.ok, false);
  await f.send({ type: 'releaseTask', key: 'document' }, 7, 2);
  assert.equal((await f.send({ type: 'claimTask', key: 'discussion:' + key }, 50, 0)).value.ok, true);
  await f.send({ type: 'report', value: { mode: 'discussion', busy: false } }, 50, 0, href);
  assert.equal((await f.send({ type: 'claimTask', key: 'document' }, 7, 2)).value.ok, false);
  await f.send({ type: 'finishDiscussion', key, status: 'skipped', reason: 'fixture' }, 50, 0, href);
  assert.equal((await f.send({ type: 'claimTask', key: 'document' }, 7, 2)).value.ok, true);
});

test('insertbbs 内层题目身份被接受，同址外框的不同题目不会被后台去重', async () => {
  const f = await background(); await f.send({ type: 'control', tabId: 7, enabled: true });
  const keys = [101,102,103].map(id => `https://mooc1.chaoxing.com/mooc-ans/bbscircle/chapter?courseid=12345&mtopicid=${id}`);
  for (const [index, topicKey] of keys.entries()) {
    const target = href.replace('fixture',String(index));
    assert.equal((await f.send({ type:'openDiscussion', key:topicKey, href:target },7,index+1)).ok,true);
  }
  assert.equal(Object.keys(f.sessions['tab:7'].discussions).length,3);
  assert.equal(f.created.length,3);
  assert.equal(new Set(Object.values(f.sessions['tab:7'].discussions).map(record => record.childTab)).size,3);
  assert.equal((await f.send({type:'openDiscussion',key:keys[0],href},7,9)).ok,true);
  assert.equal(f.created.length,3);
  assert.equal((await f.send({type:'openDiscussion',key:keys[0].replace(/mtopicid=\d+/,'mtopicid=bad'),href},7)).ok,false);
});

test('适配升级只重试旧识别失败，不清除未知发布、已发布或新版跳过记录', async () => {
  const f = await background(); await f.send({type:'control',tabId:7,enabled:true});
  f.sessions['tab:7'].discussions = {
    missing:{status:'skipped',reason:'无法完整识别教师题目、回复编辑区或发布入口，已跳过讨论'},
    entry:{status:'skipped',reason:'未找到可进入的讨论页面，保留未完成标记并跳过'},
    uncertain:{status:'skipped',reason:'讨论发布回执未确认，已跳过且不会重复发布'},
    done:{status:'submitted',reason:'平台页面已出现对应回复'},
    draft:{status:'skipped',reason:'讨论编辑区已有内容，已保留并跳过自动发布'},
    current:{status:'skipped',reason:'无法识别唯一发布入口，已跳过讨论',revision:3}
  };
  const result=await f.send({type:'discussionStatus'},7);
  assert.deepEqual(Object.keys(result.value).sort(),['current','done','draft','uncertain']);
});
