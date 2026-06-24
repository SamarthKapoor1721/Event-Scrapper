import { EventEmitter } from 'node:events';

/**
 * In-memory log bus. Each scrape job streams structured log + progress events
 * which the frontend consumes over Server-Sent Events (SSE).
 *
 * A job is a short-lived channel keyed by jobId. Logs are also buffered so a
 * client that connects slightly late still receives backlog.
 */
class LogBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.buffers = new Map(); // jobId -> [events]
  }

  _push(jobId, event) {
    const payload = { ...event, jobId, ts: Date.now() };
    if (!this.buffers.has(jobId)) this.buffers.set(jobId, []);
    const buf = this.buffers.get(jobId);
    buf.push(payload);
    if (buf.length > 500) buf.shift();
    this.emit(jobId, payload);
    // Console mirror for server-side visibility.
    const tag = `[${jobId.slice(0, 8)}]`;
    if (event.type === 'log') {
      const fn = event.level === 'error' ? console.error : console.log;
      fn(`${tag} ${event.level?.toUpperCase() || 'INFO'}: ${event.message}`);
    }
  }

  log(jobId, message, level = 'info') {
    this._push(jobId, { type: 'log', level, message });
  }

  progress(jobId, percent, label) {
    this._push(jobId, { type: 'progress', percent: Math.max(0, Math.min(100, percent)), label });
  }

  done(jobId, result) {
    this._push(jobId, { type: 'done', result });
  }

  error(jobId, message) {
    this._push(jobId, { type: 'error', message });
  }

  backlog(jobId) {
    return this.buffers.get(jobId) || [];
  }

  clear(jobId) {
    this.buffers.delete(jobId);
  }
}

export const logBus = new LogBus();

/** Lightweight per-job logger handle passed through the scraping pipeline. */
export function jobLogger(jobId) {
  return {
    jobId,
    log: (msg, level = 'info') => logBus.log(jobId, msg, level),
    info: (msg) => logBus.log(jobId, msg, 'info'),
    warn: (msg) => logBus.log(jobId, msg, 'warn'),
    error: (msg) => logBus.log(jobId, msg, 'error'),
    success: (msg) => logBus.log(jobId, msg, 'success'),
    progress: (percent, label) => logBus.progress(jobId, percent, label),
  };
}
