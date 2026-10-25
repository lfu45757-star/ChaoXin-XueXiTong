import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('worker alarm wakes managed background tabs and stops after management ends', async () => {
  let onAlarm;
  const sent = [], cleared = [];
  const sessions = { 'tab:7': { enabled: true } };
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: () => {} } },
    storage: {
      local: { get: async () => ({ config: { keepAwake: false } }) },
      session: { get: async key => key === null ? sessions : { [key]: sessions[key] } }
    },
    alarms: { clear: async name => { cleared.push(name); }, onAlarm: { addListener: fn => { onAlarm = fn; } } },
    tabs: { sendMessage: async (id, message) => { sent.push({ id, message }); },
      onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } }
  };
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'),
    { chrome, fetch: async () => ({}), URL, Date, Map, Set, String, Number, AbortSignal, AbortController });
  await onAlarm({ name: 'keep:7' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ id: 7, message: { type: 'heartbeat' } }]);
  sessions['tab:7'].enabled = false;
  await onAlarm({ name: 'keep:7' });
  assert.deepEqual(cleared, ['keep:7']);
  assert.equal(sent.length, 1);
});

test('managed tab is protected from automatic discard and its prior setting is restored', async () => {
  let onMessage;
  const updates = [], sessions = {}, page = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=fixture';
  let frozen = false;
  const storage = data => ({
    get: async key => key === null ? data : { [key]: data[key] },
    set: async value => Object.assign(data, value),
    remove: async key => { delete data[key]; }
  });
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: fn => { onMessage = fn; } } },
    storage: { local: storage({ config: { token: 'fixture', keepAwake: false } }), session: storage(sessions) },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    tabs: { get: async id => ({ id, url: page, autoDiscardable: true, frozen }),
      update: async (id, properties) => { updates.push([id, properties.autoDiscardable]); },
      sendMessage: async () => {}, onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } }
  };
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'),
    { chrome, fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }), URL, Date, Map, Set, String, Number, AbortSignal, AbortController });
  const send = message => new Promise(resolve => onMessage(message, { id: 'fixture' }, resolve));
  await send({ type: 'control', tabId: 7, enabled: true });
  frozen = true;
  const popup = await send({ type: 'popupState', tabId: 7 });
  assert.match(popup.value.last, /已冻结/);
  assert.equal(popup.value.stale, true);
  await send({ type: 'control', tabId: 7, enabled: false });
  assert.deepEqual(updates, [[7, false], [7, true]]);
});

test('completed chapter recovers a missing top frame once while incomplete or active work stays put', async () => {
  let listener, now = 100000;
  const reloaded = [], sessions = {}, local = { config: { token: 'fixture' } };
  class TestDate extends Date { static now() { return now; } }
  const storage = data => ({
    get: async key => ({ [key]: data[key] }),
    set: async value => Object.assign(data, value),
    remove: async key => { delete data[key]; }
  });
  const page = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=chapter-a&courseId=course-a';
  const cards = 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?knowledgeid=chapter-a&courseid=course-a';
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: storage(local), session: storage(sessions) },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    tabs: { get: async id => ({ id, url: page }), reload: async id => { reloaded.push(id); },
      onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } }
  };
  const fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'),
    { chrome, fetch, URL, Date: TestDate, Map, Set, String, Number, AbortSignal, AbortController });
  const send = (message, tabId, frameId) => new Promise(resolve => listener(message,
    frameId === undefined ? { id: 'fixture' } : { id: 'fixture', tab: { id: tabId }, frameId }, resolve));
  for (const tabId of [7, 8, 9, 10]) await send({ type: 'control', tabId, enabled: true }, tabId);
  const report = (tabId, frameId, value) => send({ type: 'report', value }, tabId, frameId);
  const complete = { mode: 'page', busy: false, cardsReady: true, url: cards,
    jobTotal: 2, jobDone: 2, trackedJobTotal: 2, status: 'all done' };
  await report(7, 1, complete);
  await report(8, 1, { ...complete, jobDone: 1 });
  await report(9, 0, { mode: 'page', url: page, status: 'top present' });
  await report(9, 1, complete);
  await report(10, 2, { mode: 'submitting', busy: true, url: cards });
  await report(10, 1, complete);
  assert.deepEqual(reloaded, []);
  now += 13000;
  for (const tabId of [7, 8, 9, 10]) await report(tabId, 1, tabId === 8 ? { ...complete, jobDone: 1 } : complete);
  assert.deepEqual(reloaded, [7]);
  now += 13000;
  await report(7, 1, complete);
  assert.deepEqual(reloaded, [7]);
});

