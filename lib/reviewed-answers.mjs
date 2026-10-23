import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile, realpath, stat, mkdir, writeFile, link, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { root, validateAnswers } from './solver.mjs';
import { batchKey, normalizedBatch, stableJson } from './batch.mjs';

const defaultRuns = join(root, 'data', 'runs');
const defaultReviews = join(root, 'data', 'reviewed');
const choiceTypes = new Set(['single', 'multiple', 'boolean']);
const equal = (a, b) => stableJson(a) === stableJson(b);
const signatureFor = (record, token) => {
  if (typeof token !== 'string' || !token) throw new Error('人工复核需要本地配对令牌');
  const { signature, ...payload } = record;
  return createHmac('sha256', token).update(stableJson(payload)).digest('hex');
};

async function jsonFile(path) {
  if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('人工复核文件超过大小限制');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function origin(runName, runsDir) {
  if (typeof runName !== 'string' || !/^solve-[A-Za-z0-9]+$/.test(runName)) throw new Error('originRun 名称无效');
  const runs = await realpath(runsDir);
  const run = await realpath(join(runs, runName));
  if (dirname(run) !== runs || basename(run) !== runName) throw new Error('originRun 必须是本地 runs 的直接子目录');
  const files = await Promise.all(['questions.json', 'answer.json'].map(async name => {
    const path = await realpath(join(run, name));
    if (dirname(path) !== run || basename(path) !== name) throw new Error('originRun 文件路径无效');
    return jsonFile(path);
  }));
  const batch = normalizedBatch(files[0].questions, files[0].context);
  return { ...batch, originalAnswers: validateAnswers(files[1], batch.questions) };
}

function applyReview(record, batch) {
  const review = record.review;
  if (!review || Object.keys(review).sort().join(',') !== 'at,id,originalConfidence,source,values' || review.source !== 'user-confirmed' ||
      typeof review.at !== 'string' || !Number.isFinite(Date.parse(review.at))) throw new Error('人工复核来源或时间无效');
  const question = batch.questions.find(q => q.id === review.id);
  const original = record.originalAnswers.answers.find(a => a.id === review.id);
  if (!question || !choiceTypes.has(question.type) || !original || review.originalConfidence !== original.confidence) throw new Error('人工复核目标或原置信度不匹配');
  const answer = {
    answers: record.originalAnswers.answers.map(a => a.id !== review.id ? a : {
      ...a, values: review.values, confidence: 1,
      explanation: `人工确认，模型原置信度${original.confidence}。原模型说明：${original.explanation}`
    })
  };
  return validateAnswers(answer, batch.questions);
}

export async function loadReviewedAnswers(questions, context, { token, runsDir = defaultRuns, reviewsDir = defaultReviews } = {}) {
  const batch = normalizedBatch(questions, context), key = batchKey(batch.questions, batch.context);
  let record;
  try { record = await jsonFile(join(reviewsDir, key + '.json')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (!record || Object.keys(record).sort().join(',') !== 'batchHash,context,createdAt,originRun,originalAnswers,questions,review,signature,version' ||
      record.version !== 1 || record.batchHash !== key || typeof record.signature !== 'string' || !/^[a-f0-9]{64}$/.test(record.signature) ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('人工复核记录身份无效');
  if (!timingSafeEqual(Buffer.from(record.signature, 'hex'), Buffer.from(signatureFor(record, token), 'hex'))) throw new Error('人工复核记录完整性校验失败');
  if (!equal(record.questions, batch.questions) || !equal(record.context, batch.context)) throw new Error('人工复核记录与当前题组或上下文不匹配');
  validateAnswers(record.originalAnswers, batch.questions);
  const source = await origin(record.originRun, runsDir);
  if (!equal(source.questions, batch.questions) || !equal(source.context, batch.context) || !equal(source.originalAnswers, record.originalAnswers))
    throw new Error('人工复核记录与原始成功运行不匹配');
  return applyReview(record, batch);
}

export async function createReviewedAnswer(runName, id, values, { token, runsDir = defaultRuns, reviewsDir = defaultReviews, now = new Date() } = {}) {
  const source = await origin(runName, runsDir);
  const key = batchKey(source.questions, source.context), at = now.toISOString();
  const original = source.originalAnswers.answers.find(a => a.id === id);
  const record = {
    version: 1, batchHash: key, originRun: runName, createdAt: at,
    context: source.context, questions: source.questions, originalAnswers: source.originalAnswers,
    review: { id, values, source: 'user-confirmed', at, originalConfidence: original?.confidence }
  };
  applyReview(record, source);
  record.signature = signatureFor(record, token);
  await mkdir(reviewsDir, { recursive: true });
  const path = join(reviewsDir, key + '.json');
  try { await stat(path); throw new Error('该题组已存在人工复核记录，请先核对已有记录'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(reviewsDir, key + '.' + randomBytes(8).toString('hex') + '.tmp');
  try { await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await link(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { batchHash: key, path, originRun: runName, id, values, originalConfidence: original.confidence };
}
