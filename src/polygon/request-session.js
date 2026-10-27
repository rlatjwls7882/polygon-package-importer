import { discardResponse } from './response.js';

// The timer and its abort listener have the same owner. Disposing a session
// cancels cooldowns as well as fetches; queued requests never wait out a backoff.
export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const finish = (callback, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    const timer = setTimeout(() => finish(resolve), ms);
    signal?.addEventListener('abort', abort, {once:true});
  });
}

export class RequestSession {
  constructor() {
    this.controller = new AbortController();
    this.tail = Promise.resolve();
    this.requests = new Set();
    this.responses = new Map();
  }

  get closed() { return this.controller.signal.aborted; }
  checkOpen() { this.controller.signal.throwIfAborted(); }

  enqueue(run) {
    const invoke = () => {this.checkOpen(); return run();};
    const turn = this.tail.then(invoke, invoke);
    this.tail = turn.then(() => {}, () => {});
    return turn;
  }

  wait(ms, sleep = abortableDelay) {
    this.checkOpen();
    const signal = this.controller.signal;
    // Also cancel the wait when an injected clock does not consume the signal.
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {signal.removeEventListener('abort', abort); callback(value);};
      const abort = () => finish(reject, signal.reason);
      signal.addEventListener('abort', abort, {once:true});
      Promise.resolve().then(() => {this.checkOpen(); return sleep(ms, signal);})
        .then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  async fetch(url, options) {
    this.checkOpen();
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 120000);
    const cleanup = () => {clearTimeout(timer); this.requests.delete(controller);};
    try {
      const response = await fetch(url, {...options, signal:controller.signal});
      if (this.closed) {await discardResponse(response); this.checkOpen();}
      this.responses.set(response, cleanup);
      return response;
    } catch (error) {cleanup(); throw error;}
  }

  async release(response) {
    try {await discardResponse(response);}
    finally {this.responses.get(response)?.(); this.responses.delete(response);}
  }

  dispose() {
    if (this.closed) return;
    this.controller.abort();
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    for (const [response, cleanup] of this.responses) {
      discardResponse(response).catch(() => {}); cleanup();
    }
    this.responses.clear();
  }
}
