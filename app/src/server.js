// DoseDaughter web widget — Express chatbot endpoint.
// GET / → chat UI. GET /memory?user=ID → public memory-visible page.
// GET /demo?persona=day1|day7 → before/after harness (empty vs seeded namespace).
// POST /api/chat { userId, message } → recall → LLM → auto-remember facts.
// GET /api/summary?user=ID → doctor-visit summary compiled from recall only.
// Memory backend: MEMWAL_MODE=mainnet (real Walrus Memory, needs keys) or local (default,
// file-backed stand-in with identical interface for offline development and demos).
import 'dotenv/config';
import express from 'express';
import { createClient, namespaceFor, recallRelevant, recallAll, buildSystemPrompt, rememberAndWait, shouldRemember, findConflict, classifyFacts } from './memory.js';
import { createLocalClient } from './localClient.js';
import { chatPage, memoryPage, demoPage } from './page.js';

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
    res.send(memoryPage({
      user: userId,
      mode,
      rows: recalled.map((r) => ({ text: r.text, blob_id: r.blob_id })),
      agentShort: String(process.env.MEMWAL_ACCOUNT_ID || '').slice(0, 10),
    }));
  } catch (e) { res.status(500).send(`<pre>${String(e.message || e)}</pre>`); }
});

app.get('/', (req, res) => {
  res.send(chatPage({ mode: MODE, model: process.env.LLM_MODEL || 'google/gemini-2.5-flash' }));
});

app.get('/demo', async (req, res) => {
  // LIVE before/after: same question, real recall against two namespaces.
  // demo-day1 is never seeded (empty); demo-day7 fills via POST /api/chat teaches.
  try {
    const q = 'What meds does mom take?';
    const d1 = clientFor('demo-day1');
    const d7 = clientFor('demo-day7');
    const r1 = await recallRelevant(d1.client, q, 5);
    let r7 = await recallRelevant(d7.client, q, 5);
    // AFTER side: use demo-day7 when populated (local clone-and-run via demo:seed);
    // on a fresh mainnet deploy fall back to the seeded demo-mom namespace so the
    // before/after always shows real memories. The page labels whichever is used.
    let afterNs = 'user-demo-day7';
    if (r7.length === 0) {
      const dm = clientFor('demo-mom');
      const rdm = await recallRelevant(dm.client, q, 5);
      if (rdm.length > 0) { r7 = rdm; afterNs = 'user-demo-mom'; }
    }
    res.send(demoPage({
      q,
      mode: d7.mode,
      before: r1.map((m) => ({ text: m.text, blob_id: m.blob_id })),
      after: r7.map((m) => ({ text: m.text, blob_id: m.blob_id })),
      afterNs,
      day7Empty: r7.length === 0,
    }));
  } catch (e) { res.status(500).send(`<pre>${String(e.message || e)}</pre>`); }
});

const port = process.env.PORT || 3001;
app.get('/healthz', (req, res) => res.json({ ok: true, mode: MODE, time: new Date().toISOString() }));
if (process.env.VERCEL !== '1' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => console.log(`DoseDaughter on :${port}`));
}
export default app;
