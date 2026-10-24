// Disposable Edge profile and intercepted course page; never touches the user's Edge profile.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { root } from '../lib/solver.mjs';

const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const executablePath = process.env.CX_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await access(executablePath);
const extensionPath = resolve(root, 'extension');
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
const profile = await mkdtemp(join(tmpdir(), 'cx-edge-smoke-'));
const resolvedProfile = await realpath(profile);
const resolvedTemp = await realpath(tmpdir());
assert.ok(resolvedProfile.startsWith(resolvedTemp + sep) && resolvedProfile !== resolvedTemp);
let context;
const result = { at: new Date().toISOString(), browser: 'Microsoft Edge', extensionVersion: manifest.version,
  scope: 'Disposable Edge profile and intercepted Chaoxing page; no user profile or real course access', checks: [] };
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  await context.route('https://mooc1.chaoxing.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><title>Edge extension fixture</title></head><body><main>Intercepted learning page</main></body></html>'
  }));
  const page = await context.newPage();
  await page.goto('https://mooc1.chaoxing.com/agent-edge-smoke');
  await page.waitForSelector('#cx-agent-panel', { timeout: 15000 });
  result.checks.push('Edge loaded the extension content scripts on a matched HTTPS page');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  assert.match(worker.url(), /^chrome-extension:\/\/[^/]+\/background\.js$/);
  const loadedVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(loadedVersion, manifest.version);
  result.checks.push('Edge started the Manifest V3 service worker with the expected version');
  const health = await worker.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:18765/health');
    const body = await response.text();
    return { status: response.status, body: body.slice(0, 200) };
  });
  result.healthStatus = health.status;
  const healthBody = JSON.parse(health.body);
  assert.equal(health.status, 401);
  assert.equal(typeof healthBody.error, 'string');
  result.checks.push('Edge extension service worker reached the local service; unauthenticated health was correctly denied');
  result.browserVersion = context.browser().version();
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = String(error.message || error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  assert.ok(resolvedProfile.startsWith(resolvedTemp + sep) && resolvedProfile !== resolvedTemp);
  await rm(resolvedProfile, { recursive: true, force: true });
  await writeFile(new URL('./edge-extension-smoke-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
