import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isThinkingEnabled,
  parseDefaultThink,
  reasoningEffortToThink,
  resolveDefaultThink,
  thinkLevelToReasoningEffort
} from '../src/reasoning.js';

test('maps Ollama think values back to generic reasoning efforts', () => {
  assert.equal(thinkLevelToReasoningEffort(true), 'high');
  assert.equal(thinkLevelToReasoningEffort(false), 'none');
  assert.equal(thinkLevelToReasoningEffort('low'), 'low');
  assert.equal(thinkLevelToReasoningEffort('medium'), 'medium');
  assert.equal(thinkLevelToReasoningEffort('high'), 'high');
  assert.equal(thinkLevelToReasoningEffort('max'), 'max');
  assert.equal(thinkLevelToReasoningEffort('minimal'), 'minimal');
  assert.equal(thinkLevelToReasoningEffort('xhigh'), 'xhigh');
  assert.equal(thinkLevelToReasoningEffort(undefined), undefined);
  assert.equal(thinkLevelToReasoningEffort('invalid'), undefined);
});

test('maps generic reasoning efforts to Ollama think values', () => {
  assert.equal(reasoningEffortToThink('none'), false);
  assert.equal(reasoningEffortToThink('minimal'), 'low');
  assert.equal(reasoningEffortToThink('low'), 'low');
  assert.equal(reasoningEffortToThink('medium'), 'medium');
  assert.equal(reasoningEffortToThink('high'), 'high');
  assert.equal(reasoningEffortToThink('xhigh'), 'max');
  assert.equal(reasoningEffortToThink('max'), 'max');
  assert.equal(reasoningEffortToThink('invalid'), undefined);
});

test('parses boolean, level, compatibility, and model-default settings', () => {
  assert.equal(parseDefaultThink(true), true);
  assert.equal(parseDefaultThink('false'), false);
  assert.equal(parseDefaultThink('none'), false);
  assert.equal(parseDefaultThink('minimal'), 'low');
  assert.equal(parseDefaultThink('xhigh'), 'max');
  assert.equal(parseDefaultThink('max'), 'max');
  assert.equal(parseDefaultThink('model-default'), undefined);
  assert.throws(() => parseDefaultThink('turbo'), /thinking default/);
});

test('resolves active-model defaults before global defaults and endpoint fallbacks', () => {
  const config = { defaultThinkConfigured: true, defaultThink: 'medium' };
  assert.equal(resolveDefaultThink({ default_think_configured: true, default_think: 'xhigh' }, config, false), 'max');
  assert.equal(resolveDefaultThink({ default_think_configured: false }, config, false), 'medium');
  assert.equal(resolveDefaultThink({ default_think_configured: false }, { defaultThinkConfigured: false }, false), false);
  assert.equal(resolveDefaultThink({ default_think_configured: false }, { defaultThinkConfigured: false }), undefined);
  assert.equal(isThinkingEnabled('max'), true);
  assert.equal(isThinkingEnabled(false), false);
});
