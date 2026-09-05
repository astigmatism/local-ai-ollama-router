import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RequestGate, RequestGateError } from '../src/request-gate.js';

test('request gate persists drain state and releases leases exactly once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'router-gate-test-'));
  const controlFile = path.join(dir, 'control.json');
  try {
    const gate = new RequestGate(controlFile);
    await gate.init();
    const first = gate.acquire({ endpoint: '/api/chat', clientIdentity: 'a', limit: 2 });
    const second = gate.acquire({ endpoint: '/api/chat', clientIdentity: 'b', limit: 2 });
    assert.equal(gate.snapshot().active_count, 2);
    assert.throws(
      () => gate.acquire({ endpoint: '/api/chat', clientIdentity: 'c', limit: 2 }),
      (error) => error instanceof RequestGateError && error.statusCode === 429 && error.code === 'BACKEND_CONCURRENCY_LIMIT'
    );
    assert.equal(first.release(), true);
    assert.equal(first.release(), false);
    assert.equal(gate.snapshot().active_count, 1);
    second.release();
    assert.equal(await gate.waitForIdle(50), true);

    await gate.setDraining(true, 'unit test');
    assert.throws(
      () => gate.acquire({ endpoint: '/api/chat', clientIdentity: 'd', limit: 2 }),
      (error) => error instanceof RequestGateError && error.statusCode === 503 && error.code === 'BACKEND_DRAINING'
    );
    const reloaded = new RequestGate(controlFile);
    await reloaded.init();
    assert.equal(reloaded.snapshot().draining, true);
    assert.equal(reloaded.snapshot().drain_reason, 'unit test');
    await reloaded.setDraining(false);
    assert.equal(reloaded.snapshot().draining, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('waitForIdle times out while a generation is still active', async () => {
  const gate = new RequestGate(null);
  const lease = gate.acquire({ endpoint: '/v1/chat/completions' });
  assert.equal(await gate.waitForIdle(5), false);
  lease.release();
  assert.equal(await gate.waitForIdle(5), true);
});
