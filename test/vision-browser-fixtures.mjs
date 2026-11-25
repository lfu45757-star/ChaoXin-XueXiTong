// Isolated page fixture. No real course or model request.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uN8AAAAASUVORK5CYII=';
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://fixture.example');
  await page.setContent(`<div class="singleQuesId"><input id="answertype1" type="hidden" value="0"><div class="Zy_TItle">【单选题】计算图片内容 <img src="${pixel}"></div><ul class="Zy_ulTop"><li class="before-after">A、<img src="${pixel}"></li><li class="before-after">B、2</li></ul></div>`);
  await page.addScriptTag({ content: await readFile(new URL('../extension/adapter.js', import.meta.url), 'utf8') });
  const result = await page.evaluate(async () => {
    const question = ChaoxingAdapter.parseQuestions()[0];
    await ChaoxingAdapter.captureQuestionImages(question);
    return { hasImages: question.hasImages, labels: question.data.images.map(image => image.label), types: question.data.images.map(image => image.dataUrl.slice(0, 22)) };
  });
  assert.equal(result.hasImages, true);
  assert.deepEqual(result.labels, ['题干', '选项 A']);
  assert.ok(result.types.every(type => type.startsWith('data:image/png;base64,')));
  console.log(JSON.stringify({ passed: 3, result }));
} finally { await browser.close(); }
