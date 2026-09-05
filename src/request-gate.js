import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class RequestGateError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'RequestGateError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class RequestGate {
  constructor(controlFile, options = {}) {
    this.controlFile = controlFile;
    this.now = options.now || (() => new Date());
    this.draining = false;
    this.drainReason = null;
    this.drainUpdatedAt = null;
    this.active = new Map();
    this.waiters = new Set();
  }

  async init() {
    if (!this.controlFile) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.controlFile, 'utf8'));
      this.draining = parsed?.draining === true;
      this.drainReason = typeof parsed?.reason === 'string' ? parsed.reason : null;
      this.drainUpdatedAt = typeof parsed?.updated_at === 'string' ? parsed.updated_at : null;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
    }
  }

  snapshot(activeModel = null) {
    const entries = [...this.active.values()];
    return {
      draining: this.draining,
      drain_reason: this.drainReason,
      drain_updated_at: this.drainUpdatedAt,
      active_count: entries.length,
      active_generation_ids: entries.map((entry) => entry.id),
      active_by_endpoint: entries.reduce((counts, entry) => {
        counts[entry.endpoint] = (counts[entry.endpoint] || 0) + 1;
        return counts;
      }, {}),
      backend_kind: activeModel?.backend_kind || 'ollama',
      profile: activeModel?.profile || null,
      model: activeModel?.model || null,
      max_active_requests: activeModel?.max_active_requests ?? null,
      queue_policy: activeModel?.backend_kind === 'llama_cpp' ? 'reject-third-request' : 'backend-managed',
      queued_count: 0
    };
  }

  async setDraining(enabled, reason = null) {
    this.draining = Boolean(enabled);
    this.drainReason = this.draining && typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null;
    this.drainUpdatedAt = this.now().toISOString();
    await this.persist();
    return this.snapshot();
  }

  acquire({ endpoint, clientIdentity, limit = null } = {}) {
    if (this.draining) {
      throw new RequestGateError(
        503,
        'BACKEND_DRAINING',
        'The active inference backend is draining for a runtime transition. Retry shortly.'
      );
    }
    if (Number.isSafeInteger(limit) && limit > 0 && this.active.size >= limit) {
      throw new RequestGateError(
        429,
        'BACKEND_CONCURRENCY_LIMIT',
        `The active inference backend is already serving its ${limit} concurrent request slots. Retry shortly.`
      );
    }

    const id = randomUUID();
    const entry = {
      id,
      endpoint: endpoint || 'unknown',
      clientIdentity: clientIdentity || 'unknown',
      startedAt: this.now().toISOString()
    };
    this.active.set(id, entry);
    let released = false;
    return {
      id,
      release: () => {
        if (released) return false;
        released = true;
        this.active.delete(id);
        if (this.active.size === 0) {
          for (const waiter of this.waiters) waiter();
          this.waiters.clear();
        }
        return true;
      }
    };
  }

  async waitForIdle(timeoutMs) {
    if (this.active.size === 0) return true;
    return await new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.waiters.delete(onIdle);
        resolve(value);
      };
      const onIdle = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.waiters.add(onIdle);
    });
  }

  async persist() {
    if (!this.controlFile) return;
    const directory = path.dirname(this.controlFile);
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${this.controlFile}.tmp-${process.pid}-${randomUUID()}`;
    const payload = `${JSON.stringify({
      schema_version: 1,
      draining: this.draining,
      reason: this.drainReason,
      updated_at: this.drainUpdatedAt
    }, null, 2)}\n`;
    await fs.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.controlFile);
  }
}