test('后台按 frame 串行执行任务，iframe 局部导航取消旧请求并释放占用', async () => {
  let listener, solveStarted=false;
  const local={config:{token:'fixture',confidence:0.85,autoSubmit:true,nextSelector:'',completeSelector:''}}, sessions={};
  const storage=data=>({get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value),remove:async key=>{delete data[key];}});
  const chrome={
    runtime:{id:'fixture',onMessage:{addListener:fn=>{listener=fn;}}},
    storage:{local:storage(local),session:storage(sessions)},
    alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:()=>{}}},
    tabs:{get:async id=>({id,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=fixture'}),onRemoved:{addListener:()=>{}},onUpdated:{addListener:()=>{}}}
  };
  const fetch=async(url,options)=>{
    if(url.endsWith('/solve')){
      solveStarted=true;
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('fixture cancellation')),{once:true}));
    }
    return {ok:true,json:async()=>({ok:true})};
  };
  vm.runInNewContext(await readFile(new URL('../extension/background.js',import.meta.url),'utf8'),{chrome,fetch,URL,Date,Map,Set,String,Number,AbortSignal,AbortController});
  const send=(message,frameId)=>new Promise(resolve=>listener(message,frameId===undefined?{id:'fixture'}:{id:'fixture',tab:{id:7},frameId},resolve));
  assert.equal((await send({type:'control',tabId:7,enabled:true})).ok,true);
  assert.equal((await send({type:'claimTask',key:'media'},1)).value.ok,true);
  assert.equal((await send({type:'claimTask',key:'work'},2)).value.ok,false);
  await send({type:'releaseTask',key:'media'},2);
  assert.equal((await send({type:'claimTask',key:'work'},2)).value.ok,false);
  await send({type:'report',value:{route:'chapter-a',status:'running'}},0);
  await send({type:'report',value:{route:'chapter-b',status:'next'}},0);
  assert.equal((await send({type:'claimTask',key:'work'},2)).value.ok,true);
  const pending=send({type:'solve',key:'question',questions:[]},2);
  while(!solveStarted)await new Promise(resolve=>setTimeout(resolve,1));
  await send({type:'report',value:{route:'chapter-c',status:'next'}},0);
  assert.equal((await pending).ok,false);
  assert.equal((await send({type:'claimTask',key:'document'},3)).value.ok,true);
  await send({type:'report',value:{mode:'document',busy:true,status:'reading'}},3);
  assert.equal((await send({type:'claimTask',key:'media'},4)).value.ok,false);
  // A detached/removed media or document transitions to a page report. Those
  // reports must not keep an obsolete execution lock alive forever.
  await send({type:'report',value:{mode:'page',busy:false,status:'waiting'}},3);
  assert.equal((await send({type:'claimTask',key:'media'},4)).value.ok,true);
});

async function raceFixture({ beforeSet = async () => {}, beforeConfig = async () => {}, solveFetch = async () => ({ ok: true }), localValues = {}, eventFetch = () => {} } = {}) {
  let listener;
  const sessions = {}, local = { config: { token: 'fixture' }, ...localValues };
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: fn => { listener = fn; } } },
    storage: {
      local: {
        get: async key => { await beforeConfig(); return Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, structuredClone(local[name])])); },
        set: async value => Object.assign(local, value),
        remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete local[key]; }
      },
      session: {
        get: async key => ({ [key]: structuredClone(sessions[key]) }),
        set: async value => { await beforeSet(value); Object.assign(sessions, value); },
        remove: async key => { delete sessions[key]; }
      }
    },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    tabs: {
      get: async id => ({ id, url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=fixture' }),
      onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} }
    }
  };
  const fetch = async (url, options) => ({ ok: true, json: async () => {
    if (url.endsWith('/solve')) return solveFetch(options);
    if (url.endsWith('/event')) eventFetch(JSON.parse(options.body));
    return { ok: true };
  } });
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), { chrome, fetch, URL, Date, Map, Set, String, Number, AbortSignal, AbortController });
  const send = (message, frameId, tabId = 7) => new Promise(resolve => listener(message, frameId === undefined ? { id: 'fixture' } : { id: 'fixture', tab: { id: tabId }, frameId }, resolve));
  await send({ type: 'control', tabId: 7, enabled: true });
  // Flush the fire-and-forget start event before arming a delayed config read.
  await new Promise(resolve => setImmediate(resolve));
  return { send, sessions, local };
}

