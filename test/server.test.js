import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createRouterServer } from '../src/server.js';

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.trim() ? JSON.parse(raw) : null;
}

function sendJson(response, status, body) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length
  });
  response.end(payload);
}

function createFakeOllama() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://fake-ollama.local');
    const body = ['GET', 'HEAD'].includes(String(request.method).toUpperCase()) ? null : await readJsonBody(request);
    requests.push({ method: request.method, pathname: url.pathname, body });

    if (request.method === 'GET' && url.pathname === '/api/version') {
      sendJson(response, 200, { version: 'fake-ollama-test' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/tags') {
      sendJson(response, 200, { models: [{ name: 'active:model', model: 'active:model' }] });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/ps') {
      sendJson(response, 200, {
        models: [{ name: 'active:model', model: 'active:model', until: 'Forever', context: 8192 }]
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      sendJson(response, 200, {
        model: body?.model,
        message: { role: 'assistant', content: 'ok' },
        done: true,
        eval_count: 1,
        eval_duration: 1000000000
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/generate') {
      sendJson(response, 200, {
        model: body?.model,
        response: 'ok',
        done: true,
        eval_count: 1,
        eval_duration: 1000000000
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/show') {
      sendJson(response, 200, { model: body?.model, details: {} });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });
  return { server, requests };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) {
  if (!server || !server.listening) return;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections?.();
  await closed;
}

async function makeFixture(overrides = {}) {
  const upstream = createFakeOllama();
  const upstreamPort = await listen(upstream.server);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'router-server-test-'));
  const activeModelFile = path.join(dir, 'active-model.json');
  await fs.writeFile(activeModelFile, JSON.stringify({
    profile: 'unit-test',
    model: 'active:model',
    keep_alive: -1,
    context: 8192,
    updated_at: '2026-06-29T00:00:00.000Z',
    source: 'server.test.js'
  }), 'utf8');

  const config = {
    ...loadConfig({
      HOST: '127.0.0.1',
      ADMIN_ENABLED: 'true',
      ADMIN_BIND_HOST: '127.0.0.1',
      OLLAMA_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}`,
      OLLAMA_UPSTREAM_TIMEOUT_MS: '5000',
      ACTIVE_MODEL_FILE: activeModelFile,
      ACTIVE_MODEL: '',
      ADMIN_TOKEN: 'secret-token',
      DATA_DIR: dir,
      REQUEST_HISTORY_LIMIT: '100',
      EVENT_HISTORY_LIMIT: '100',
      ENABLE_NVIDIA_SMI: 'false',
      ...overrides
    })
  };

  const router = await createRouterServer(config);
  const apiPort = await listen(router.server);
  const adminPort = await listen(router.adminServer);
  config.port = apiPort;
  config.adminPort = adminPort;

  async function cleanup() {
    await close(router.adminServer);
    await close(router.server);
    await close(upstream.server);
    await fs.rm(dir, { recursive: true, force: true });
  }

  return { ...router, config, upstream, apiPort, adminPort, cleanup };
}

test('admin listener serves dashboard and summary without auth while API port stays Ollama-compatible', async () => {
  const fixture = await makeFixture();
  try {
    const adminRoot = await fetch(`http://127.0.0.1:${fixture.adminPort}/`);
    assert.equal(adminRoot.status, 200);
    assert.match(adminRoot.headers.get('content-type') || '', /text\/html/);
    assert.match(await adminRoot.text(), /No login or token is required/);

    const adminAlias = await fetch(`http://127.0.0.1:${fixture.adminPort}/admin`);
    assert.equal(adminAlias.status, 200);
    assert.match(await adminAlias.text(), /Local AI Ollama Router Admin/);

    const summaryResponse = await fetch(`http://127.0.0.1:${fixture.adminPort}/admin/api/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.config.adminPortalAuthRequired, false);
    assert.equal(summary.config.adminPort, fixture.adminPort);
    assert.equal(summary.activeModel.model, 'active:model');
    assert.equal(summary.activeLoadedState.loaded, true);

    const legacyUnauthed = await fetch(`http://127.0.0.1:${fixture.apiPort}/admin/api/summary`);
    assert.equal(legacyUnauthed.status, 401);

    const legacyAuthed = await fetch(`http://127.0.0.1:${fixture.apiPort}/admin/api/summary`, {
      headers: { 'x-admin-token': 'secret-token' }
    });
    assert.equal(legacyAuthed.status, 200);

    const apiRoot = await fetch(`http://127.0.0.1:${fixture.apiPort}/`);
    assert.equal(apiRoot.status, 200);
    assert.equal(await apiRoot.text(), 'Ollama is running\n');

    const version = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/version`);
    assert.equal(version.status, 200);
    assert.equal((await version.json()).version, 'fake-ollama-test');

    const wrongPort = await fetch(`http://127.0.0.1:${fixture.adminPort}/api/version`);
    assert.equal(wrongPort.status, 404);
    assert.equal((await wrongPort.json()).error.code, 'API_NOT_ON_ADMIN_PORT');

    const redirect = await fetch(`http://127.0.0.1:${fixture.apiPort}/admin`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get('location') || '', new RegExp(`:${fixture.adminPort}/admin$`));
  } finally {
    await fixture.cleanup();
  }
});

test('API chat preserves non-model parameters and forces keep_alive to -1', async () => {
  const fixture = await makeFixture();
  try {
    const response = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'server-test'
      },
      body: JSON.stringify({
        model: 'active:model',
        stream: false,
        keep_alive: '5m',
        think: false,
        messages: [{ role: 'user', content: 'hello' }],
        options: { temperature: 0.2, num_ctx: 4096 }
      })
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, 'active:model');

    const chatRequest = fixture.upstream.requests.find((request) => request.method === 'POST' && request.pathname === '/api/chat');
    assert.ok(chatRequest);
    assert.equal(chatRequest.body.model, 'active:model');
    assert.equal(chatRequest.body.keep_alive, -1);
    assert.equal(chatRequest.body.think, false);
    assert.deepEqual(chatRequest.body.messages, [{ role: 'user', content: 'hello' }]);
    assert.deepEqual(chatRequest.body.options, { temperature: 0.2, num_ctx: 4096 });

    const requestsResponse = await fetch(`http://127.0.0.1:${fixture.adminPort}/admin/api/requests?limit=1`);
    assert.equal(requestsResponse.status, 200);
    const history = await requestsResponse.json();
    assert.equal(history.requests[0].incomingKeepAlive, '5m');
    assert.equal(history.requests[0].forwardedKeepAlive, -1);
    assert.equal(history.requests[0].keepAliveNormalized, true);
  } finally {
    await fixture.cleanup();
  }
});

test('Responses compatibility does not change existing model discovery, inspection, generation, or management routes', async () => {
  const fixture = await makeFixture();
  try {
    const version = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/version`);
    assert.equal(version.status, 200);
    assert.deepEqual(await version.json(), { version: 'fake-ollama-test' });

    const tags = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/tags`);
    assert.equal(tags.status, 200);
    assert.deepEqual(await tags.json(), {
      models: [{ name: 'active:model', model: 'active:model' }]
    });

    const running = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/ps`);
    assert.equal(running.status, 200);
    assert.deepEqual(await running.json(), {
      models: [{ name: 'active:model', model: 'active:model', until: 'Forever', context: 8192 }]
    });

    const showBody = { model: 'catalog:model', verbose: true };
    const show = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(showBody)
    });
    assert.equal(show.status, 200);
    assert.deepEqual(await show.json(), { model: 'catalog:model', details: {} });
    const forwardedShow = fixture.upstream.requests.find((item) => item.pathname === '/api/show');
    assert.deepEqual(forwardedShow.body, showBody);

    const generate = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'active:model',
        prompt: 'unchanged generation route',
        stream: false,
        keep_alive: '5m',
        options: { temperature: 0.1 }
      })
    });
    assert.equal(generate.status, 200);
    const forwardedGenerate = fixture.upstream.requests.find((item) => item.pathname === '/api/generate');
    assert.deepEqual(forwardedGenerate.body, {
      model: 'active:model',
      prompt: 'unchanged generation route',
      stream: false,
      keep_alive: -1,
      options: { temperature: 0.1 }
    });

    const pull = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'other:model' })
    });
    assert.equal(pull.status, 403);
    assert.equal((await pull.json()).error.code, 'MODEL_MANAGEMENT_DISABLED');
    assert.equal(fixture.upstream.requests.some((item) => item.pathname === '/api/pull'), false);

    const codexCatalog = await fetch(`http://127.0.0.1:${fixture.apiPort}/v1/models`);
    assert.equal(codexCatalog.status, 404);
    assert.equal((await codexCatalog.json()).error.code, 'NOT_FOUND');

    const adminResponses = await fetch(`http://127.0.0.1:${fixture.adminPort}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'must not run here' })
    });
    assert.equal(adminResponses.status, 404);
    assert.equal((await adminResponses.json()).error.code, 'NOT_FOUND');

    assert.deepEqual(
      fixture.upstream.requests.map((item) => `${item.method} ${item.pathname}`),
      [
        'GET /api/version',
        'GET /api/tags',
        'GET /api/ps',
        'POST /api/show',
        'POST /api/generate'
      ]
    );
  } finally {
    await fixture.cleanup();
  }
});
