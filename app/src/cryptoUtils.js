// Secret-at-rest crypto for DoseDaughter (delegate private keys, etc.).
// AES-256-GCM with a key derived (SHA-256) from SESSION_SECRET. When
// SESSION_SECRET is unset, values pass through UNENCRYPTED (offline dev), and
// the registry marks that fact so audits can tell the two states apart.
// Stored shape: { enc: true, v: "iv_b64.tag_b64.ct_b64" } | { enc: false, v }
import crypto from 'node:crypto';

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function encryptionEnabled() {
  return Boolean(process.env.SESSION_SECRET);
}

export function encryptSecret(plain) {
  if (!encryptionEnabled()) return { enc: false, v: String(plain) };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(process.env.SESSION_SECRET), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: true, v: `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}` };
}

// Returns the plaintext or throws (wrong secret / tampered data must never
// silently produce garbage keys that then fail relayer auth confusingly).
export function decryptSecret(stored) {
  if (stored == null) throw new Error('no secret stored');
  if (typeof stored === 'string') return stored; // legacy plaintext row
  if (stored.enc === false) return String(stored.v);
  if (stored.enc !== true || typeof stored.v !== 'string' || stored.v.split('.').length !== 3) {
    throw new Error('malformed encrypted secret');
  }
  const [ivB64, tagB64, ctB64] = stored.v.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(process.env.SESSION_SECRET), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
