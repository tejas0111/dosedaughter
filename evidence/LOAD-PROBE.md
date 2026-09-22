# LOAD PROBE — LOCAL DEMO (not Walrus Mainnet)

Date (UTC): 2026-09-20T23:23:31Z
Mode: LOCAL DEMO only — `MEMWAL_MODE=local`, file-backed stand-in memory (`.local-memory.json`), no keys (`OPENROUTER_API_KEY` unset, no `MEMWAL_*` keys), Node v22.14.0, app server `src/server.js` on `PORT=3002` (to avoid clashes). No Mainnet, no real Walrus blobs — all blob IDs below are `local-*` LOCAL DEMO stand-ins.

Method:
1. Started server: `MEMWAL_MODE=local PORT=3002 node src/server.js` (from `app/`); verified `GET /healthz` → `{"ok":true,"mode":"local"}`.
2. Phase 1 — 50 sequential `POST /api/chat` (mixed teaches + questions, 5 userIds `load-u1..u5`, alternating teach/question), timed wall clock per request with Python `urllib` (`time.perf_counter`), counted non-200s.
3. Phase 2 — 10 rapid teaches to ONE user (`load-burst1`), then recall check via `POST /api/chat "What meds does mom take?"` + `GET /api/summary?user=load-burst1` + `GET /memory?user=load-burst1`; repeat 10-teach burst on `load-burst-p95` for burst p95. Checked dedup (duplicate teach → same `local-*` blob, unique count) and ordering (meds query ranks meds first).
4. Phase 3 — `GET /healthz`, `/api/summary?user=load-u1`, `/memory?user=load-u1`, `/demo`, `/demo?persona=day7` ×5 each, counted non-200s, timed avg/p95 (p95 = `ceil(0.95*n)`-th sorted sample; for n=5 p95 = max).
5. Killed server afterward; verified no `node src/server.js` remains.

Results (all LOCAL DEMO):

| probe | n | errors (non-200) | avg ms/req | p95 ms/req | notes |
|---|---|---|---|---|---|
| POST /api/chat ×50 sequential, 5 users mixed teach/question | 50 | 0 | 5.3 | 12.0 | wall 0.27s; min 2.3, max 32.8 |
| POST /api/chat burst 10 teaches, 1 user + recall check | 10 | 0 | 7.6 (recall user `load-burst1`); 6.0 (repeat `load-burst-p95`) | 13.1 (repeat run) | dedup + ordering sane (see below) |
| GET /healthz ×5 | 5 | 0 | 3.8 | 8.7 | all 200, `mode:local` |
| GET /api/summary?user=load-u1 ×5 | 5 | 0 | 3.3 | 4.2 | all 200 |
| GET /memory?user=load-u1 ×5 | 5 | 0 | 2.2 | 2.4 | all 200 |
| GET /demo ×5 | 5 | 0 | 4.1 | 4.9 | all 200 |
| GET /demo?persona=day7 ×5 | 5 | 0 | 4.1 | 4.7 | all 200 |

Burst recall detail (LOCAL DEMO): 10 teaches → 10 `savedBlob`s, duplicate `Mom takes metformin…` teach returned same blob `local-5a841d75f59e` twice; `/api/summary` `blobCount=9` for 10 writes (9 unique — dedup OK); meds question recalled 5/5 relevant (`amlodipine`, `metformin`, `paracetamol`, allergy, doctor/pharmacy), meds ranked first — ordering sane; `mode:local` everywhere.

Verdict: 50/50 ok, p95 12.0ms, no crash — burst 10/10 ok, GETs 25/25 ok, LOCAL DEMO only.
