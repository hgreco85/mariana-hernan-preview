# Wedding P0 — Scheduler cutover to existing Google Apps Script (USD 0)

Status: **PROPOSED, NOT DEPLOYED**. Do NOT disable the working GitHub Actions
schedule until three independent time-trigger executions are observed.

## Why NOT the HG Cloudflare dispatcher

- Account Workers Free has five Cron Triggers; the existing
  `HG-Market-System/infra/cloudflare/dispatcher/wrangler.toml` uses all five.
- The dispatcher's current routes run every 2, 4, 6 and 12 hours, not every
  five minutes. Direct reuse violates reservation TTL expectations.
- A safe cron coalescence is theoretically possible (the 4h and 6h jobs can
  share a 2h trigger and be gated by UTC hour), but redeploying the versioned
  manifest would also risk re-enabling CLOSED PolyCopy routes (see
  HG-Market-System PR #1434). Therefore **do not change or redeploy** that
  separate financial/market infrastructure for wedding scheduling.

## Alternative selected

Use the wedding Google Apps Script project's native installable timer:

- Source: `WeddingReconciliationTimer.gs` in this repo.
- Existing Apps Script project: `.clasp.json` (do not create a new project).
- Cadence: `ScriptApp.newTrigger(...).timeBased().everyMinutes(5)`.
- Calls existing production Cloudflare Worker:
  `POST https://mp-webhook-production.hgreco85.workers.dev/api/reconcile-expired`
- Reuses Apps Script's existing `BACKEND_SHARED_SECRET` Script Property, which
  must match the Worker's existing `SHARED_SECRET`. Never echo the value.
- Existing Worker reconciles actual Mercado Pago Orders, checks external
  references, preserves payment states, and uses an Apps Script lock for atomic
  sheet changes. The trigger itself never holds the same lock across network.
- The timer records only `WEDDING_RECONCILE_LAST_OK_AT` and safe aggregate
  metrics in Script Properties and Apps Script execution logs. No Order IDs or
  credentials are logged.
- No changes to MP, payments, prices, subscriptions, account billing, IAM,
  Cron Triggers or HG dispatcher.

## Quotas — mandatory preflight

- Triggers: up to 20 per user per script; this project adds **one** timer.
- UrlFetch: one to the Worker per scheduled run.
- `everyMinutes(5)` = 288 triggers per day. A consumer Google Apps Script
  account has 90 min/day of total trigger runtime. This allows less than
  ~18.75 seconds **average** per run if no other triggers exist. Check the
  effective account quota and real latency before cutover.
- If the Worker is slow or Apps Script quota is too low, keep public GitHub
  Actions (standard GitHub-hosted runner, cost USD 0) instead of forcing
  migration. Scheduled execution times may jitter.

## Safe deployment and cutover (requires authorized Apps Script owner)

1. Back up the Apps Script `@56` deployment and current trigger inventory.
   Confirm latest Google Sheets payment statuses (seven approved when P0
   originally closed) and all currently held experiences.
2. Tests: `node --test tests/wedding_appsscript_timer.test.mjs` and the
   existing P0 safety suite. No real payment/order/reservation creation.
3. Merge the timer PR after review. Use the already-authenticated `clasp`
   project to push `WeddingReconciliationTimer.gs` to **this project's HEAD**.
   Never create a fresh script ID or modify the deployed web app URL.
4. Call `weddingReconciliationStatus()` first (safe, no network): trigger
   count should be zero, and no existing wedding timer should be present from
   another operator. Check all owners' triggers via the Apps Script project UI.
5. Call `installWeddingReconciliationTrigger()` exactly once as the owner.
   It is idempotent **for that owner** and will not remove unrelated triggers.
   A trigger runs the project HEAD; `@56` webapp deployment is untouched.
6. Observe at least **three actual time-driven executions** (not manual
   invocations) in Apps Script executions and property
   `WEDDING_RECONCILE_LAST_OK_AT`. Each must return HTTP 200 and `ok:true`.
   Compare Worker logs, sheet states and public catalog. Verify no erroneous
   release of pending/approved gifts. Record latency and ensure daily budget.
7. Only after confirmed timer execution, remove the `schedule:` stanza
   from `.github/workflows/p0-production-reconcile.yml` on the wedding
   repo default branch; retain `workflow_dispatch` as emergency manual
   fallback. Verify GitHub scheduled runs cease.
8. Audit daily for 48 hours: timer heartbeat at approximately five-minute
   cadence, no quota failures, Worker responses and payment integrity.

## Failure and rollback

- If the timer fails, **do not immediately disable GitHub Actions**.
- If GitHub was already disabled and the new timer fails, restore the
  GitHub `schedule` on the default branch before removing the timer.
- Rollback trigger only: `removeWeddingReconciliationTrigger()`, executed
  by the same installing owner; does not touch unrelated triggers.
- Rollback code: revert this PR and re-push prior Apps Script HEAD if needed.
  Existing published `@56` and MP payment data remain unchanged.
- Never expose `BACKEND_SHARED_SECRET` in PR, logs, chat or client JS.

## Verification status

- Source and mock tests: PR only. GitHub branch changes do not automatically
  install Apps Script triggers.
- Live timer: **NOT INSTALLED OR VERIFIED BY THIS PR**.
- Github Actions remains active until independent verification.