test('停止与延迟的顶层 heartbeat 交错时保持停止状态', async () => {
  let hold = false, releaseReport, reportStarted;
  const started = new Promise(resolve => { reportStarted = resolve; });
  const { send, sessions } = await raceFixture({ beforeSet: async value => {
    if (hold && value['tab:7']?.route) {
      hold = false; reportStarted(); await new Promise(resolve => { releaseReport = resolve; });
    }
  } });
  hold = true;
  const report = send({ type: 'report', value: { route: 'chapter-a', status: 'running', busy: false, mode: 'page' } }, 0);
  await started;
  const stop = send({ type: 'control', tabId: 7, enabled: false });
  await new Promise(resolve => setImmediate(resolve));
  releaseReport();
  assert.equal((await report).ok, true);
  assert.equal((await stop).ok, true);
  assert.equal(sessions['tab:7'].enabled, false);
  assert.equal((await send({ type: 'state' }, 0)).value.enabled, false);
  await send({ type: 'report', value: { route: 'chapter-a', status: 'old heartbeat' } }, 0);
  assert.equal(sessions['tab:7'].enabled, false);
  assert.equal(sessions['tab:7'].last, '已停止');
});

test('停止时尚未创建 controller 的 solve 不会随后调用服务', async () => {
  let hold = false, held = false, releaseConfig, configStarted, solves = 0;
  const started = new Promise(resolve => { configStarted = resolve; });
  const { send } = await raceFixture({
    beforeConfig: async () => {
      if (hold && !held) { held = true; configStarted(); await new Promise(resolve => { releaseConfig = resolve; }); }
    },
    solveFetch: async () => { solves++; return { answers: [] }; }
  });
  hold = true;
  const solve = send({ type: 'solve', key: 'delayed-config', questions: [] }, 1);
  await started;
  assert.equal((await send({ type: 'control', tabId: 7, enabled: false })).ok, true);
  releaseConfig();
  const reply = await solve;
  assert.equal(reply.ok, false);
  assert.match(reply.error, /停止|切换/);
  assert.equal(solves, 0);
});

test('停止会取消已在等待答复的 solve', async () => {
  let solveStarted;
  const started = new Promise(resolve => { solveStarted = resolve; });
  const { send } = await raceFixture({ solveFetch: async options => {
    solveStarted();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture cancellation')), { once: true }));
  } });
  const solve = send({ type: 'solve', key: 'active', questions: [] }, 1);
  await started;
  assert.equal((await send({ type: 'control', tabId: 7, enabled: false })).ok, true);
  assert.equal((await solve).ok, false);
});

test('同一课程重复或并发开始不会取消当前 solve 或清除任务锁', async () => {
  let started, finish, aborted = false;
  const began = new Promise(resolve => { started = resolve; });
  const { send, sessions } = await raceFixture({ solveFetch: options => new Promise((resolve, reject) => {
    finish = () => resolve({ answers: [] });
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture cancellation')); }, { once: true });
    started();
  }) });
  await send({ type: 'report', value: { route: 'chapter-a', status: 'agent 正在答题', mode: 'page' } }, 0);
  assert.equal((await send({ type: 'claimTask', key: 'quiz' }, 1)).value.ok, true);
  const before = structuredClone(sessions['tab:7']);
  const solve = send({ type: 'solve', key: 'quiz', questions: [] }, 1);
  await began;
  await send({ type: 'control', tabId: 7, enabled: true });
  await Promise.all([send({ type: 'control', tabId: 7, enabled: true }), send({ type: 'control', tabId: 7, enabled: true })]);
  finish();
  const reply = await solve;
  assert.equal(aborted, false);
  assert.equal(reply.ok, true);
  assert.deepEqual(sessions['tab:7'], before);
  assert.equal((await send({ type: 'claimTask', key: 'other' }, 2)).value.ok, false);
  assert.equal((await send({ type: 'reports' }, 0)).value.length, 1);
});

test('延迟的重复开始不能越过后来的停止，停止不等待状态写入才取消 solve', async () => {
  let hold = false, reportStarted, releaseReport, solveStarted, aborted = false;
  const reportBegan = new Promise(resolve => { reportStarted = resolve; });
  const solveBegan = new Promise(resolve => { solveStarted = resolve; });
  const { send, sessions } = await raceFixture({
    beforeSet: async value => {
      if (hold && value['tab:7']?.route) {
        hold = false; reportStarted(); await new Promise(resolve => { releaseReport = resolve; });
      }
    },
    solveFetch: options => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture cancellation')); }, { once: true });
      solveStarted();
    })
  });
  const solve = send({ type: 'solve', key: 'active', questions: [] }, 1);
  await solveBegan;
  hold = true;
  const report = send({ type: 'report', value: { route: 'chapter-a', status: 'running' } }, 0);
  await reportBegan;
  const start = send({ type: 'control', tabId: 7, enabled: true });
  await new Promise(resolve => setImmediate(resolve));
  const stop = send({ type: 'control', tabId: 7, enabled: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
  releaseReport();
  await Promise.all([report, start, stop]);
  assert.equal((await solve).ok, false);
  assert.equal(sessions['tab:7'].enabled, false);
  assert.equal((await send({ type: 'solve', key: 'late', questions: [] }, 1)).ok, false);
});

