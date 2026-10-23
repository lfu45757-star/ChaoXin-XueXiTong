// Local explicit human decision only; never starts the model or browser.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../lib/solver.mjs';
import { createReviewedAnswer } from '../lib/reviewed-answers.mjs';

const usage = '用法: node scripts/review-answer.mjs solve-运行名 题目ID 选项键（多选用逗号分隔）';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else {
  try {
    if (args.length !== 3) throw new Error(usage);
    const token = (await readFile(join(root, 'data', 'token.txt'), 'utf8')).trim();
    const result = await createReviewedAnswer(args[0], args[1], args[2].split(',').map(v => v.trim()).filter(Boolean), { token });
    console.log(JSON.stringify({ ...result, source: 'user-confirmed', note: '人工已明确决定；原模型答案与置信度保留在记录中。' }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
