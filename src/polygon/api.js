import { discardResponse, readBinary, readText, RESPONSE_LIMITS } from './response.js';
import { RequestSession, abortableDelay } from './request-session.js';
import { MAX_ZIP_SIZE } from '../package/zip.js';
import { t } from '../i18n.js';
const BASE = 'https://polygon.codeforces.com/api/';
const encoder = new TextEncoder();

function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.ceil(Number(text) * 1000));
  const when = Date.parse(text);
  return Number.isFinite(when) ? Math.max(0, when - now) : null;
}

export class PolygonAPI {
  // Polygon does not document a fixed per-request interval. Start faster,
  // but slow down for the remainder of the job if the server throttles us.
  // Requests remain serialized, including signing and fetch.
  static minimumIntervalMs = 1200;
  static throttledIntervalMs = 2200;
  static maximumIntervalMs = 12000;
  static sleep = abortableDelay;

  constructor(key, secret, limits = {}) {
    this.key = key.trim();
    this.secret = secret.trim();
    if (!this.key || !this.secret) throw Error(t('apiMissingCredentials'));
    this.minimumIntervalMs = PolygonAPI.minimumIntervalMs;
    this.onRateLimit = null;
    this.session = new RequestSession();
    this.limits = {...RESPONSE_LIMITS, ...limits};
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value < 1))
      throw new RangeError('Invalid response limit');
    this._nextRequestAt = 0;
    this._cooldownUntil = 0;
  }

  dispose() {
    this.session.dispose();
    this.onRateLimit = null; this.sessionActive = null;
    this.key = ''; this.secret = '';
  }

  checkOpen() { this.session.checkOpen(); }

  safeDetail(detail) {
    let result = String(detail ?? '');
    for (const credential of [this.secret, this.key]) {
      if (!credential) continue;
      for (const token of [credential, encodeURIComponent(credential)]) {
        if (token) result = result.split(token).join(t('apiRedacted'));
      }
    }
    return result.slice(0, 300);
  }

  async pacedRequest(run) {
    this.checkOpen();
    const wait = Math.max(0, this._nextRequestAt - Date.now(), this._cooldownUntil - Date.now());
    if (wait > 0) await this.session.wait(wait, PolygonAPI.sleep);
    this.checkOpen();
    this._nextRequestAt = Date.now() + this.minimumIntervalMs;
    return run();
  }

  call(method, args = {}, options = {}) {
    // Keep response parsing and retries in the same queue slot. Otherwise the
    // next fetch can start before a slow 429 body has set the shared cooldown.
    return this.session.enqueue(() => this.callSerial(method, args, options));
  }

  async requestOnce(method, args) {
    return this.pacedRequest(async () => {
      if (this.sessionActive && !this.sessionActive())
        throw Error(t('apiApiVaultLockedRequestCancelled', method));
      // Sign AFTER waiting, so the timestamp remains valid even after long 429 cooldowns.
      const p = Object.entries({ ...args, apiKey:this.key, time:String(Math.floor(Date.now() / 1000)) })
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
        .sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0);
      const prefix = Array.from(crypto.getRandomValues(new Uint8Array(3)),
        x => x.toString(16).padStart(2, '0')).join('');
      const canonical = prefix + '/' + method + '?' + p.map(([k, v]) => k + '=' + v).join('&') + '#' + this.secret;
      const digest = await crypto.subtle.digest('SHA-512', encoder.encode(canonical));
      const hex = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
      const form = new URLSearchParams();
      for (const [k, v] of p) form.append(k, v);
      form.set('apiSig', prefix + hex);
      if (this.sessionActive && !this.sessionActive())
        throw Error(t('apiApiVaultLockedBeforeTheRequestUpload', method));

      this.checkOpen();
      try {
        return await this.session.fetch(BASE + method, {
          method:'POST', body:form, credentials:'omit', redirect:'error', cache:'no-store'
        });
      } catch (error) {
        // Closed sessions expose no late transport detail that could contain
        // credentials already removed by dispose(). Uncertain writes are not retried.
        this.checkOpen();
        throw Error(t('apiNetworkErrorPolygonMayHaveProcessedThe', method, this.safeDetail(error?.message)));
      }
    });
  }

  async callSerial(method, args, { binary = false, raw = false } = {}) {
    for (let attempt = 0; attempt <= 4; attempt++) {
      const response = await this.requestOnce(method, args);
      try {
        const limit = response.ok ? (raw ? this.limits.rawBytes : this.limits.jsonBytes) : this.limits.errorBytes;
        const textBody = () => readText(response, limit, t('apiResponseTooLarge', method, limit));
        const rateLimited = response.status === 429;
        if (rateLimited) await discardResponse(response);
        let payload = null;
        let json = null;
        if (!rateLimited) {
          if ((binary || raw) && response.ok) {
            const mediaType = response.headers.get('content-type') || '';
            if (binary && !mediaType.includes('json')) return await readBinary(response, MAX_ZIP_SIZE, t('zipArchiveTooLarge'));
            const text = await textBody();
            // A .json resource itself may be served as application/json.
            // Treat only an explicit Polygon FAILED envelope as an API error.
            if (raw) {
              if (mediaType.includes('json')) {
                try {
                  const parsed = JSON.parse(text);
                  if (parsed && parsed.status === 'FAILED' && typeof parsed.comment === 'string')
                    json = parsed; // A Polygon error, not the requested raw file.
                } catch (e) {
                  if (!(e instanceof SyntaxError)) throw e;
                }
              }
              if (!json) return text;
            } else payload = text;
          } else {
            payload = await textBody();
          }
          try { if (!json) json = JSON.parse(payload); }
          catch {
            throw Error(t('apiUnexpectedResponseHttp', method, response.status, this.safeDetail(String(payload).slice(0, 120))));
          }
        }
        const message = String(json?.comment || '');
        const jsonRateLimit = json?.status === 'FAILED' &&
          /(?:rate\s*limit|too many requests|call limit exceeded)/i.test(message);
        if (rateLimited || jsonRateLimit) {
          // Gradually slow the remaining requests if the server rejects our pace.
          // Use a longer default pause for gateway HTTP 429 responses than for
          // API-level limit responses; honor Retry-After whenever provided.
          this.minimumIntervalMs = Math.min(PolygonAPI.maximumIntervalMs,
            Math.max(Math.ceil(this.minimumIntervalMs * 1.8),
              rateLimited ? 3200 : PolygonAPI.throttledIntervalMs));
          const serverWait = retryAfterMs(response.headers.get('retry-after'));
          const fallback = (rateLimited ? 20000 : 4000) * (2 ** Math.min(attempt, 3));
          const wait = Math.min(240000, Math.max(this.minimumIntervalMs, serverWait ?? fallback));
          this._cooldownUntil = Math.max(this._cooldownUntil, Date.now() + wait);
          if (attempt >= 4)
            throw Error(t('apiPolygonRateLimitReachedRepeatedlyRetryLater', method));
          this.onRateLimit?.({method, attempt:attempt+1, waitMs:wait});
          continue;
        }
        if (!response.ok || json?.status !== 'OK')
          throw Error(method + ': ' + this.safeDetail(json?.comment || ('HTTP ' + response.status)));
        return json.result;
      } finally {
        await this.session.release(response);
      }
    }
    throw Error(t('apiStoppedDueToRateLimits', method));
  }

  problem(method, id, args = {}, opts = {}) {
    return this.call('problem.' + method, {problemId:id, ...args}, opts);
  }
}
