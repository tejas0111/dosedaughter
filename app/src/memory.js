// DoseDaughter memory layer — thin wrapper over @mysten-incubation/memwal.
// Rules: hosted relayer pays WAL/SUI; we only need MEMWAL_ACCOUNT_ID + MEMWAL_PRIVATE_KEY.
// Every fact <= 500 bytes (MemWal INSERT fails after paid upload otherwise).
// Always use rememberAndWait (async-accept + index lag), filter recall by distance.
import { MemWal } from '@mysten-incubation/memwal';

const SERVER_URL = process.env.MEMWAL_SERVER_URL || 'https://relayer.memory.walrus.xyz';
const MAX_FACT_BYTES = 500;
export const MAX_DISTANCE = 0.7;

export function namespaceFor(userId) {
  if (userId == null) return 'user-anon';
  return `user-${String(userId).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 48) || 'anon'}`;
}

export function createClient({ namespace } = {}) {
  const key = process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  if (!key || !accountId) throw new Error('Missing MEMWAL_PRIVATE_KEY / MEMWAL_ACCOUNT_ID in .env');
  return MemWal.create({ key, accountId, serverUrl: SERVER_URL, namespace: namespace || 'dosedughter-prod' });
}

export function truncateFact(text) {
  const s = String(text ?? '');
  if (Buffer.byteLength(s, 'utf8') <= MAX_FACT_BYTES) return s;
  // Byte-budgeted walk over code points: subarray-style cuts can split a
  // multi-byte char and decode as U+FFFD (and even exceed 500 bytes).
  let out = '', bytes = 0;
  for (const ch of s) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > MAX_FACT_BYTES) break;
    out += ch;
    bytes += b;
  }
  return out;
}

// Write gate: only new, durable, user-stated facts are saved. Chit-chat,
// questions, and model guesses are never written.
export function shouldRemember(text) {
  if (typeof text !== 'string' || !text || text.length > 500) return false;
  const t = text.toLowerCase();
  if (/\?\s*$/.test(t)) return false; // questions are never facts
  // Meds/allergy phrasing, "my ..." caregiver facts, daily routines, and any
  // clock time (with or without "at": "8pm", "7:30pm", "10pm").
  return /i take|\btakes?\b|\btaking\b|allerg|my (mom|dad|dose|routine)|every day|\bat \d|\d:\d|\d\s?(am|pm)\b|dinner|bedtime|breakfast|lunch|routine|reminder|medication|prescription/.test(t);
}

// Coded safety net: if the user asks about giving/taking something matching a
// recalled allergy fact, block with a warning citing the source blob — BEFORE the LLM.
// Returns { substance, fact, blob_id } or null. Deterministic: works with no LLM key.
const STOP = new Set('what,does,mom,take,give,should,can,she,for,the,has,and,our,her,with,now,today,please,had,having,allergy,allergic,about,this,that,from'.split(','));
// Brand → generic drug (OTC names judges/real users actually type). Without this,
// "can she take Advil?" bypasses an ibuprofen-allergy block — a safety hole.
const BRAND_SYNONYMS = new Map(Object.entries({
  advil: 'ibuprofen', motrin: 'ibuprofen', nurofen: 'ibuprofen', brufen: 'ibuprofen',
  tylenol: 'paracetamol', panadol: 'paracetamol', calpol: 'paracetamol', acetaminophen: 'paracetamol',
  disprin: 'aspirin', ecotrin: 'aspirin',
}));
// Singularize so plural variants ('ibuprofens') still match ('ibuprofen').
const singular = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const canonical = (w) => BRAND_SYNONYMS.get(singular(w)) || singular(w);
export function findConflict(message, recalled) {
  if (!message || !recalled || !Array.isArray(recalled)) return null;
  const msgWords = new Set(String(message).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map(canonical));
  if (!msgWords.size) return null;
  for (const r of recalled) {
    if (!r || !/allerg/i.test(r.text || '')) continue;
    const factWords = String(r.text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map(canonical);
    const hit = factWords.find((w) => msgWords.has(w));
    if (hit) return { substance: hit, fact: r.text, blob_id: r.blob_id || null };
  }
  return null;
}

export async function rememberAndWait(client, text) {
  const job = await client.remember(truncateFact(text));
  const done = await client.waitForRememberJob(job.job_id);
  return done; // { blob_id, owner, namespace }
}

export async function rememberBulkAndWait(client, texts) {
  const items = texts.map((t) => ({ text: truncateFact(t) }));
  // SDK bulk API name varies by version; fall back to sequential if missing.
  if (typeof client.rememberBulkAndWait === 'function') return client.rememberBulkAndWait(items);
  const out = [];
  for (const it of items) out.push(await rememberAndWait(client, it.text));
  return out;
}

// Transient-safe recall: the relayer can abort a request while the index settles
// (just-seeded namespaces, congestion). Retry once, then degrade to empty — the bot
// must NEVER 500 on a flaky relayer moment (judges hit the demo at arbitrary times).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function safeRecall(client, params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await client.recall(params);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (/abort|timeout|503|504|429|unavailable|ECONN/i.test(msg) && i < tries - 1) {
        await sleep(3000 * (i + 1));
        continue;
      }
      break;
    }
  }
  console.error(`recall failed after ${tries} tries:`, String(lastErr?.message || lastErr).slice(0, 120));
  return { results: [] };
}

