// Wallet identity + session tokens (DoseDaughter).
// The browser signs a fixed personal message with the visitor's Sui wallet;
// we verify the signature server-side (@mysten/sui/verify) and issue an HMAC-
// signed session cookie. No password, no third-party auth — wallet IS identity.
import crypto from 'node:crypto';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

// Users sign EXACTLY this message (bytes are what the signature covers).
export const AUTH_MESSAGE = 'DoseDaughter: sign in to your memory wallet.\nThis signature proves you own this address. No transaction, no fee.';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isValidSuiAddress(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{64}$/.test(a);
}

// Returns { address } on success, null on any failure. Never trusts the
// client-supplied address — the address is derived from the verified key.
export async function verifyWalletSignature({ address, signature }) {
  try {
    if (!isValidSuiAddress(address) || typeof signature !== 'string' || signature.length < 50) return null;
    const publicKey = await verifyPersonalMessageSignature(new TextEncoder().encode(AUTH_MESSAGE), signature, { address });
    if (!publicKey) return null;
    const derived = publicKey.toSuiAddress();
    // Case-insensitive compare: wallets serialize addresses differently.
    return derived.toLowerCase() === address.toLowerCase() ? { address: derived.toLowerCase() } : null;
  } catch {
    return null;
  }
}

function hmac(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

// Token format: base64url({address, exp}).hmac — stateless, no server store.
export function issueSession(address) {
  const body = Buffer.from(JSON.stringify({ a: address, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function readSession(token) {
  try {
    if (typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = hmac(body);
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!isValidSuiAddress(data.a) || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
    return { address: data.a };
  } catch {
    return null;
  }
}

// Cookie helpers (no cookie-parser dependency needed). Secure flag when the
// request is https (direct or behind a proxy) — sessions work on http localhost.
export function sessionCookie(token, { secure = false } = {}) {
  return `dd_session=${token}; Path=/; HttpOnly; SameSite=Lax;${secure ? ' Secure;' : ''} Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}
export function clearCookie() {
  return 'dd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
export function sessionFromReq(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)dd_session=([^;]+)/);
  return m ? readSession(decodeURIComponent(m[1])) : null;
}
