import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scope = vm.createContext({});
vm.runInContext(await readFile(new URL('../extension/status-text.js', import.meta.url), 'utf8'), scope);
const display = scope.ChaoxingStatusText;

test('normal short progress and errors remain unchanged', () => {
  for (const text of ['已填写并校验 1/3 题', '正在处理教师讨论题，等待发布结果', '无法连接本地服务，请运行 start.cmd',
    'API 响应 values 必须是数组', 'questions 字段无效', '调用失败：context 不完整', '本地服务已连接']) {
    assert.equal(display(text), text);
  }
  assert.equal(display(undefined), '');
  assert.equal(display(null), '');
  assert.equal(display(42), '42');
});

test('old discussion diagnostics never expose prompts for any numeric exit code', () => {
  for (const code of ['1', '137', '-1', '255', '0']) {
    const raw = `讨论处理失败，已跳过：Codex 退出码 ${code}: 必须使用给出的 key；填空/简答按输入框顺序给 values。` +
      '{"context":{"courseTitle":""},"questions":[{"id":"discussion","text":"private teacher prompt"}]}';
    assert.equal(display(raw), `讨论解答失败，已跳过（Codex 退出码 ${code}）`);
    assert.equal(display(`Codex 退出码 ${code}: private diagnostic`), `AI 解答失败（Codex 退出码 ${code}），详细内容已隐藏`);
    assert.equal(display(`Codex 退出码 ${code}: {questions:[讨论...]}`), `AI 解答失败（Codex 退出码 ${code}），详细内容已隐藏`);
  }
});

test('discussion failures use a short stable status', () => {
  assert.equal(display('讨论处理失败，已跳过：长错误和请求内容'), '讨论处理失败，已跳过');
  assert.equal(display('  讨论处理失败：服务不可用'), '讨论处理失败，已跳过');
  assert.equal(display('未找到可进入的讨论页面，保留未完成标记并跳过'), '未找到可进入的讨论页面，保留未完成标记并跳过');
});

test('paired prompt JSON keys and leaked prompt rules are hidden', () => {
  for (const text of [
    '失败：{"context":{},"questions":[]}',
    '失败：{"questions":[{"values":["private answer"]}]}',
    "失败：{'context':{},'values':[]}",
    '必须使用给出的 key；其他内容',
    '填空/简答按输入框顺序给 values。',
    '保持原 id。不确定时降低 confidence',
    '不要凭空编造图像内容。',
    '请围绕以下教师布置的课程讨论题，生成可直接发表的一段回复'
  ]) assert.equal(display(text), 'AI 解答失败，详细内容已隐藏');
  // One field or repeated occurrences of the same field are not a prompt pair.
  for (const text of ['接口错误：{"values":"expected array"}', '{"context":"invalid"}', '{"values":[],"values":[]}']) {
    assert.equal(display(text), text);
  }
});

test('HTML stays literal text and long ordinary text is bounded', () => {
  const html = '<img src=x onerror=alert(1)> 读取失败';
  assert.equal(display(html), html);
  assert.equal(typeof display(html), 'string');
  assert.equal(display('文'.repeat(160)), '文'.repeat(160));
  assert.equal(display('文'.repeat(161)), '文'.repeat(160) + '…');
  assert.equal(display('🙂'.repeat(161)), '🙂'.repeat(160) + '…');
});
