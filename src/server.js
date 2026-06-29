import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { loadConfig, publicConfig } from './config.js';
import { readActiveModel } from './active-model.js';
import { JsonlStore } from './fs-store.js';
import { Metrics } from './metrics.js';
import { evaluateProxyPolicy, isLikelyStreamingRequest, MODEL_BODY_ROUTES, routeKey } from './policy.js';
import { NdjsonUsageCollector, extractUsageFromOllamaObject } from './stream-parser.js';
import { getGpuTelemetry } from './telemetry.js';
import { activeModelLoadedState, checkUpstream, getOllamaPs, upstreamJson } from './upstream.js';
import {
  copyUpstreamHeaders,
  filterRequestHeaders,
  getClientIdentity,
  getClientIp,
  hasAdminAuth,
  methodAllowsBody,
  parseJsonBuffer,
  readRequestBody,
  requireAdmin,
  sendJson,
  sendText,
  serveStaticFile,
  summarizeBody
} from './http-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public');

function nowIso() {
  return new Date().toISOString();
}

function createBaseRecord(request, pathname) {
  return {
    id: randomUUID(),
    ts: nowIso(),
    method: request.method,
    endpoint: pathname,
    clientIdentity: getClientIdentity(request),
    sourceIp: getClientIp(request),
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
  };
}

async function persistRequest(store, metrics, record) {
  metrics.recordRequest(record);
  try {
    await store.appendRequest(record);
  } catch (error) {
    console.error('failed to persist request record', error);
  }
}

async function persistEvent(store, event) {
  try {
    return await store.appendEvent(event);
  } catch (error) {
    console.error('failed to persist event record', error);
    return null;
  }
}

function errorPayload(code, message, details = undefined) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  };
}

async function handleHealth(response, context) {
  const [activeModel, upstream] = await Promise.all([
    readActiveModel(context.config),
    checkUpstream(context.config)
  ]);
  sendJson(response, upstream.ok ? 200 : 503, {
    ok: upstream.ok,
    router: {
      appName: context.config.appName,
      version: context.config.version,
      maintenanceMode: context.state.maintenanceMode,
      startedAt: context.state.startedAt
    },
    upstream,
    activeModel
  });
}

async function buildSummary(context) {
  const [activeModel, upstream, ps, gpu] = await Promise.all([
    readActiveModel(context.config),
    checkUpstream(context.config),
    getOllamaPs(context.config),
    getGpuTelemetry(context.config)
  ]);
  const activeLoadedState = activeModel.model ? activeModelLoadedState(ps, activeModel.model) : { loaded: false, until: null, raw: null };
  return {
    generatedAt: nowIso(),
    router: {
      appName: context.config.appName,
      version: context.config.version,
      startedAt: context.state.startedAt,
      maintenanceMode: context.state.maintenanceMode,
      uptimeSeconds: Math.round(process.uptime())
    },
    config: publicConfig(context.config),
    activeModel,
    upstream,
    ollamaPs: ps,
    activeLoadedState,
    gpu,
    metrics: context.metrics.snapshot(),
    logs: context.store.paths()
  };
}

