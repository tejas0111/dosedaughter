// Seed 10+ blobs on Walrus Mainnet for one user → satisfies "≥10 blobs" fast.
// Usage: node src/seed10.js [userId]
// Sequential rememberAndWait with pacing (relayer cap: 30 pts/min; remember=5 pts
// each) + retry-with-backoff on transient 5xx + idempotency keys so re-runs do
// NOT duplicate blobs. Appends every blob_id to ../../evidence/blob-ledger.md.
import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient, namespaceFor, truncateFact } from './memory.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userId = process.argv[2] || 'demo-mom';
const facts = [
  `User ${userId}: takes Metformin 500mg at 8pm after food`,
  `User ${userId}: takes Amlodipine 5mg at 8am with water`,
  `User ${userId}: allergic to ibuprofen — causes rash (told Apr 2)`,
  `User ${userId}: routine — dinner at 7:30pm, bedtime 10pm`,
  `User ${userId}: daughter Priya manages weekend doses`,
  `User ${userId}: skipped Metformin last Tue when fasting — remind gently`,
  `User ${userId}: doctor Dr. Rao, next visit first week of month, bring sugar log`,
  `User ${userId}: prefers Hindi + short replies, morning reminder at 7:45am`,
  `User ${userId}: blood sugar fasting target 90-110, log nightly`,
  `User ${userId}: emergency contact son Arjun, call if dose missed twice`,
  `User ${userId}: pharmacy Sharma Medical, refills on 25th`,
  `User ${userId}: dislikes phone calls — WhatsApp text only`,
];

const client = createClient({ namespace: namespaceFor(userId) });
await client.health?.().catch(() => {});
console.log(`Seeding ${facts.length} facts → namespace ${namespaceFor(userId)} (sequential, paced, idempotent, resumable) ...`);

// RESUME: preload existing texts so re-runs skip already-stored facts (avoids dupes).
const existing = new Map(); // text → blob_id
for (const q of ['takes allergic routine doctor', 'Metformin Amlodipine ibuprofen rash dinner', 'Priya Arjun Sharma WhatsApp blood sugar emergency', 'Hindi reminder fasting refills pharmacy walks bedtime']) {
  try {
    const { results } = await client.recall({ query: q, limit: 25 });
    for (const r of results || []) existing.set(String(r.text || '').trim(), r.blob_id);
  } catch { /* probe failure is non-fatal */ }
}
console.log(`Namespace already has ${existing.size} recallable facts — skipping those.`);

const idem = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);

const results = [];
let wrote = 0;
for (let i = 0; i < facts.length; i++) {
  const text = truncateFact(facts[i]);
  if (existing.has(text.trim())) {
    results.push({ blob_id: existing.get(text.trim()), status: 'skipped-existing', text });
    console.log(`  ${i + 1}/12 → already stored (${String(existing.get(text.trim())).slice(0, 14)}…) — skip`);
    continue;
  }
  let done = null;
  const wedgedJobs = new Set();
  for (let attempt = 1; attempt <= 6 && !done; attempt++) {
    try {
      // A 504 job that wedges once keeps resolving to the same stuck job while the
      // idempotency key is reused — drop the key as soon as we've seen the job wedged.
      const idemKey = wedgedJobs.size > 0 ? undefined : idem(text);
      done = await client.rememberAndWait(text, undefined, { idempotencyKey: idemKey, timeoutMs: 120000, pollIntervalMs: 5000 });
    } catch (e) {
      if (e?.status === 504 && e?.jobId) wedgedJobs.add(e.jobId);
      const msg = String(e?.message || e);
      const retryAfter = Number(e?.retryAfterSeconds) || 0;
      // 504 job-timeout: job was ACCEPTED (may still finish); same idempotency key on retry is safe.
      const transient = [503, 429, 500, 504].includes(e?.status) || /unavailable|rate|retry|timed out|timeout|encrypt|upload/i.test(msg);
      if (!transient || attempt >= 6) throw e;
      const waitS = Math.max(retryAfter, 20 * attempt);
      console.log(`  fact ${i + 1} attempt ${attempt} transient (${e?.status || ''} ${msg.slice(0, 60)}) — retry in ${waitS}s`);
      await sleep(waitS * 1000);
    }
  }
  results.push({ blob_id: done?.blob_id || '', status: done ? 'done' : 'failed', text });
  if (done) wrote++;
  console.log(`  ${i + 1}/12 → ${String(done?.blob_id || 'FAILED').slice(0, 20)}${done ? '' : ' FAILED'}`);
  if (i < facts.length - 1) await sleep(10500); // stay under 30 pts/min
}

const blobIds = results.map((r) => r.blob_id).filter(Boolean);
console.log(`Namespace total: ${blobIds.length}/${facts.length} target blobs (wrote ${wrote} this run, ${results.length - wrote} pre-existing).`);

const probe = await client.recall({ query: 'medications allergies routine family', limit: 20 }).catch(() => ({ results: [] }));
console.log(`Recall probe: ${(probe.results || []).length} relevant memories.`);

const ledger = `../../evidence/blob-ledger.md`;
const lines = [
  `\n## ${new Date().toISOString()} — seed ${userId} (sequential idempotent seeder)`,
  `namespace: ${namespaceFor(userId)}`,
  `agent (MEMWAL_ACCOUNT_ID): ${process.env.MEMWAL_ACCOUNT_ID || '(unset)'}`,
  `blobs: ${blobIds.length}/${facts.length}`,
  ...blobIds.map((b) => `- https://walruscan.com/mainnet/blob/${b}`),
  `recall probe: ${(probe.results || []).length}/20`,
  '',
];
fs.appendFileSync(new URL(ledger, import.meta.url), lines.join('\n'));
fs.writeFileSync(new URL('./seed-log.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), userId, namespace: namespaceFor(userId), results, probeCount: (probe.results || []).length }, null, 2));
console.log(`Appended to evidence/blob-ledger.md + src/seed-log.json`);
if (blobIds.length < facts.length) { console.log('WARNING: some writes failed — inspect seed-log.json'); process.exit(2); }
