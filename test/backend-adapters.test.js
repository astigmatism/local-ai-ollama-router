import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendAdapterError,
  normalizeLlamaReasoningRequest,
  normalizeOpenAiSseModel,
  normalizeOutputLimit,
  openAiCompletionToOllama,
  openAiSseToOllamaStream
} from '../src/backend-adapters.js';

const reasoningModel = {
  default_output_tokens: 512,
  max_output_tokens: 4096,
  reasoning_policy: {
    schema_version: 1,
    kind: 'llama_cpp_template_budgeted',
    mapping_kind: 'native_low_medium_high_local_max',
    default_level: 'off',
    public_levels: ['off', 'none', 'low', 'medium', 'high', 'max'],
    aliases: { none: 'off', minimal: 'low', xhigh: 'max' },
    boolean_true_behavior: { mode: 'reject' },
    output_limit_policy: 'cap',
    reasoning_format: 'deepseek',
    answer_reserve: 1024,
    levels: {
      off: { enabled: false, default_output_tokens: 512, max_output_tokens: 4096 },
      low: { enabled: true, template_effort: 'low', reasoning_budget_tokens: 512, default_output_tokens: 1536, max_output_tokens: 1536 },
      medium: { enabled: true, template_effort: 'medium', reasoning_budget_tokens: 2048, default_output_tokens: 3072, max_output_tokens: 3072 },
      high: { enabled: true, template_effort: 'high', reasoning_budget_tokens: 8192, default_output_tokens: 9216, max_output_tokens: 9216 },
      max: { enabled: true, template_effort: 'high', reasoning_budget_tokens: -1, default_output_tokens: 16384, max_output_tokens: 16384 }
    }
  }
};

async function streamText(stream) {
  return await new Response(stream).text();
}

test('normalizes bounded output limits without changing Ollama profiles globally', () => {
  const marker = { default_output_tokens: 512, max_output_tokens: 4096 };
  assert.equal(normalizeOutputLimit({}, marker), 512);
  assert.equal(normalizeOutputLimit({ max_completion_tokens: 128 }, marker), 128);
  assert.throws(
    () => normalizeOutputLimit({ max_tokens: 64, max_completion_tokens: 65 }, marker),
    (error) => error instanceof BackendAdapterError && error.code === 'CONFLICTING_OUTPUT_LIMITS'
  );
  assert.throws(
    () => normalizeOutputLimit({ max_tokens: 4097 }, marker),
    (error) => error instanceof BackendAdapterError && error.code === 'OUTPUT_LIMIT_EXCEEDED'
  );
});

test('normalizes native template efforts and local reasoning budgets after removing caller controls', () => {
  const off = normalizeLlamaReasoningRequest({ max_tokens: 32 }, reasoningModel, 'openai-chat');
  assert.equal(off.level, 'off');
  assert.deepEqual(off.controls, { chat_template_kwargs: { enable_thinking: false } });

  const low = normalizeLlamaReasoningRequest({ reasoning_effort: 'low', max_tokens: 1536 }, reasoningModel, 'openai-chat');
  assert.equal(low.level, 'low');
  assert.equal(low.controls.reasoning_effort, 'low');
  assert.equal(low.controls.reasoning_budget_tokens, 512);
  assert.equal(Object.hasOwn(low.cleanBody, 'reasoning_effort'), false);

  const high = normalizeLlamaReasoningRequest({ think: 'high', options: { num_predict: 9216 } }, reasoningModel, 'native-chat');
  assert.equal(high.controls.reasoning_effort, 'high');
  assert.equal(high.controls.reasoning_budget_tokens, 8192);

  const max = normalizeLlamaReasoningRequest({ reasoning: { effort: 'max' }, max_output_tokens: 16384 }, reasoningModel, 'responses');
  assert.equal(max.controls.reasoning_effort, 'high');
  assert.equal(Object.hasOwn(max.controls, 'reasoning_budget_tokens'), false);
});

test('normalizes Open WebUI boolean compatibility input and xhigh through the active marker', () => {
  const normalized = normalizeLlamaReasoningRequest({
    think: true,
    options: { reasoning_effort: 'xhigh', num_predict: 32768 }
  }, reasoningModel, 'native-chat');

  assert.equal(normalized.level, 'max');
  assert.equal(normalized.outputTokens, 16384);
  assert.equal(normalized.requestedOutputTokens, 32768);
  assert.equal(normalized.outputLimitCapped, true);
  assert.equal(normalized.controls.reasoning_effort, 'high');
  assert.equal(Object.hasOwn(normalized.cleanBody.options, 'reasoning_effort'), false);
});

test('rejects a named enabled effort when native think explicitly disables reasoning', () => {
  assert.throws(
    () => normalizeLlamaReasoningRequest({
      think: false,
      options: { reasoning_effort: 'high', num_predict: 9216 }
    }, reasoningModel, 'native-chat'),
    (error) => error instanceof BackendAdapterError
      && error.statusCode === 400
      && error.code === 'CONFLICTING_REASONING_EFFORT'
  );
});

