// DoseDaughter web widget — Express chatbot endpoint.
// GET / → chat UI. GET /memory?user=ID → public memory-visible page.
// GET /demo?persona=day1|day7 → before/after harness (empty vs seeded namespace).
// POST /api/chat { userId, message } → recall → LLM → auto-remember facts.
// GET /api/summary?user=ID → doctor-visit summary compiled from recall only.
// Memory backend: MEMWAL_MODE=mainnet (real Walrus Memory, needs keys) or local (default,
// file-backed stand-in with identical interface for tonight's end-to-end demo — NEVER mainnet).
import 'dotenv/config';
import express from 'express';
import { createClient, namespaceFor, recallRelevant, recallAll, buildSystemPrompt, rememberAndWait, shouldRemember, findConflict, classifyFacts } from './memory.js';
import { createLocalClient } from './localClient.js';

const MODE = process.env.MEMWAL_MODE === 'mainnet' ? 'mainnet' : 'local';
function clientFor(userId) {
  const ns = namespaceFor(userId);
  if (MODE === 'mainnet') return { client: createClient({ namespace: ns }), mode: 'mainnet' };
  return { client: createLocalClient({ namespace: ns }), mode: 'local' };
}

const app = express();
app.use(express.json());

async function callLLM(system, userMessage) {
  // OpenRouter (Gemini Flash default — Beyond Big Two eligible). Falls back to echo if no key.
  // Resilience: explicit max_tokens (default 65k exceeds free-tier credit), then free-model
  // fallback chain on 402/429 so the demo NEVER dies mid-judge-test. Errors stay graceful.
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.LLM_MODEL || 'google/gemini-2.5-flash';
  if (!apiKey) return `[no LLM key] system would inject ${system.length} chars of memory. You said: ${userMessage}`;
  const models = [model, 'inclusionai/ling-3.0-flash-vl:free', 'liquid/lfm-2.5-2.6b:free'].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr = '';
  for (const m of models) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: m,
          max_tokens: 400,
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }],
        }),
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) return content;
      lastErr = data?.error?.message || JSON.stringify(data).slice(0, 200);
      console.error(`LLM ${m} failed: ${lastErr.slice(0, 120)}`);
    } catch (e) { lastErr = String(e.message || e); }
  }
  return `[LLM unavailable — memory still works] recalled ${system.length} chars of context. You said: ${userMessage}`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { userId = 'anon', message = '' } = req.body;
    const { client, mode } = clientFor(userId);
    const recalled = await recallRelevant(client, message, 5);
    // Coded safety net FIRST: allergy conflict blocks before any LLM output.
    const conflict = findConflict(message, recalled);
    let reply;
    if (conflict) {
      reply = `STOP — do not give ${conflict.substance}. Recalled allergy: "${conflict.fact}"${conflict.blob_id ? ` (blob ${conflict.blob_id})` : ''}. Confirm with your doctor — this is not medical advice.`;
    } else {
      const system = buildSystemPrompt(recalled);
      reply = await callLLM(system, message);
    }
    // Auto-save AFTER generation only: shouldRemember gates writes (never chit-chat).
    let saved = null;
    if (shouldRemember(message)) {
      try { saved = await rememberAndWait(client, `User ${userId}: ${message}`); } catch { /* queue later */ }
    }
    res.json({ reply, recalled: recalled.map((r) => r.text), savedBlob: saved?.blob_id || null, mode, disclaimer: 'Confirm with your doctor — this is not medical advice.' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/summary', async (req, res) => {
  // Doctor-visit summary compiled from recall ONLY — no chat history, no model memory.
  try {
    const userId = req.query.user || 'demo-mom';
    const { client, mode } = clientFor(userId);
    const recalled = await recallAll(client, [
      'medications allergies routine family',
      'Metformin Amlodipine insulin dose',
      'allergic rash ibuprofen',
      'dinner bedtime morning reminder',
      'daughter son doctor pharmacy emergency',
      'blood sugar log target',
      'Hindi WhatsApp refills',
    ], 25);
    const facts = recalled.map((r) => r.text);
    const summary = {
      user: userId,
      mode,
      generatedAt: new Date().toISOString(),
      ...classifyFacts(facts),
      blobCount: facts.length,
      disclaimer: 'Confirm with your doctor — this is not medical advice.',
    };
    res.json(summary);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/memory', async (req, res) => {
  try {
    const userId = req.query.user || 'demo-mom';
    const { client, mode } = clientFor(userId);
    const recalled = await recallAll(client, [
      'medications allergies routine family',
      'takes dose mg pill',
      'allergic rash',
      'dinner bedtime routine',
      'daughter doctor pharmacy emergency contact',
    ], 25);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isLocal = (id) => String(id || '').startsWith('local-');
    const rows = recalled.map((r) => {
      const badge = r.blob_id
        ? (isLocal(r.blob_id) || mode === 'local'
            ? `<code>LOCAL DEMO ${esc(r.blob_id)}</code>`
            : `<a href="https://walruscan.com/mainnet/blob/${esc(r.blob_id)}">${esc(String(r.blob_id).slice(0, 12))}…</a>`)
        : '';
      return `<li>${esc(r.text)} ${badge}</li>`;
    }).join('');
    const banner = mode === 'local'
      ? `<p>LOCAL DEMO — file-backed stand-in memory, not Walrus Mainnet. Real Mainnet path (Walrus Memory) runs when MEMWAL_MODE=mainnet with keys.</p>`
      : `<p>All memory stored on Walrus Mainnet via Walrus Memory — every fact links to its blob on walruscan. Agent: ${esc(String(process.env.MEMWAL_ACCOUNT_ID || '').slice(0, 10))}…</p>`;
    res.send(`<h1>DoseDaughter remembers — ${esc(userId)}</h1>${banner}<ul>${rows || '<li>Nothing yet — say hi in chat.</li>'}</ul><p>Confirm with your doctor — this is not medical advice.</p>`);
  } catch (e) { res.status(500).send(`<pre>${String(e.message || e)}</pre>`); }
});

app.get('/', (req, res) => {
  res.send(`<h1>DoseDaughter</h1><p>A caregiver chatbot that never re-asks a dose. Memory: ${MODE}${MODE === 'mainnet' ? ' (Walrus Memory on Mainnet)' : ' (offline demo stand-in — Mainnet after seeding, see evidence/blob-ledger.md)'} · LLM ${process.env.LLM_MODEL || 'google/gemini-2.5-flash'}.</p>
  <form method=GET action=/memory><input name=user placeholder="user id (e.g. demo-mom)"/><button>See what it remembers</button></form>
  <p>POST /api/chat with {"userId","message"}. Demo: /demo?persona=day1 vs /demo?persona=day7</p>
  <p><small>Confirm with your doctor — this is not medical advice.</small></p>`);
});

app.get('/demo', async (req, res) => {
  // LIVE before/after: same question, real recall against two namespaces.
  // demo-day1 is never seeded (empty); demo-day7 fills via POST /api/chat teaches.
  try {
    const q = 'What meds does mom take?';
    const d1 = clientFor('demo-day1');
    const d7 = clientFor('demo-day7');
    const r1 = await recallRelevant(d1.client, q, 5);
    const r7 = await recallRelevant(d7.client, q, 5);
    const persona = req.query.persona === 'day7' ? 'day7' : 'day1';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (r, mode) => r.length ? r.map((m) => `<li>${esc(m.text)} <small>(${esc(mode)}:${esc(String(m.blob_id || '').slice(0, 12))})</small></li>`).join('') : '<li><i>no memories — generic answer, Day-1 amnesia</i></li>';
    const note7 = r7.length ? '' : '<p><i>day7 namespace empty — teach it via POST /api/chat {"userId":"demo-day7",...} then reload.</i></p>';
    const shown = persona === 'day7' ? r7 : r1;
    res.send(`<h1>Before/after — ${persona} (LIVE recall, mode ${esc(d7.mode)})</h1>
    <p><b>Q:</b> "${q}"</p>
    <p><b>BEFORE (demo-day1, ${r1.length} memories):</b></p><ul>${fmt(r1, d1.mode)}</ul>
    <p><b>AFTER (demo-day7, ${r7.length} memories):</b></p><ul>${fmt(r7, d7.mode)}</ul>${persona === 'day7' ? note7 : ''}
    <p>Live proof: POST /api/chat with userId=demo-day7, then reload /demo?persona=day7</p>`);
  } catch (e) { res.status(500).send(`<pre>${String(e.message || e)}</pre>`); }
});

const port = process.env.PORT || 3001;
app.get('/healthz', (req, res) => res.json({ ok: true, mode: MODE, time: new Date().toISOString() }));
if (process.env.VERCEL !== '1' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => console.log(`DoseDaughter on :${port}`));
}
export default app;