test('课程上下文传入答题，显式语言覆盖页面推断且保存时拒绝未知语言', async () => {
  let observed;
  const { send } = await raceFixture({ solveFetch: options => { observed = JSON.parse(options.body); return { answers: [] }; } });
  assert.equal((await send({ type: 'config' })).value.programmingLanguage, 'auto');
  const context = { courseTitle: 'Python 程序设计', chapterTitle: '循环', programmingLanguage: 'Python' };
  const auto = await send({ type: 'solve', key: 'auto', questions: [], context }, 1);
  assert.equal(auto.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(auto.value.context)), context);
  assert.equal(observed.context.programmingLanguage, 'Python');
  const settings = { token: 'fixture', autoSubmit: true, confidence: 0.85, nextSelector: '', completeSelector: '', programmingLanguage: 'Java' };
  assert.equal((await send({ type: 'saveConfig', value: settings })).ok, true);
  const explicit = await send({ type: 'solve', key: 'explicit', questions: [], context }, 1);
  assert.equal(explicit.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(explicit.value.context)), { ...context, programmingLanguage: 'Java' });
  assert.deepEqual(observed.context, { ...context, programmingLanguage: 'Java' });
  assert.equal((await send({ type: 'saveConfig', value: { ...settings, programmingLanguage: 'Go' } })).ok, false);
});

test('仅明确确认的扩展弹窗可清理本页未确认 checkpoint，完成/其它 tab/其它题目不清', async () => {
  const key = letter => letter.repeat(64), name = letter => `quiz:${key(letter)}`;
  const events = [];
  const { send, local, sessions } = await raceFixture({ localValues: {
    [name('a')]: { stage: 'uncertain' }, [name('b')]: { stage: 'submitted' }, [name('c')]: { stage: 'filled' },
    [name('d')]: { stage: 'uncertain' }, [name('e')]: { stage: 'submitting' }, [name('f')]: { stage: 'uncertain' }
  }, eventFetch: event => events.push(event) });
  for (const [index, letter] of ['a', 'b', 'c', 'd', 'e'].entries()) await send({ type: 'report', value: { quizKey: key(letter), busy: false, mode: 'blocked' } }, index + 1);
  await send({ type: 'report', value: { quizKey: key('d'), busy: false, mode: 'blocked' } }, 1, 8);
  assert.equal((await send({ type: 'resetPending', tabId: 7 })).ok, false);
  assert.equal((await send({ type: 'resetPending', tabId: 7, confirmed: true }, 1)).ok, false);
  await send({ type: 'report', value: { quizKey: key('e'), busy: true, mode: 'submitting' } }, 5);
  assert.equal((await send({ type: 'resetPending', tabId: 7, confirmed: true })).ok, false);
  await send({ type: 'report', value: { quizKey: key('e'), busy: false, mode: 'blocked' } }, 5);
  const result = await send({ type: 'resetPending', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.clearedCount, 2);
  assert.equal(result.value.refreshRequired, true);
  assert.equal(local[name('a')], undefined); assert.equal(local[name('e')], undefined);
  assert.equal(local[name('b')].stage, 'submitted'); assert.equal(local[name('c')].stage, 'filled');
  assert.equal(local[name('d')].stage, 'uncertain'); assert.equal(local[name('f')].stage, 'uncertain');
  assert.equal(sessions['tab:7'].enabled, false);
  assert.equal(events.filter(event => event.type === 'checkpoint_reset').length, 1);
});

test('checkpoint 已清理后日志失败仍返回成功和刷新提示', async () => {
  const key = 'a'.repeat(64), name = `quiz:${key}`;
  const { send, local, sessions } = await raceFixture({
    localValues: { [name]: { stage: 'uncertain' } },
    eventFetch: event => { if (event.type === 'checkpoint_reset') throw new Error('fixture event failure'); }
  });
  await send({ type: 'report', value: { quizKey: key, busy: false, mode: 'blocked' } }, 1);
  const result = await send({ type: 'resetPending', tabId: 7, confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.clearedCount, 1);
  assert.equal(result.value.refreshRequired, true);
  assert.match(result.value.warning, /事件日志记录失败.*fixture event failure/);
  assert.equal(local[name], undefined);
  assert.equal(sessions['tab:7'].enabled, false);
});
