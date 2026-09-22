// User memory registry (DoseDaughter).
// Persistent JSON store mapping wallet address → MemWal account + delegate key.
// SERVICE metadata only — never memory content. All actual memory is
// Seal-encrypted blobs on Walrus, owned by each user's own MemWalAccount.
// Delegate private keys are encrypted at rest with AES-256-GCM whenever
// SESSION_SECRET is set; plaintext only exists in offline dev (and the file
// records that fact honestly via `keyEncrypted`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSecret, decryptSecret, encryptionEnabled } from './cryptoUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable per-call (tests): set DD_REGISTRY_PATH to a temp file.
const storePath = () => process.env.DD_REGISTRY_PATH || path.join(__dirname, '..', '.wallet-registry.json');

function load() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return { users: {} }; }
}
function save(db) {
  const tmp = storePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, storePath());
}

export function getUser(address) {
  const db = load();
  const u = db.users[String(address).toLowerCase()];
  if (!u) return null;
  try {
    return { ...u, delegatePrivateKey: u.delegatePrivateKey ? decryptSecret(u.delegatePrivateKey) : u.delegatePrivateKey };
  } catch (e) {
    // Wrong SESSION_SECRET or corrupted row: fail loudly, never hand back garbage.
    console.error(`registry: cannot decrypt delegate key for ${String(address).slice(0, 10)}… — ${String(e?.message || e).slice(0, 80)}`);
    return null;
  }
}

export function upsertUser({ address, accountId, delegatePrivateKey, delegatePublicKey, delegateAddress, pendingPhase, pendingTxBytes }) {
  const db = load();
  const key = String(address).toLowerCase();
  const prev = db.users[key] || {};
  const row = {
    ...prev,
    address: key,
    accountId: accountId === undefined ? prev.accountId : accountId,
    delegatePublicKey: delegatePublicKey ?? prev.delegatePublicKey,
    delegateAddress: delegateAddress ?? prev.delegateAddress,
    pendingPhase: pendingPhase === undefined ? prev.pendingPhase : pendingPhase,
    pendingTxBytes: pendingTxBytes === undefined ? prev.pendingTxBytes : pendingTxBytes,
    keyEncrypted: encryptionEnabled(),
    onboardedAt: prev.onboardedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (delegatePrivateKey !== undefined) row.delegatePrivateKey = encryptSecret(delegatePrivateKey);
  db.users[key] = row;
  save(db);
  getUser(address); // fail fast at write time if decryption can't round-trip
  return row;
}

export function markAccountLinked(address, accountId) {
  const db = load();
  const key = String(address).toLowerCase();
  if (!db.users[key]) return null;
  db.users[key].accountId = accountId;
  db.users[key].pendingPhase = null;
  db.users[key].pendingTxBytes = null;
  db.users[key].updatedAt = new Date().toISOString();
  save(db);
  return db.users[key];
}
