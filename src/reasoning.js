export const OLLAMA_THINK_LEVELS = new Set(['low', 'medium', 'high', 'max']);

export const RESPONSES_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

export function isThinkingEnabled(value) {
  return value === true || OLLAMA_THINK_LEVELS.has(value);
}

export function reasoningEffortToThink(effort) {
  if (!RESPONSES_REASONING_EFFORTS.has(effort)) return undefined;
  if (effort === 'none') return false;
  if (effort === 'minimal') return 'low';
  if (effort === 'xhigh') return 'max';
  return effort;
}

export function thinkLevelToReasoningEffort(value) {
  if (value === true) return 'high';
  if (value === false) return 'none';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'minimal') return 'minimal';
  if (normalized === 'xhigh') return 'xhigh';
  if (OLLAMA_THINK_LEVELS.has(normalized)) return normalized;
  return undefined;
}

export function parseDefaultThink(value, { allowModelDefault = true } = {}) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') {
    throw new TypeError('thinking default must be true, false, a reasoning level, or model-default.');
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false' || normalized === 'none') return false;
  if (normalized === 'minimal') return 'low';
  if (normalized === 'xhigh') return 'max';
  if (OLLAMA_THINK_LEVELS.has(normalized)) return normalized;
  if (allowModelDefault && ['auto', 'model', 'model-default', 'unset'].includes(normalized)) return undefined;
  throw new TypeError('thinking default must be true, false, none, minimal, low, medium, high, xhigh, max, or model-default.');
}

export function resolveDefaultThink(activeModelInfo, config, fallback = undefined) {
  if (activeModelInfo?.default_think_configured) {
    return parseDefaultThink(activeModelInfo.default_think);
  }
  if (config?.defaultThinkConfigured) return config.defaultThink;
  return fallback;
}
