// User memory registry (DoseDaughter).
// Persistent JSON store mapping wallet address → MemWal account + delegate key.
// This is SERVICE metadata only — never memory content. All actual memory is
// Seal-encrypted blobs on Walrus, owned by each user's own MemWalAccount.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable for tests: set DD_REGISTRY_PATH to a temp file.
const STORE = process.env.DD_REGISTRY_PATH || path.join(__dirname, '..', '.wallet-registry.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { users: {} }; }
}
function save(db) {
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, STORE);
}

export function getUser(address) {
  const db = load();
  return db.users[String(address).toLowerCase()] || null;
}

export function upsertUser({ address, accountId, delegatePrivateKey, delegatePublicKey, delegateAddress }) {
  const db = load();
  const key = String(address).toLowerCase();
  db.users[key] = {
    ...(db.users[key] || {}),
    address: key,
    accountId,
    delegatePrivateKey,
    delegatePublicKey,
    delegateAddress,
    onboardedAt: db.users[key]?.onboardedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  save(db);
  return db.users[key];
}

export function markAccountLinked(address, accountId) {
  const db = load();
  const key = String(address).toLowerCase();
  if (!db.users[key]) return null;
  db.users[key].accountId = accountId;
  db.users[key].updatedAt = new Date().toISOString();
  save(db);
  return db.users[key];
}
// NOTE: delegate keypair generation comes from the MemWal SDK itself
// (generateDelegateKey in '@mysten-incubation/memwal/account') — see onchain.js.
