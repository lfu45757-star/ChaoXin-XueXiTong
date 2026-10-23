import { createHash } from 'node:crypto';
import { validateQuestions, validateContext } from './solver.mjs';

export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function normalizedBatch(questions, context) {
  return { questions: validateQuestions({ questions }), context: validateContext(context) };
}

export function batchKey(questions, context) {
  return createHash('sha256').update(stableJson(normalizedBatch(questions, context))).digest('hex');
}
