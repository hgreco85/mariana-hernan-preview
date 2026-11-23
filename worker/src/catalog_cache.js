// Stage 2 (NOT deployed): short-lived, single-flight cache for the PUBLIC read-only catalog.
//
// Safety model
//  * Display-only. Reservation / checkout / webhooks never read this cache: the Apps Script
//    LockService reservation remains the single authority for exclusivity (no duplicate purchases).
//  * Only complete, valid catalogs are cached (JSON array, every row has id + non-empty status).
//    Errors, invalid JSON, empty or partial payloads are never cached and never served from cache.
//  * Fresh window (default 10 s) -> served as is. Stale window (default 60 s) -> served immediately while ONE
//    background refresh runs. Older than the stale window -> blocking refresh (never serve ancient data).
//  * invalidate() bumps a generation: results of fetches that started before an invalidation are returned to
//    their own waiters but are never stored, and later callers never join a pre-invalidation fetch.
export function isValidCatalogText(text) {
  try {
    const d = JSON.parse(text);
    return Array.isArray(d) && d.length > 0 &&
      d.every(r => r && r.id && typeof r.status === 'string' && r.status.trim() !== '');
  } catch (e) { return false; }
}

export function createCatalogService({ freshMs = 10000, staleMaxMs = 60000, now = () => Date.now() } = {}) {
  let entry = null;           // { text, at }
  let inflight = null;        // { promise, gen }
  let gen = 0;

  function refresh(fetchUpstream) {
    if (inflight && inflight.gen === gen) return inflight.promise;
    const myGen = gen;
    const mine = { gen: myGen };
    mine.promise = (async () => {
      try {
        const r = await fetchUpstream();
        const text = r && typeof r.text === 'string' ? r.text : '';
        const ok = r && r.status === 200 && isValidCatalogText(text);
        if (ok && myGen === gen) entry = { text, at: now() };
        return { ok, status: r ? r.status : 502, text };
      } finally {
        if (inflight === mine) inflight = null;
      }
    })();
    inflight = mine;
    return mine.promise;
  }

  return {
    // Returns { status, text, source, ageMs }. On upstream failure with nothing servable returns the upstream status/text
    // exactly like the pre-cache proxy did, so the page falls into its safe (UNKNOWN + retry) state.
    async get({ fetchUpstream, waitUntil } = {}) {
      const t = now();
      if (entry) {
        const age = t - entry.at;
        if (age <= freshMs) return { status: 200, text: entry.text, source: 'cache', ageMs: age };
        if (age <= staleMaxMs) {
          const bg = refresh(fetchUpstream).catch(() => {});
          if (typeof waitUntil === 'function') waitUntil(bg);
          return { status: 200, text: entry.text, source: 'stale', ageMs: age };
        }
        entry = null;
      }
      let r;
      try { r = await refresh(fetchUpstream); } catch (e) { return { status: 502, text: JSON.stringify({ error: 'catalog unavailable' }), source: 'error', ageMs: 0 }; }
      return { status: r.ok ? 200 : (r.status === 200 ? 502 : r.status), text: r.text, source: r.ok ? 'origin' : 'error', ageMs: 0 };
    },
    invalidate() { gen++; entry = null; },
    _state() { return { hasEntry: !!entry, inflight: !!inflight, gen }; }
  };
}
