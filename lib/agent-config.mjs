import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const providerDefaults = Object.freeze({
  codex: { baseUrl: '', model: '', responseFormat: 'json_schema' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', responseFormat: 'json_object' },
  http: { baseUrl: '', model: '', responseFormat: 'json_schema' },
});

const fields = new Set(['provider', 'baseUrl', 'model', 'responseFormat', 'apiKey', 'clearApiKey', 'timeoutMs', 'maxTokens', 'questionBank']);

export function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('AI 接口地址无效'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    throw new Error('远程 AI 接口必须使用 HTTPS，本机接口可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('AI 接口地址不能包含账户、密码、查询参数或片段');
  return url.href.replace(/\/+$/, '');
}

function textField(value, name, limit) {
  if (typeof value !== 'string' || value.length > limit || /[\r\n\0]/.test(value)) throw new Error(`${name} 格式无效`);
  return value.trim();
}

export function normalizeProviderConfig(input, previous, { allowIncomplete = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key)))
    throw new Error('AI 配置字段无效');
  const provider = input.provider ?? previous?.provider ?? 'codex';
  if (!Object.hasOwn(providerDefaults, provider)) throw new Error('AI 后端仅支持 codex、deepseek 或 http');
  const base = previous?.provider === provider ? previous : { ...providerDefaults[provider], provider, apiKey: '', timeoutMs: 180000, maxTokens: 8192 };
  const result = { ...base, provider };
  result.questionBank = input.questionBank ?? previous?.questionBank ?? 'local';
  if (!['local', 'daxuesoutijiang', 'generic'].includes(result.questionBank)) throw new Error('题库来源无效');
  for (const [key, limit] of [['baseUrl', 2048], ['model', 200]]) {
    if (input[key] !== undefined) result[key] = textField(input[key], key, limit);
  }
  if (result.baseUrl) result.baseUrl = validateBaseUrl(result.baseUrl);
  if (provider === 'deepseek' && result.baseUrl !== providerDefaults.deepseek.baseUrl)
    throw new Error('DeepSeek 预设仅连接官方地址；其他地址请选择自定义接口');
  if (!allowIncomplete && provider !== 'codex' && (!result.baseUrl || !result.model)) throw new Error('请填写 AI 接口地址和模型名称');
  result.responseFormat = input.responseFormat ?? result.responseFormat;
  if (!['json_schema', 'json_object', 'text'].includes(result.responseFormat)) throw new Error('AI 输出格式无效');
  for (const [key, min, max] of [['timeoutMs', 1000, 900000], ['maxTokens', 256, 131072]]) {
    result[key] = input[key] ?? result[key];
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`${key} 必须为 ${min}–${max} 之间的整数`);
  }
  if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') throw new Error('clearApiKey 必须为布尔值');
  // A saved credential must never follow a configuration change to a new host.
  if (!previous || previous.provider !== provider || previous.baseUrl !== result.baseUrl) result.apiKey = '';
  if (input.apiKey !== undefined) {
    const key = textField(input.apiKey, 'API key', 4096);
    if (key) result.apiKey = key;
  }
  if (input.clearApiKey) result.apiKey = '';
  return result;
}

export function configFromEnv(env = process.env) {
  const provider = env.AGENT_PROVIDER || 'codex';
  const preset = providerDefaults[provider] || providerDefaults.codex;
  return normalizeProviderConfig({
    provider, baseUrl: env.AGENT_BASE_URL || preset.baseUrl, model: env.AGENT_MODEL || (provider === 'codex' ? env.CODEX_MODEL : '') || preset.model,
    responseFormat: env.AGENT_RESPONSE_FORMAT || preset.responseFormat, apiKey: env.AGENT_API_KEY || '',
    timeoutMs: Number(env.AGENT_TIMEOUT_MS || 180000), maxTokens: Number(env.AGENT_MAX_TOKENS || 8192),
    questionBank: env.QUESTION_BANK_PROVIDER || (env.QUESTION_BANK_URL ? 'generic' : 'local'),
  }, undefined, { allowIncomplete: true });
}

export function publicProviderConfig(config) {
  const { apiKey, ...publicConfig } = config;
  return { ...publicConfig, hasApiKey: Boolean(apiKey) };
}

export function providerEnv(config, env = process.env) {
  return { ...env, ...(config.provider === 'codex' ? { CODEX_MODEL: config.model } : {}),
    AGENT_PROVIDER: config.provider, AGENT_BASE_URL: config.baseUrl, AGENT_MODEL: config.model,
    AGENT_RESPONSE_FORMAT: config.responseFormat, AGENT_API_KEY: config.apiKey,
    QUESTION_BANK_PROVIDER: config.questionBank,
    AGENT_TIMEOUT_MS: String(config.timeoutMs), AGENT_MAX_TOKENS: String(config.maxTokens) };
}

export function redactSecrets(message, secrets) {
  let value = String(message || '未知错误');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) value = value.split(secret).join('[已隐藏密钥]');
  return value;
}

export function createProviderConfigStore({ path, env = process.env }) {
  let current, revision = 0, loading;
  async function read() {
    if (!loading) loading = (async () => {
      current = configFromEnv(env);
      try {
        const stored = JSON.parse(await readFile(path, 'utf8'));
        current = normalizeProviderConfig(stored, undefined);
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('本地 AI 配置读取失败，请检查 data/provider.json 的格式');
      }
    })();
    await loading;
    return { ...current };
  }
  return {
    read,
    get revision() { return revision; },
    async update(input) {
      const previous = await read();
      const next = normalizeProviderConfig(input, previous);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(() => {}); }
      current = next;
      revision++;
      return { ...next };
    },
  };
}
