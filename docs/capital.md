# Capital.com DEMO setup (REST polling)

Follow these steps to enable live price polling from the Capital.com DEMO API.

## 1) Create a DEMO API key
- Log into your Capital.com DEMO account.
- Go to **Settings → API Integrations**.
- Create a new API key. Copy the key when it’s shown — it is visible only once. If lost, generate a new key.
- Set a **custom password** for the API key (Capital calls this the “API password”).

## 2) Configure environment variables
Add these to `.env.local` (see `.env.example` for placeholders):
- `CAPITAL_API_BASE_URL=https://demo-api-capital.backend-capital.com`
- `CAPITAL_API_KEY=<full, unmasked key>`
- `CAPITAL_IDENTIFIER=<your login email>`
- `CAPITAL_PASSWORD=<your API key custom password>`
- `CAPITAL_EPIC_DEFAULT=OIL_CRUDE` (or another EPIC you want as default)

Restart the dev server after editing env vars.

## 3) Verify connectivity
With the dev server running, hit the diagnose endpoint:
```
curl -s http://localhost:3000/api/capital/diagnose
```
Expected:
- If the key is valid: `encryptionKeyCheck.ok: true` (status 200).
- If invalid: status 401 with `error.invalid.api.key` and hints indicating the key is rejected or looks too short.

## 4) Try the demo page
Visit `/capital-demo`. It shows setup status and, once valid, starts polling a live quote for the chosen EPIC using REST.

## Fixing error.invalid.api.key (checklist)
> Do **NOT** paste keys into chat/screenshots.
1) Enable 2FA if required for key generation.
2) Generate a **new** API key and copy it immediately at creation; the full key is only shown once.
3) Ensure the key is **Enabled/Play** in the UI.
4) Set the API key **custom password** and use that as `CAPITAL_PASSWORD`.
5) Update `.env.local` (no quotes, no spaces) and restart the dev server.
6) Run `npm run capital:check` and `curl -s http://localhost:3000/api/capital/diagnose`:
   - Success: at least one base reports `ok=true`.
   - Failure: both bases report 401 error.invalid.api.key → the key is masked/disabled/expired; repeat from step 2 with a brand-new key.

## Using Capital quotes in the app
- Prefix symbols with `CAP:` to use Capital as the provider.
- Example: `CAP:OIL_CRUDE`
- After changing `.env.local`, restart the dev server.

## Finding EPICs
- Use `/capital-demo` to search markets (new “Market search” panel) or call `GET /api/capital/markets?searchTerm=...`.
- Results include `epic`, `instrumentName`, `instrumentType`, `marketStatus`, bid/offer.
- Clicking a result in the demo sets the EPIC input for live quotes.

## Session test
- `GET /api/capital/session-test` validates identifier/password and key without returning CST/X-SECURITY-TOKEN.
- The `/capital-demo` page has a “Session test” button once the key is accepted.

**Security:** never paste API keys/passwords into chat or commit them. If a key is leaked, rotate it immediately in Capital.com. Put secrets ONLY in `.env.local` (never in `.env.example`). CLI scripts load `.env.local` automatically.

## Auth troubleshooting
1) If `capital:doctor` reports **API KEY REJECTED (invalid.api.key)**: regenerate a new key, copy it at creation (only shown once), ensure it is Enabled/Play, update `.env.local`, and restart dev server.
2) If API key is accepted but session fails: set an alternate API-key custom password in `CAPITAL_PASSWORD_ALT` and rerun `npm run capital:doctor`.

## Auth quick fix (doctor flow)
- Key rejected: regenerate/copy at creation, enable, update `.env.local`, restart, rerun doctor.
- Key accepted but session fails: use the API-key custom password; set `CAPITAL_PASSWORD_ALT` to try a second candidate and rerun doctor.

If `/session/encryptionKey` returns `error.invalid.api.key`, the API key itself is wrong/disabled/expired/masked — password is irrelevant until the key is accepted.
