# Stage 2 — public catalog latency (PROPOSAL, not deployed)

Base: `main@fe86808`. Hotfix stage 1 (frontend UNKNOWN state) is PR #35 and is independent of this branch.

## Measurements (2026-11-16, ART, from the Linux box; GET only)
| Path | samples (s) | mean |
|---|---|---|
| Worker `GET /api/catalog` (production) | 8.34 · 7.54 · 6.17 · 6.36 · 8.55 (+ earlier 8.02 · 10.13 · 6.91 · 7.70; node probes 11.1 · 6.1 · 9.7 · 6.2 · 8.3 · 21.8; owner measured 16.3) | ~7.4 (p50), tail up to 16–22 |
| Apps Script `?format=json` directly (1 redirect) | 3.30 · 4.28 · 6.13 · 5.21 · 4.90 | ~4.8 |

So ≈ 2.6 s is the Worker doing `reconcileExpiredReservations()` (a `getExpiredOrders` POST to Apps Script + MP lookups) *before* the
catalog read, and ≈ 4.8 s is Apps Script `getCatalog()` itself.

## Root causes (code)
1. `worker/src/index.js` `GET /api/catalog`: `await reconcileExpiredReservations(env)` runs synchronously on every public read (one extra
   Apps Script round trip, plus one Mercado Pago call per expired order).
2. `Code.js getCatalog()`: `ensureCatalogColumns(catalogSheet())` + `releaseExpiredReservations()` (takes the global **script lock**,
   `waitLock(20000)`, re-opens the spreadsheet and reads catalog + operations in full) + a third `catalogSheet()`/read. Every public read
   serialises on the same lock that `reserveExperience`/payment transitions use, so concurrent guests queue behind each other and behind checkouts.
3. No caching/single-flight: N guests => N full Apps Script executions.

## Proposal (all backwards compatible; payment flow untouched)
**A. Worker (`catalog_cache.js` + 3 small hooks in `index.js`)**
- Public read goes through a per-isolate, display-only cache: fresh 10 s, stale-while-revalidate up to 60 s (single background refresh), never
  older; single-flight (50 concurrent readers => 1 upstream read).
- Only complete valid catalogs are cached (array, every row has `id` + non-empty `status`); errors / invalid / empty / partial are never cached
  nor served, so the page (hotfix) falls into its safe UNKNOWN + retry state.
- Reconciliation leaves the request path: throttled background `ctx.waitUntil` (≤ 1 per 30 s per isolate) + the existing `*/5` cron.
  `getCatalog()` still frees plain expired holds itself; holds that own a Mercado Pago order are released only by reconcile (≤ ~30 s–5 min later
  instead of on the very same request — this is the one behavioural change, and it is the conservative direction: a gift stays hidden longer, never exposed early).
- Invalidation: `create-order`, `order-status` (it confirms payments), `/webhook/mp`, `reconcile-*`, `admin/cancel-order`, `dedication` invalidate the
  cache **before and after** the handler; a generation counter guarantees a read that started before an invalidation is never stored and later
  callers never join it. Cache API is per-colo, so cross-colo staleness is bounded by the 10 s fresh / 60 s stale windows (an optional KV/Durable Object
  flag would give global invalidation; not proposed now: extra moving part and quota).
- Exclusivity: reservation/checkout/webhook code never reads the cache (asserted by test). `reserveExperience` under `LockService` stays the only
  authority; a stale "Disponible" can at worst show a button that the server then rejects (existing behaviour) — and the hotfix hides price/button until a live read.

**B. Apps Script `getCatalog()` (only this function changes)**
- Open the spreadsheet once, read the catalog once, and enter `releaseExpiredReservations()` (lock + original unsettled-payment guard, unchanged)
  only if a `Reservada temporalmente`/`Pago pendiente` row is expired. Differential test vs `main` on 400 random states: identical output and identical sheet side effects;
  0 lock waits and 1 `openById` when nothing is expired (was 1 lock + 3 opens).
- Expected: removes lock contention from guest reads and ~2 of 3 spreadsheet opens; real gain must be measured in staging before any deploy.

## Tests (local, hermetic): `tests/catalog_latency_stage2.test.mjs` (12) + full existing suite (114/114 without `live_backend_integration`)
single-flight, TTL/SWR/max-stale, never-cache-bad-payloads, invalidate-during-flight, 200 randomised interleavings, worker not blocked by a hanging reconcile,
every mutating route invalidates, checkout never reads cache, Apps Script differential + lock counts + unsettled-payment guard.

## NOT done / required before deploying (high risk => needs owner OK)
- Deploy order: Worker first (gives ~all of the user-visible gain), Apps Script second. Both need a staging deployment + MP sandbox run of
  approve / pending / reject / expiry / refund, webhook replay and a concurrency run against a *separate* sheet.
- Do **not** run `tests/live_backend_integration.test.mjs`: its "STAGING" Apps Script URL points at the live sheet (it creates a real temporary reservation).
- Optional: cron `*/1` pre-warm so the first guest after idle never pays the full read.