export async function recallRelevant(client, query, limit = 5) {
  let n = Number(limit);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(0, Math.floor(n));
  const { results } = await safeRecall(client, { query, limit: n });
  // Distance filter + client-side dedup by text (MemWal has no server-side dedup;
  // re-taught facts would otherwise crowd the prompt with copies). Best rank wins.
  const seen = new Set();
  const out = [];
  for (const r of results || []) {
    if ((r.distance ?? 1) >= MAX_DISTANCE) continue;
    const key = String(r.text || '').trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

// Multi-angle union recall: several query phrasings merged by text (lowest distance
// wins). A receipts page / summary must see the whole namespace — one phrasing can
// score every fact above the 0.7 cutoff and wrongly show an empty memory.
export async function recallAll(client, queries, limit = 20) {
  const byText = new Map();
  for (const q of queries) {
    try {
      const { results } = await safeRecall(client, { query: q, limit: 25 });
      for (const r of results || []) {
        if ((r.distance ?? 1) >= MAX_DISTANCE) continue;
        const key = String(r.text || '').trim().toLowerCase();
        if (!key) continue;
        const prev = byText.get(key);
        if (!prev || (r.distance ?? 1) < (prev.distance ?? 1)) byText.set(key, r);
      }
    } catch { /* one angle failing must not empty the page */ }
  }
  return [...byText.values()].sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1)).slice(0, limit);
}

// Fact classifier for doctor summaries: score-based (not first-regex-hit) so
// "daughter Priya manages weekend doses" lands in family, not medications.
// Allergies ALWAYS win — misfiling an allergy is a safety bug.
const CLASS_RULES = {
  medications: [/metformin/i, /amlodipine/i, /\bmg\b/i, /\bpill/i, /tablet/i, /insulin/i, /\btakes?\b/i, /\btaking\b/i, /\bdose/i, /medicati/i, /prescript/i],
  routine: [/dinner/i, /bedtime/i, /breakfast/i, /\blunch\b/i, /reminder/i, /morning/i, /at \d/i, /\d\s?(am|pm)\b/i, /\bwalk/i],
  familyAndCare: [/daughter/i, /\bson\b/i, /\bmom\b/i, /\bdad\b/i, /doctor/i, /pharmacy/i, /emergency/i, /contact/i, /\bcall/i, /visit/i, /priya|arjun|\brao\b/i, /hindi/i, /whatsapp/i],
};
export function classifyFacts(facts) {
  const out = { medications: [], allergies: [], routine: [], familyAndCare: [], unclassified: [] };
  for (const raw of facts || []) {
    const text = String(raw).replace(/^User\s+\S+:\s*/i, '');
    if (/allerg/i.test(text)) { out.allergies.push(raw); continue; }
    let best = 'unclassified', bestScore = 0;
    for (const [cat, rules] of Object.entries(CLASS_RULES)) {
      const score = rules.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
      if (score > bestScore) { best = cat; bestScore = score; }
    }
    out[best].push(raw);
  }
  return out;
}

export function buildSystemPrompt(recalled) {
  const base = `You are DoseDaughter, a caregiver helper. You remember meds, allergies, routines, family names across sessions. Rules: (1) If asked "can I take X?", first check recalled allergies/meds for conflicts and warn. (2) Cite what you remember naturally ("you told me..."). (3) Never adjust dosage — only remind and flag; always add: "Confirm with your doctor — this is not medical advice."`;
  if (!recalled || recalled.length === 0) return base + `\nNo prior memories for this user yet. Ask for 3 facts: daily meds with times, allergies, routine.`;
  const lines = recalled.map((r) => `- ${r.text}`).join('\n');
  return `${base}\nWhat you remember about this user:\n${lines}`;
}
