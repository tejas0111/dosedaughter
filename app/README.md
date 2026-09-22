# DoseDaughter — caregiver chatbot that never re-asks a dose

Express chatbot + Telegram bot with long-term memory on Walrus Memory (`@mysten-incubation/memwal`).
Remembers meds, allergies, routines across sessions; compiles doctor-visit summaries from recall only.

## 2-min quickstart (local, no keys)

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"  # engines: node>=20
node --version   # expect v22.x
npm install
cp .env.example .env   # defaults already work for local demo
npm test               # offline self-test, no network
npm run dev            # server on :3001
```

Try it (readers use their own curl; Python fallback below):

```bash
curl -X POST localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo-mom","message":"I take Metformin 500mg at 8pm after food"}'
curl 'localhost:3001/api/summary?user=demo-mom'
curl 'localhost:3001/memory?user=demo-mom'
```

Python (no curl binary needed):

```python
import json, urllib.request
base = "http://localhost:3001"
def post(path, obj):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req))
print(post("/api/chat", {"userId": "demo-mom", "message": "I take Metformin 500mg at 8pm after food"}))
print(urllib.request.urlopen(base + "/api/summary?user=demo-mom").read().decode()[:500])
```

## Endpoints

| Method | Path | Params / body | Returns |
|---|---|---|---|
| `GET` | `/` | — | Chat landing HTML + links to `/memory`, `/demo` |
| `POST` | `/api/chat` | JSON `{userId, message}` | `{reply, recalled[], savedBlob, mode, disclaimer}` — recalls top-5, calls LLM, auto-saves only if `shouldRemember()` |
| `GET` | `/api/summary` | `?user=<id>` (default `demo-mom`) | `{user, mode, medications[], allergies[], routine[], familyAndCare[], blobCount, disclaimer}` from recall only |
| `GET` | `/memory` | `?user=<id>` | Human-readable HTML memory page with blob badges |
| `GET` | `/demo` | `?persona=day1\|day7` | LIVE before/after: real recall on empty `demo-day1` vs taught `demo-day7` namespaces |
| `GET` | `/healthz` | — | `{ok, mode, time}` for uptime checks and deploy verification |

```bash
curl -X POST localhost:3001/api/chat -H 'Content-Type: application/json' \
  -d '{"userId":"demo-mom","message":"What meds does mom take?"}'
curl 'localhost:3001/api/summary?user=demo-mom'
curl 'localhost:3001/demo?persona=day7'
```

```python
print(post("/api/chat", {"userId": "demo-mom", "message": "What meds does mom take?"}))
```

## Scripts

| Script | Command | Notes |
|---|---|---|
| `npm test` | `node src/selftest.js` | 37 offline checks (namespace/truncate/prompt/write-gate/conflict/fuzz/bulk), no network |
| `npm run dev` / `npm start` | `node src/server.js` | Web widget on `$PORT` (default 3001) |
| `npm run demo:seed` | `node src/seed-demo.js` | 3-fact local quickstart for `demo-day7` (no keys); full 12-fact seed = `seed:10` (mainnet) |
| `npm run seed` / `npm run seed:10` | `node src/seed10.js [userId]` | Writes 12 facts, needs mainnet keys; appends to `evidence/blob-ledger.md` |
| `npm run verify:memwal` | `node src/verify.js [userId]` | Health + write/recall probe, needs mainnet keys |

## File map

- `src/server.js` — Express app: 6 routes, recall → coded allergy guard → LLM → gated auto-save flow (exports `app`; listens only when run directly).
- `src/page.js` — Server-rendered pages (chat widget, `/memory` receipts, `/demo` before/after) — no build step, all dynamic text escaped.
- `src/memory.js` — MemWal wrapper: namespaces, `shouldRemember` write gate, `findConflict` allergy guard, 500-byte cap, `MAX_DISTANCE=0.7` recall filter, system prompt.
- `src/localClient.js` — File-backed stand-in (same interface, `.local-memory.json`, `local-*` ids) for keyless demo.
- `src/telegram.js` — Polling Telegram bot (`/start /memory /summary /reset`), per-chat `user-tg-<chatId>` namespace.
- `src/seed10.js` — Seeds 12 caregiver facts for one user (mainnet only).
- `src/verify.js` — Mainnet health + write/recall probe.
- `src/selftest.js` — 37 offline tests (namespace/truncate/prompt/write-gate/conflict/fuzz/bulk regressions).
- `api/index.js` + `vercel.json` + `DEPLOY.md` — Vercel deploy wiring (serverless entry, rewrites, 5-min guide; prod MUST be mainnet — serverless disk is ephemeral).

## Local vs Mainnet — honesty box

| | Local (default) | Mainnet (`MEMWAL_MODE=mainnet`) |
|---|---|---|
| Backend | `localClient.js` → `.local-memory.json` | Real Walrus Memory via hosted relayer |
| Blob ids | `local-*` — **NEVER Mainnet, never share as blobs** | Real Walrus blob ids, viewable on `walruscan.com/mainnet` |
| Keys | None needed | Requires owner `MEMWAL_ACCOUNT_ID` + `MEMWAL_PRIVATE_KEY` — **never run without owner keys** |
| `/memory` banner | `LOCAL DEMO` | Mainnet storage notice |

## Telegram setup

```bash
# 1. Chat @BotFather on Telegram → /newbot → copy token
# 2. From app/: npm i node-telegram-bot-api
# 3. Add TELEGRAM_BOT_TOKEN=<token> to .env (keep MEMWAL_MODE=local unless owner keys present)
npm i node-telegram-bot-api
node src/telegram.js
# Talk to your bot: /start → send 3 facts → /memory → /summary → /reset
```

Per-chat namespace is `user-tg-<chatId>`; `/reset` clears local rows only (mainnet blobs persist till epoch expiry).

## Troubleshooting

- **Node version:** needs `node>=20` — `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`, then `node --version`.
- **401 / staging-vs-mainnet:** relayer defaults to `https://relayer.memory.walrus.xyz`; a 401 usually means staging keys against the mainnet relayer (or vice versa) — match `MEMWAL_SERVER_URL` to where the account was created, or run local (`MEMWAL_MODE` unset).
- **Index lag:** `rememberAndWait` waits for the job, but recall index can lag seconds — `verify.js` warns `retry in 10s if 0`; re-GET `/memory` after a pause.
- **Distance filter:** recall keeps only `distance < 0.7` (`MAX_DISTANCE` in `memory.js`); empty `recalled: []` means "no topical hit", not a bug — the bot then asks for the 3 onboarding facts.
- **Telegram won't start:** `Missing dependency: node-telegram-bot-api` → run `npm i node-telegram-bot-api` from `app/`; `Missing TELEGRAM_BOT_TOKEN` → add it to `.env`.
- **LLM echo:** without `OPENROUTER_API_KEY` replies are `[no LLM key] …` echoes with memory-char counts — memory flow still works. Default model `google/gemini-2.5-flash` via `LLM_MODEL`.

> Medical disclaimer: DoseDaughter reminds and flags only — never adjusts dosage. Always confirm with your doctor.
