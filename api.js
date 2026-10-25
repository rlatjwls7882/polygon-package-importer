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
  static sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  constructor(key, secret) {
    this.key = key.trim();
    this.secret = secret.trim();
    if (!this.key || !this.secret) throw Error('API Key와 Secret이 필요합니다.');
    this.minimumIntervalMs = PolygonAPI.minimumIntervalMs;
    this.onRateLimit = null;
    this._gate = Promise.resolve();
    this._nextRequestAt = 0;
    this._cooldownUntil = 0;
  }

  safeDetail(detail) {
    let result = String(detail ?? '');
    for (const credential of [this.secret, this.key]) {
      if (!credential) continue;
      for (const token of [credential, encodeURIComponent(credential)]) {
        if (token) result = result.split(token).join('[비공개]');
      }
    }
    return result.slice(0, 300);
  }

  async pacedRequest(run) {
    const invoke = async () => {
      const wait = Math.max(0, this._nextRequestAt - Date.now(), this._cooldownUntil - Date.now());
      if (wait > 0) await PolygonAPI.sleep(wait);
      this._nextRequestAt = Date.now() + this.minimumIntervalMs;
      // Include the fetch in the queued operation; only one signed request
      // is in flight at a time from this tab.
      return run();
    };
    const turn = this._gate.then(invoke, invoke);
    this._gate = turn.catch(() => {});
    return turn;
  }

  async requestOnce(method, args) {
    return this.pacedRequest(async () => {
      if (this.sessionActive && !this.sessionActive())
        throw Error(method + ': API 보관함이 잠겨 요청을 중단했습니다.');
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
        throw Error(method + ': 요청 전 API 보관함이 잠겨 업로드를 중단했습니다.');

      try {
        return await fetch(BASE + method, {
          method:'POST', body:form, credentials:'omit', redirect:'error', cache:'no-store',
          signal:AbortSignal.timeout(120000)
        });
      } catch (e) {
        // The request could have reached Polygon; do not repeat uncertain mutations.
        throw Error(method + ': 네트워크 실패 (' + this.safeDetail(e?.message) +
          '). 서버에서 처리되었을 수 있으므로 다음 실행에서 상태를 재조회하세요.');
      }
    });
  }

  async call(method, args = {}, { binary = false, raw = false } = {}) {
    for (let attempt = 0; attempt <= 4; attempt++) {
      const response = await this.requestOnce(method, args);
      const rateLimited = response.status === 429;
      let payload = null;
      let json = null;
      if (!rateLimited) {
        if ((binary || raw) && response.ok) {
          const mediaType = response.headers.get('content-type') || '';
          if (binary && !mediaType.includes('json')) return response.blob();
          const text = await response.text();
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
          payload = await response.text();
        }
        try { if (!json) json = JSON.parse(payload); }
        catch {
          throw Error(method + ': 예상하지 못한 응답 (HTTP ' + response.status +
            ', ' + this.safeDetail(String(payload).slice(0, 120)) + ')');
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
          throw Error(method + ': Polygon API 요청 제한이 반복됐습니다. 제한이 풀린 후 다시 실행하면 이미 저장한 항목은 건너뜁니다.');
        this.onRateLimit?.({method, attempt:attempt+1, waitMs:wait});
        continue;
      }
      if (!response.ok || json?.status !== 'OK')
        throw Error(method + ': ' + this.safeDetail(json?.comment || ('HTTP ' + response.status)));
      return json.result;
    }
    throw Error(method + ': 요청 제한으로 종료되었습니다.');
  }

  problem(method, id, args = {}, opts = {}) {
    return this.call('problem.' + method, {problemId:id, ...args}, opts);
  }
}
