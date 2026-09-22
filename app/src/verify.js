// Fast MemWal health + write/recall probe. Usage: node src/verify.js [userId]
import 'dotenv/config';
import { createClient, namespaceFor, rememberAndWait, recallRelevant } from './memory.js';
const userId = process.argv[2] || 'verify-probe';
const client = createClient({ namespace: namespaceFor(userId) });
try { await client.health?.(); console.log('health: OK'); } catch (e) { console.log('health: FAIL', String(e.message || e)); process.exit(1); }
const probeText = `Verify probe ${Date.now()}: user prefers short replies`;
const saved = await rememberAndWait(client, probeText);
console.log('remember: OK blob', saved?.blob_id || '(no blob id returned)');
const found = await recallRelevant(client, 'prefers short replies', 5);
console.log(`recall: ${found.length} relevant (expect >=1 after index settles; retry in 10s if 0)`);
