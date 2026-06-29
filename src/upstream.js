import { extractUsageFromOllamaObject } from './stream-parser.js';

export async function upstreamFetch(config, pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.upstreamTimeoutMs);
  try {
    const url = `${config.upstreamUrl}${pathname}`;
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function upstreamJson(config, pathname, { method = 'GET', body = undefined, timeoutMs = undefined, headers = {} } = {}) {
  const response = await upstreamFetch(config, pathname, {
    method,
    timeoutMs,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: json,
    text,
    usage: extractUsageFromOllamaObject(json)
  };
}

export async function checkUpstream(config) {
  const started = Date.now();
  try {
    const version = await upstreamJson(config, '/api/version', { timeoutMs: 5000 });
    return {
      ok: version.ok,
      status: version.status,
      latencyMs: Date.now() - started,
      version: version.body,
      error: version.ok ? null : version.text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      version: null,
      error: error.message
    };
  }
}

export async function getOllamaPs(config) {
  try {
    const result = await upstreamJson(config, '/api/ps', { timeoutMs: 10000 });
    return result.body;
  } catch (error) {
    return { error: error.message, models: [] };
  }
}

export function activeModelLoadedState(psBody, activeModel) {
  const models = Array.isArray(psBody?.models) ? psBody.models : [];
  const match = models.find((model) => model?.name === activeModel || model?.model === activeModel);
  return {
    loaded: Boolean(match),
    until: match?.expires_at || match?.until || null,
    raw: match || null
  };
}
