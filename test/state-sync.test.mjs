import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=fixture';
async function setup({ sessions = {}, local = { config: { token: 'fixture' } } } = {}) {
  let listener, remove, update, alarm;
  const power = [], notifications = [], requests = [];
  const area = data => ({
    get: async keys => structuredClone(keys === null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]))),
    set: async value => Object.assign(data, structuredClone(value)),
    remove: async keys => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  });
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: fn => listener = fn } },
    storage: { local: area(local), session: area(sessions) },
    power: { requestKeepAwake: level => power.push(level), releaseKeepAwake: () => power.push('release') },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: fn => alarm = fn } },
    tabs: { get: async id => ({ id, url }), sendMessage: async (id, message) => notifications.push({ id, message }),
      onRemoved: { addListener: fn => remove = fn }, onUpdated: { addListener: fn => update = fn } }
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ provider: 'http', hasApiKey: true }) };
  };
  vm.runInNewContext(source, { chrome, fetch, URL, Date, Map, Set, String, Number, AbortSignal, AbortController });
  const send = (message, frame, id = 7) => new Promise(resolve => listener(message, frame === undefined ? { id: 'fixture' } : { id: 'fixture', tab: { id }, frameId: frame }, resolve));
  await new Promise(resolve => setImmediate(resolve));
  return { send, sessions, local, power, notifications, requests, remove, update, alarm };
}

test('子帧逐题进度立即保存，顶层心跳不能盖掉，后台重启后弹窗仍可恢复', async () => {
  const f = await setup();
  await f.send({ type: 'control', tabId: 7, enabled: true });
  await f.send({ type: 'claimTask', key: 'quiz' }, 2);
  const progress = { kind: 'quiz', phase: 'filled', current: 2, total: 5, filled: 2 };
  await f.send({ type: 'report', value: { mode: 'quiz', status: '已填写并校验 2/5 题', taskTitle: 'U1-Words in use', busy: true, progress } }, 2);
  await f.send({ type: 'report', value: { mode: 'page', status: '等待任务', route: 'fixture' } }, 0);
  assert.equal(f.sessions['tab:7'].last, 'U1-Words in use · 已填写并校验 2/5 题');
  assert.deepEqual(f.sessions['tab:7'].progress, progress);
  const restarted = await setup({ sessions: f.sessions, local: f.local });
  const state = (await restarted.send({ type: 'popupState', tabId: 7 })).value;
  assert.equal(state.enabled, true); assert.equal(state.last, 'U1-Words in use · 已填写并校验 2/5 题');
  assert.equal(state.frames.length, 2); assert.equal(state.stale, false);
  assert.equal(restarted.power.at(-1), 'system');
  await restarted.send({ type: 'control', tabId: 7, enabled: false });
  await restarted.send({ type: 'report', value: { mode: 'quiz', status: '迟到报告', busy: true, progress } }, 2);
  assert.equal(restarted.sessions['tab:7'].last, '已停止');
  assert.equal(restarted.sessions['tab:7'].enabled, false);
  assert.equal(restarted.power.at(-1), 'release');
});

test('过期报告明确标记 stale，页面加载清除旧进度但保持托管', async () => {
  const f = await setup({ sessions: { 'tab:7': { enabled: true, course: 'fixture', last: '旧进度',
    frames: [{ frameId: 2, at: Date.now() - 20000, status: '旧进度', mode: 'quiz' }] } } });
  assert.equal((await f.send({ type: 'popupState', tabId: 7 })).value.stale, true);
  await f.update(7, { status: 'loading' });
  const state = (await f.send({ type: 'popupState', tabId: 7 })).value;
  assert.equal(state.enabled, true); assert.equal(state.frames.length, 0); assert.equal(state.progress, null);
  assert.match(state.last, /加载/);
});

test('多个阻塞练习轮流上报时弹窗固定显示同一题并显示待处理数量', async () => {
  const f = await setup();
  await f.send({ type: 'control', tabId: 7, enabled: true });
  const blocked = (taskTitle) => ({ mode: 'blocked', status: '上次提交结果尚未确认', taskTitle, busy: false });
  await f.send({ type: 'report', value: blocked('U1-Expressions in use') }, 3);
  await f.send({ type: 'report', value: blocked('U1-Words in use') }, 2);
  assert.equal(f.sessions['tab:7'].last, '2 个练习待处理 · U1-Words in use · 上次提交结果尚未确认');
  await f.send({ type: 'report', value: blocked('U1-Expressions in use') }, 3);
  assert.equal(f.sessions['tab:7'].last, '2 个练习待处理 · U1-Words in use · 上次提交结果尚未确认');
});

test('防休眠只在托管时保持，多个标签停止/关闭/离开课程和开关设置正确释放', async () => {
  const f = await setup();
  assert.equal(f.power.at(-1), 'release');
  await f.send({ type: 'control', tabId: 7, enabled: true });
  await f.send({ type: 'control', tabId: 8, enabled: true });
  assert.equal(f.power.at(-1), 'system');
  assert.equal(f.notifications.length, 2);
  await f.send({ type: 'control', tabId: 7, enabled: false });
  assert.equal(f.power.at(-1), 'system');
  await f.remove(8); assert.equal(f.power.at(-1), 'release');
  await f.send({ type: 'control', tabId: 7, enabled: true });
  const settings = { token: 'fixture', confidence: 0.85, autoSubmit: true, nextSelector: '', completeSelector: '', keepAwake: false, documentMode: 'fast' };
  assert.equal((await f.send({ type: 'saveConfig', value: settings })).ok, true);
  assert.equal(f.power.at(-1), 'release');
  await f.send({ type: 'saveConfig', value: { ...settings, keepAwake: true } });
  assert.equal(f.power.at(-1), 'system');
  await f.update(7, { url: 'https://example.com' });
  assert.equal(f.sessions['tab:7'].enabled, false); assert.equal(f.power.at(-1), 'release');
});

test('AI 配置只接受扩展弹窗，content 消息不能读写后端密钥配置', async () => {
  const f = await setup();
  assert.equal((await f.send({ type: 'providerConfig' })).value.hasApiKey, true);
  const before = f.requests.length;
  assert.equal((await f.send({ type: 'providerConfig' }, 1)).ok, false);
  assert.equal((await f.send({ type: 'saveProviderConfig', value: {} }, 1)).ok, false);
  assert.equal(f.requests.length, before);
  assert.equal((await f.send({ type: 'saveProviderConfig', value: { provider: 'http', apiKey: 'fixture-key' } })).ok, true);
  assert.equal(JSON.parse(f.requests.at(-1).options.body).apiKey, 'fixture-key');
  assert.equal(JSON.stringify((await f.send({ type: 'config' }, 1)).value).includes('fixture-key'), false);
});
