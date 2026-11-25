import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function fixture(destination) {
  let listener, options;
  const sessions = { 'tab:7': { enabled: true } };
  const chrome = {
    runtime: { id: 'fixture', onMessage: { addListener: fn => { listener = fn; } } },
    storage: {
      local: { get: async () => ({ config: { keepAwake: false } }) },
      session: { get: async key => key === null ? sessions : { [key]: sessions[key] } }
    },
    alarms: { onAlarm: { addListener: () => {} } },
    tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } }
  };
  const fetch = async (_url, value) => {
    options = value;
    return { url: destination, ok: true, status: 200,
      headers: { get: key => key === 'content-type' ? 'image/png' : null },
      arrayBuffer: async () => Uint8Array.of(137, 80, 78, 71).buffer };
  };
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'),
    { chrome, fetch, URL, Date, Map, Set, String, Number, AbortSignal, AbortController, Uint8Array, btoa });
  const send = message => new Promise(resolve => listener(message, { id: 'fixture', tab: { id: 7 }, frameId: 1 }, resolve));
  return { send, options: () => options };
}

test('image fetch follows a course CDN redirect and keeps image content local', async () => {
  const { send, options } = await fixture('https://p.ananas.chaoxing.com/star3/redirected.png');
  const result = await send({ type: 'fetchQuestionImage', url: 'https://mooc1.chaoxing.com/image?id=1' });
  assert.equal(result.ok, true);
  assert.equal(result.value, 'data:image/png;base64,iVBORw==');
  assert.equal(options().redirect, 'follow');
  assert.equal(options().credentials, 'include');
});

test('image fetch rejects redirects outside course domains', async () => {
  const { send } = await fixture('https://example.com/image.png');
  const result = await send({ type: 'fetchQuestionImage', url: 'https://mooc1.chaoxing.com/image?id=1' });
  assert.equal(result.ok, false);
  assert.match(result.error, /非学习通域名/);
});
