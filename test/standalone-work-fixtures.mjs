import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../../rea-runtime/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.setContent(`
    <div class="singleQuesId questionLi" typename="填空题"><h3 class="mark_name">1. (填空题) 方法名称</h3>
      <div class="Answer"><div class="textDIV"><iframe></iframe><textarea style="display:none"></textarea></div></div></div>
    <div class="singleQuesId questionLi" typename="判断题"><h3 class="mark_name">2. (判断题) 判断内容</h3>
      <div class="answerBg" role="radio" onclick="addChoice(this)"><span class="num_option">A</span><div class="answer_p">对</div></div>
      <div class="answerBg" role="radio" onclick="addChoice(this)"><span class="num_option">B</span><div class="answer_p">错</div></div></div>
    <div class="singleQuesId questionLi" typename="多选题"><h3 class="mark_name">3. (多选题) 选择内容</h3>
      <div class="answerBg" role="checkbox" onclick="addMultipleChoice(this)"><span class="num_option_dx">A</span><div class="answer_p">第一项</div></div>
      <div class="answerBg" role="checkbox" onclick="addMultipleChoice(this)"><span class="num_option_dx">B</span><div class="answer_p">第二项</div></div></div>
    <div class="singleQuesId questionLi" typename="简答题"><h3 class="mark_name">4. (简答题) 简述内容</h3>
      <div class="eidtDiv"><iframe></iframe><textarea style="display:none"></textarea></div></div>`);
  await page.addScriptTag({ content: await readFile(join(import.meta.dirname, '../extension/adapter.js'), 'utf8') });
  await page.addScriptTag({ content: `function addChoice(x) { x.parentElement.querySelectorAll('.num_option').forEach(y => y.classList.remove('check_answer')); x.firstElementChild.classList.add('check_answer'); }
    function addMultipleChoice(x) { x.firstElementChild.classList.toggle('check_answer_dx'); }` });
  const parsed = await page.evaluate(() => ChaoxingAdapter.parseQuestions().map(q => ({ ...q.data, fields: q.fields.length })));
  assert.deepEqual(parsed.map(q => q.type), ['blank', 'boolean', 'multiple', 'text']);
  assert.deepEqual(parsed.map(q => q.fields), [1, 0, 0, 1]);
  assert.deepEqual(parsed[1].options.map(o => o.key), ['A', 'B']);
  await page.evaluate(() => ChaoxingAdapter.applyAnswers(ChaoxingAdapter.parseQuestions(), [
    { id: '1', values: ['discard'] }, { id: '2', values: ['A'] },
    { id: '3', values: ['A', 'B'] }, { id: '4', values: ['简答文字'] }
  ]));
  assert.equal(await page.locator('.Answer textarea').inputValue(), 'discard');
  assert.equal(await page.locator('.eidtDiv textarea').inputValue(), '简答文字');
  console.log('standalone work parsing and answer verification passed');
} finally { await browser.close(); }
