# Firebase Hosting site `marianayhernan` — short links only

Deploy unit for `https://marianayhernan.web.app` (RSVP short link + WhatsApp launcher).
It is **separate from the gifts site** (GitHub Pages `regalos.hgstack.com`, served from `main`).
It does not contain and must never contain catalog, checkout, Mercado Pago, Google Sheets or Apps Script code.

Do **not** deploy the repo-root `firebase.json` (`target: wedding`, `public: "."`): it would publish the whole
gifts repo to `marianayhernan.web.app` and drop the `/rsvp/:token` redirect.

| Route | Behaviour |
|---|---|
| `/rsvp/:token` | 302 → Apps Script RSVP `exec?t=:token` |
| `/whatsapp?phone=…&token=mh27-…` | rewrite → `whatsapp.html` (builds the message, opens `whatsapp://send`, visible buttons for app / `api.whatsapp.com`) |
| `/` | 302 → `https://regalos.hgstack.com` |

Tests (no network): `node --test firebase-shortlinks/tests/whatsapp_launcher.test.mjs`
Browser E2E (local emulator only, WhatsApp requests stubbed): see header of `tests/whatsapp_e2e.playwright.mjs`.

## Deploy (manual, not run by CI) — from this branch, only this site
```
firebase deploy --only hosting:marianayhernan --config firebase-shortlinks/firebase.json --project hg-market-system
```
## Rollback (previous live version before this change)
```
firebase hosting:clone hg-market-system:marianayhernan@727091df78d6be33 hg-market-system:marianayhernan:live
```
(`727091df78d6be33` = release 1794832022106000, 2026-11-16 12:27 UTC; 4 files: init.js, init.json, index.html, whatsapp.html.)

## Android validation (PENDING_HUMAN)
Encoded URLs prove bytes, not rendering. On a real Android phone with WhatsApp installed, open
`https://marianayhernan.web.app/whatsapp?phone=<tu número>&token=mh27-test` (use your OWN number, do not press Send), then check the compose box:
1. 💛 appears after "Oi!" and after "RSVP"; ✈️ after "Nossa viagem" (not ◆/? boxes, not a text-style ✈).
2. Blank lines between paragraphs and each link on its own line.
3. Gifts link is `https://regalos.hgstack.com`; RSVP link `https://marianayhernan.web.app/rsvp/mh27-test`.
4. Test both: Chrome (auto-open + "Abrir WhatsApp" button) and from inside WhatsApp's in-app browser; and "Abrir via web".
