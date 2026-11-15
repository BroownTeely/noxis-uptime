'use strict';

const MAX_ATTEMPTS = 4;

/**
 * Fila de envio em memória com concorrência limitada, backoff exponencial e
 * reenvio após HTTP 429 (respeitando retry_after). Entregas são registradas
 * pelo chamador através do callback onDone.
 */
class NotificationQueue {
  constructor({ concurrency = 2, send, onDone }) {
    this.concurrency = concurrency;
    this.send = send;
    this.onDone = onDone;
    this.items = [];
    this.active = 0;
    this.timers = new Set();
  }

  enqueue(job) {
    this.items.push({ ...job, attempts: 0 });
    this.pump();
  }

  get size() {
    return this.items.length + this.active + this.timers.size;
  }

  pump() {
    while (this.active < this.concurrency && this.items.length) {
      const job = this.items.shift();
      this.active += 1;
      this.attempt(job).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async attempt(job) {
    job.attempts += 1;
    let result;
    try {
      result = await this.send(job);
    } catch (err) {
      result = { ok: false, error: err.message };
    }

    if (result.ok) {
      await this.onDone(job, { state: result.simulated ? 'simulated' : 'sent', attempts: job.attempts, httpStatus: result.status, error: null });
      return;
    }
    const exhausted = job.attempts >= MAX_ATTEMPTS || result.permanent;
    if (exhausted) {
      await this.onDone(job, { state: 'failed', attempts: job.attempts, httpStatus: result.status, error: result.error });
      return;
    }
    const delay = result.retryAfterMs ?? Math.min(30000, 1000 * 2 ** (job.attempts - 1));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.items.unshift(job);
      this.pump();
    }, delay);
    timer.unref();
    this.timers.add(timer);
  }

  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.items.length = 0;
  }
}

module.exports = { NotificationQueue, MAX_ATTEMPTS };