async function handleAdminApi(request, response, pathname, context) {
  if (!requireAdmin(request, response, context.config)) return;

  if (request.method === 'GET' && pathname === '/admin/api/summary') {
    sendJson(response, 200, await buildSummary(context));
    return;
  }

  if (request.method === 'GET' && pathname === '/admin/api/requests') {
    sendJson(response, 200, {
      requests: context.store.recentRequests(Number(new URL(request.url, 'http://router.local').searchParams.get('limit')) || context.config.requestHistoryLimit)
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/admin/api/events') {
    sendJson(response, 200, {
      events: context.store.recentEvents(Number(new URL(request.url, 'http://router.local').searchParams.get('limit')) || context.config.eventHistoryLimit)
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/admin/api/config') {
    sendJson(response, 200, publicConfig(context.config));
    return;
  }

  if (request.method === 'GET' && pathname === '/admin/api/metrics') {
    sendJson(response, 200, context.metrics.snapshot());
    return;
  }

  if (request.method === 'POST' && pathname === '/admin/api/reload-config') {
    const activeModel = await readActiveModel(context.config);
    await persistEvent(context.store, { type: 'active_model_marker_reloaded', activeModel });
    sendJson(response, 200, { ok: true, activeModel });
    return;
  }

  if (request.method === 'POST' && pathname === '/admin/api/maintenance') {
    let body = {};
    try {
      body = parseJsonBuffer(await readRequestBody(request, context.config.maxBodyBytes)) || {};
    } catch (error) {
      sendJson(response, error.statusCode || 400, errorPayload('INVALID_JSON_BODY', error.message));
      return;
    }
    context.state.maintenanceMode = Boolean(body.enabled);
    await persistEvent(context.store, { type: 'maintenance_mode_changed', enabled: context.state.maintenanceMode });
    sendJson(response, 200, { ok: true, maintenanceMode: context.state.maintenanceMode });
    return;
  }

  if (request.method === 'POST' && pathname === '/admin/api/prewarm') {
    const activeModel = await readActiveModel(context.config);
    if (!activeModel.model) {
      sendJson(response, 503, errorPayload('NO_ACTIVE_MODEL', 'Cannot prewarm because no active model marker is available.'));
      return;
    }
    const body = {
      model: activeModel.model,
      prompt: '',
      stream: false,
      keep_alive: context.config.forcedKeepAlive
    };
    const started = Date.now();
    try {
      const result = await upstreamJson(context.config, '/api/generate', { method: 'POST', body, timeoutMs: context.config.upstreamTimeoutMs });
      await persistEvent(context.store, {
        type: 'prewarm_triggered',
        model: activeModel.model,
        status: result.status,
        latencyMs: Date.now() - started,
        ok: result.ok
      });
      sendJson(response, result.ok ? 200 : result.status, {
        ok: result.ok,
        model: activeModel.model,
        status: result.status,
        upstream: result.body
      });
    } catch (error) {
      await persistEvent(context.store, { type: 'prewarm_failed', model: activeModel.model, error: error.message });
      sendJson(response, 502, errorPayload('UPSTREAM_ERROR', error.message));
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/admin/api/test-chat') {
    const activeModel = await readActiveModel(context.config);
    if (!activeModel.model) {
      sendJson(response, 503, errorPayload('NO_ACTIVE_MODEL', 'Cannot run a test chat because no active model marker is available.'));
      return;
    }
    let body = {};
    try {
      body = parseJsonBuffer(await readRequestBody(request, context.config.maxBodyBytes)) || {};
    } catch (error) {
      sendJson(response, error.statusCode || 400, errorPayload('INVALID_JSON_BODY', error.message));
      return;
    }
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt : 'Reply with a one sentence health check.';
    const started = Date.now();
    try {
      const result = await upstreamJson(context.config, '/api/chat', {
        method: 'POST',
        timeoutMs: context.config.upstreamTimeoutMs,
        body: {
          model: activeModel.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          keep_alive: context.config.forcedKeepAlive
        }
      });
      await persistEvent(context.store, {
        type: 'admin_test_chat',
        model: activeModel.model,
        status: result.status,
        latencyMs: Date.now() - started,
        ok: result.ok
      });
      sendJson(response, result.ok ? 200 : result.status, {
        ok: result.ok,
        status: result.status,
        model: activeModel.model,
        upstream: result.body,
        usage: result.usage
      });
    } catch (error) {
      await persistEvent(context.store, { type: 'admin_test_chat_failed', model: activeModel.model, error: error.message });
      sendJson(response, 502, errorPayload('UPSTREAM_ERROR', error.message));
    }
    return;
  }

  sendJson(response, 404, errorPayload('ADMIN_ROUTE_NOT_FOUND', 'Admin API route not found.'));
}

async function rejectProxyRequest(response, context, record, status, code, message, extra = {}) {
  const finalRecord = {
    ...record,
    ...extra,
    allowed: false,
    rejected: true,
    responseStatus: status,
    status,
    errorCode: code,
    errorSummary: message,
    latencyMs: Date.now() - record.startedEpochMs
  };
  await persistRequest(context.store, context.metrics, finalRecord);
  await persistEvent(context.store, {
    type: 'request_rejected',
    code,
    message,
    endpoint: record.endpoint,
    method: record.method,
    requestedModel: extra.requestedModel,
    activeModel: extra.activeModel,
    clientIdentity: record.clientIdentity,
    sourceIp: record.sourceIp
  });
  sendJson(response, status, errorPayload(code, message));
}

async function handleProxy(request, response, url, context) {
  const pathname = url.pathname;
  const recordBase = {
    ...createBaseRecord(request, pathname),
    query: url.search || '',
    startedEpochMs: Date.now()
  };

  let incomingBody = null;
  let rawBody = null;
  if (methodAllowsBody(request.method)) {
    try {
      rawBody = await readRequestBody(request, context.config.maxBodyBytes);
      incomingBody = parseJsonBuffer(rawBody);
    } catch (error) {
      await rejectProxyRequest(response, context, recordBase, error.statusCode || 400, 'INVALID_JSON_BODY', error.message);
      return;
    }
  }

  const activeModel = await readActiveModel(context.config);
  const isModelBodyRoute = MODEL_BODY_ROUTES.has(routeKey(request.method, pathname));
  if (context.state.maintenanceMode && isModelBodyRoute) {
    await rejectProxyRequest(response, context, recordBase, 503, 'MAINTENANCE_MODE', 'Router maintenance mode is enabled.', {
      activeModel: activeModel.model,
      requestedModel: incomingBody?.model || null,
      bodySummary: summarizeBody(incomingBody, context.config.promptLogging)
    });
    return;
  }

  const policy = evaluateProxyPolicy({
    method: request.method,
    pathname,
    body: incomingBody,
    activeModelInfo: activeModel,
    config: context.config,
    isAdmin: hasAdminAuth(request, context.config)
  });

  const commonRecord = {
    ...recordBase,
    activeModel: policy.activeModel,
    requestedModel: policy.requestedModel,
    incomingKeepAlive: policy.incomingKeepAlive,
    forwardedKeepAlive: policy.forwardedKeepAlive,
    keepAliveNormalized: Boolean(policy.keepAliveNormalized),
    streaming: isLikelyStreamingRequest(pathname, policy.sanitizedBody),
    bodySummary: summarizeBody(incomingBody, context.config.promptLogging)
  };

  if (!policy.allowed) {
    await rejectProxyRequest(response, context, commonRecord, policy.status || 403, policy.code, policy.message, {
      activeModel: policy.activeModel,
      requestedModel: policy.requestedModel,
      incomingKeepAlive: policy.incomingKeepAlive,
      forwardedKeepAlive: policy.forwardedKeepAlive
    });
    return;
  }

  if (policy.keepAliveNormalized) {
    await persistEvent(context.store, {
      type: 'keep_alive_normalized',
      endpoint: pathname,
      method: request.method,
      model: policy.requestedModel,
      incomingKeepAlive: policy.incomingKeepAlive,
      forwardedKeepAlive: policy.forwardedKeepAlive,
      clientIdentity: commonRecord.clientIdentity,
      sourceIp: commonRecord.sourceIp
    });
  }

  const upstreamPath = `${pathname}${url.search || ''}`;
  const started = Date.now();
  let upstreamResponse;
  try {
    const hasBody = methodAllowsBody(request.method) && policy.sanitizedBody !== null;
    upstreamResponse = await fetch(`${context.config.upstreamUrl}${upstreamPath}`, {
      method: request.method,
      headers: filterRequestHeaders(request.headers, hasBody ? { 'content-type': 'application/json' } : {}),
      body: hasBody ? JSON.stringify(policy.sanitizedBody) : undefined
    });
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 502;
    const finalRecord = {
      ...commonRecord,
      allowed: true,
      rejected: false,
      responseStatus: status,
      status,
      upstreamError: true,
      errorSummary: error.message,
      latencyMs: Date.now() - started
    };
    await persistRequest(context.store, context.metrics, finalRecord);
    await persistEvent(context.store, { type: 'upstream_request_failed', endpoint: pathname, error: error.message });
    sendJson(response, status, errorPayload('UPSTREAM_REQUEST_FAILED', error.message));
    return;
  }

  const streaming = commonRecord.streaming && upstreamResponse.body;
  let usage = null;
  let responseBytes = 0;
  let parseErrors = 0;

  try {
    if (streaming) {
      const collector = new NdjsonUsageCollector();
      copyUpstreamHeaders(upstreamResponse.headers, response, true);
      response.writeHead(upstreamResponse.status);
      const reader = upstreamResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        responseBytes += buffer.length;
        collector.observe(buffer);
        if (!response.write(buffer)) await once(response, 'drain');
      }
      const collected = collector.finish();
      usage = collected.usage;
      parseErrors = collected.parseErrors;
      response.end();
    } else {
      const arrayBuffer = await upstreamResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      responseBytes = buffer.length;
      const contentType = upstreamResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json') && buffer.length) {
        try {
          usage = extractUsageFromOllamaObject(JSON.parse(buffer.toString('utf8')));
        } catch {
          parseErrors = 1;
        }
      }
      copyUpstreamHeaders(upstreamResponse.headers, response, false);
      response.setHeader('content-length', buffer.length);
      response.writeHead(upstreamResponse.status);
      response.end(buffer);
    }
  } catch (error) {
    await persistEvent(context.store, { type: 'proxy_stream_failed', endpoint: pathname, error: error.message });
    if (!response.headersSent) {
      sendJson(response, 502, errorPayload('PROXY_STREAM_FAILED', error.message));
    } else {
      response.destroy(error);
    }
  } finally {
    const finalRecord = {
      ...commonRecord,
      allowed: true,
      rejected: false,
      responseStatus: upstreamResponse.status,
      status: upstreamResponse.status,
      upstreamError: !upstreamResponse.ok,
      latencyMs: Date.now() - started,
      responseBytes,
      usage,
      streamParseErrors: parseErrors
    };
    await persistRequest(context.store, context.metrics, finalRecord);
  }
}

async function handleRequest(request, response, context) {
  const url = new URL(request.url || '/', 'http://router.local');
  const pathname = url.pathname;

  try {
    if (request.method === 'GET' && pathname === '/') {
      sendText(response, 200, 'Ollama is running\n', { 'x-ollama-router': 'local-ai-ollama-router' });
      return;
    }

    if (request.method === 'GET' && pathname === '/health') {
      await handleHealth(response, context);
      return;
    }

    if (pathname === '/admin') {
      response.writeHead(302, { location: '/admin/' });
      response.end();
      return;
    }

    if (pathname.startsWith('/admin/api/')) {
      await handleAdminApi(request, response, pathname, context);
      return;
    }

    if (request.method === 'GET' && pathname.startsWith('/admin/')) {
      await serveStaticFile(response, PUBLIC_ROOT, pathname.slice('/admin/'.length) || 'index.html');
      return;
    }

    if (pathname.startsWith('/api/')) {
      await handleProxy(request, response, url, context);
      return;
    }

    sendJson(response, 404, errorPayload('NOT_FOUND', 'Route not found.'));
  } catch (error) {
    console.error('unhandled request error', error);
    if (!response.headersSent) {
      sendJson(response, 500, errorPayload('INTERNAL_ERROR', error.message));
    } else {
      response.destroy(error);
    }
  }
}

export async function createRouterServer(config = loadConfig()) {
  const store = new JsonlStore(config);
  await store.init();
  const metrics = new Metrics();
  metrics.rebuild(store.requests);
  const context = {
    config,
    store,
    metrics,
    state: {
      startedAt: nowIso(),
      maintenanceMode: false
    }
  };

  await persistEvent(store, {
    type: 'router_startup',
    version: config.version,
    upstreamUrl: config.upstreamUrl,
    modelPolicyMode: config.modelPolicyMode,
    protectedModelEndpoints: config.protectedModelEndpoints
  });

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, context);
  });
  return { server, context };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const { server } = await createRouterServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`${config.appName} ${config.version} listening on http://${config.host}:${config.port}`);
    console.log(`Upstream Ollama: ${config.upstreamUrl}`);
    console.log(`Active model marker: ${config.activeModelFile}`);
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
