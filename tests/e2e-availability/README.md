# E2E: availability UNKNOWN state (hotfix PR #35)

Local Playwright (system Chrome, `playwright-core`), API mocked/intercepted, **no GitHub Actions, no production writes**.
Every request other than GET `/api/catalog` (+ mocked `order-status`) is aborted and counted as `forbidden`.

    npm i playwright-core
    node run.mjs <dir-with-index.html> new      # 42 scenarios x (desktop, Pixel 7), label MUST be "new" for the hotfix assertions
    node run.mjs <dir-with-old-index.html> base # baseline: expected to FAIL (shows the bug)
    node equiv.mjs <old-dir> <new-dir>          # final-state DOM equivalence (28 snapshots)
    node real.mjs <dir> real-new [https://regalos.hgstack.com]   # read-only against the real API / public URL

Oracle (`ORACLE` in lib.mjs): MutationObserver + rAF + 5 ms interval from first paint; any price (`ARS n`, `≈ USD`, `≈ R$`) or
buy button for a gift not in the set of ids the mocked API confirmed `Disponible` is a violation.