test('caps output limits downward only and supports marker-configured strict rejection', () => {
  const below = normalizeLlamaReasoningRequest({
    think: 'max', options: { num_predict: 12000 }
  }, reasoningModel, 'native-chat');
  assert.equal(below.outputTokens, 12000);
  assert.equal(below.outputLimitCapped, false);

  const capped = normalizeLlamaReasoningRequest({
    think: 'max', options: { num_predict: 32768 }
  }, reasoningModel, 'native-chat');
  assert.equal(capped.outputTokens, 16384);
  assert.equal(capped.outputLimitCapped, true);

  const strictModel = JSON.parse(JSON.stringify(reasoningModel));
  strictModel.reasoning_policy.output_limit_policy = 'reject';
  assert.throws(
    () => normalizeLlamaReasoningRequest({
      think: 'max', options: { num_predict: 32768 }
    }, strictModel, 'native-chat'),
    (error) => error instanceof BackendAdapterError
      && error.statusCode === 400
      && error.code === 'OUTPUT_LIMIT_EXCEEDED'
  );
});

test('uses a synthetic non-Qwen marker policy without model-name inference', () => {
  const syntheticModel = {
    model: 'orion-reasoner-synthetic',
    default_output_tokens: 111,
    max_output_tokens: 2222,
    reasoning_policy: {
      schema_version: 1,
      default_level: 'off',
      aliases: { none: 'off', xhigh: 'deep' },
      boolean_true_behavior: { mode: 'map', level: 'deep' },
      output_limit_policy: 'cap',
      answer_reserve: 100,
      reasoning_format: 'none',
      levels: {
        off: { enabled: false, default_output_tokens: 111, max_output_tokens: 444 },
        deep: {
          enabled: true,
          template_effort: 'medium',
          reasoning_budget_tokens: 500,
          default_output_tokens: 777,
          max_output_tokens: 2222
        }
      }
    }
  };

  const normalized = normalizeLlamaReasoningRequest({
    think: true, options: { num_predict: 9000 }
  }, syntheticModel, 'native-chat');
  assert.equal(normalized.level, 'deep');
  assert.equal(normalized.outputTokens, 2222);
  assert.equal(normalized.controls.reasoning_effort, 'medium');
  assert.equal(normalized.controls.reasoning_budget_tokens, 500);
});

test('converts llama.cpp non-streaming responses to native chat and generate shapes', () => {
  const openai = {
    model: 'physical',
    choices: [{ message: { role: 'assistant', content: 'adapter ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 7, completion_tokens: 3 }
  };
  const chat = openAiCompletionToOllama(openai, { kind: 'native-chat', model: 'pinned' });
  assert.equal(chat.model, 'pinned');
  assert.equal(chat.message.content, 'adapter ok');
  assert.equal(chat.prompt_eval_count, 7);
  assert.equal(chat.eval_count, 3);
  const generate = openAiCompletionToOllama(openai, { kind: 'native-generate', model: 'pinned' });
  assert.equal(generate.response, 'adapter ok');
  assert.equal(generate.message, undefined);
});

test('keeps parsed llama.cpp reasoning separate from visible native chat content', () => {
  const openai = {
    model: 'physical',
    choices: [{ message: { role: 'assistant', reasoning_content: 'private trace', content: 'visible answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 7, completion_tokens: 8 }
  };
  const chat = openAiCompletionToOllama(openai, { kind: 'native-chat', model: 'pinned' });
  assert.equal(chat.message.thinking, 'private trace');
  assert.equal(chat.message.content, 'visible answer');
  assert.equal(chat.response, undefined);
});

test('converts chunked SSE including a final partial line to Ollama NDJSON', async () => {
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"model":"wrong","choices":[{"delta":{"content":"hel"}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: {"model":"wrong","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]'));
      controller.close();
    }
  });
  const text = await streamText(openAiSseToOllamaStream(input, { kind: 'native-chat', model: 'pinned' }));
  const lines = text.trim().split('\n').map(JSON.parse);
  assert.equal(lines.map((line) => line.message.content).join(''), 'hello');
  assert.equal(lines.at(-1).done, true);
  assert.equal(lines.at(-1).model, 'pinned');
});

test('normalizes model identity in OpenAI streaming frames', async () => {
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"model":"wrong","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":96}},"timings":{"cache_n":96,"prompt_n":4}}\n\ndata: [DONE]\n\n'));
      controller.close();
    }
  });
  const text = await streamText(normalizeOpenAiSseModel(input, 'pinned'));
  assert.match(text, /"model":"pinned"/);
  assert.match(text, /"cache_n":96/);
  assert.match(text, /"cached_tokens":96/);
  assert.match(text, /data: \[DONE\]/);
  assert.doesNotMatch(text, /"model":"wrong"/);
});
