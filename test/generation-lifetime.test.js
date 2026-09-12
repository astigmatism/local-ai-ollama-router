import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { upstreamFetch } from '../src/upstream.js';

async function fixture(t, handler, overrides = {}) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { upstreamUrl: `http://127.0.0.1:${server.address().port}`, upstreamTimeoutMs: 5, generationStallTimeoutMs: 80, ...overrides };
}

test('healthy generation survives the old 900-second boundary under a controlled clock', async (t) => {
  let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  let next;
  const config = await fixture(t, (_, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('first');
    next = () => { clock = 900001; res.end(' naturally finished'); };
  });
  const response = await upstreamFetch(config, '/v1/chat/completions', { generation: true });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  next();
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), ' naturally finished');
  assert.equal((await reader.read()).done, true);
});

test('cold prefill stays alive through changing slot progress without a total timer', async (t) => {
  let progress = 0;
  const config = await fixture(t, (req, res) => {
    if (req.url === '/slots') return res.end(JSON.stringify([{ id_task: 1, n_prompt_tokens_processed: ++progress }]));
    const timer = setTimeout(() => res.end('prefill completed'), 240);
    res.once('close', () => clearTimeout(timer));
  });
  const response = await upstreamFetch(config, '/v1/chat/completions', { generation: true, progressPath: '/slots' });
  assert.equal(await response.text(), 'prefill completed');
  assert.ok(progress > 2);
});

test('stalled body fails with TimeoutError while preserving bytes already read', async (t) => {
  const config = await fixture(t, (_, res) => { res.writeHead(200); res.write('retained fragment'); });
  const response = await upstreamFetch(config, '/api/chat', { generation: true });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'retained fragment');
  await assert.rejects(reader.read(), { name: 'TimeoutError' });
});

test('client cancellation interrupts cold prefill immediately', async (t) => {
  const config = await fixture(t, () => {});
  const controller = new AbortController();
  const pending = upstreamFetch(config, '/api/chat', { generation: true, signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
});
