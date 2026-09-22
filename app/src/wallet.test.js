// Wallet-layer offline selftests — NO network, NO onchain calls.
// Run: node src/wallet.test.js (also appended to npm test via selftest.js)
import { verifyWalletSignature, issueSession, readSession, sessionCookie, sessionFromReq, isValidSuiAddress } from './walletAuth.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`ok - ${name}`); } else { fail++; console.log(`FAIL - ${name}`); } };

// --- address validation ---
ok(isValidSuiAddress('0x' + 'ab'.repeat(32)), 'isValidSuiAddress accepts 32-byte hex');
ok(!isValidSuiAddress('0x123'), 'isValidSuiAddress rejects short');
ok(!isValidSuiAddress('not-an-address'), 'isValidSuiAddress rejects garbage');

// --- sessions ---
const token = issueSession('0x' + 'ab'.repeat(32));
const sess = readSession(token);
ok(sess && sess.address === '0x' + 'ab'.repeat(32), 'session roundtrip');
ok(readSession(token + 'x') === null, 'tampered token rejected');
ok(readSession('garbage') === null, 'garbage token rejected');
ok(readSession(token.slice(0, token.indexOf('.') + 1) + 'AAA=') === null, 'bad hmac rejected');
const fakeReq = { headers: { cookie: sessionCookie(token).split(';')[0] } };
ok(sessionFromReq(fakeReq)?.address === '0x' + 'ab'.repeat(32), 'sessionFromReq parses cookie');
ok(sessionFromReq({ headers: {} }) === null, 'sessionFromReq no cookie -> null');

// --- signature verification (real Ed25519, in-process) ---
const kp = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, i) => i + 9));
const address = kp.getPublicKey().toSuiAddress();
const { verifyPersonalMessageSignature } = await import('@mysten/sui/verify');
const { AUTH_MESSAGE } = await import('./walletAuth.js');
const sig = (await kp.signPersonalMessage(new TextEncoder().encode(AUTH_MESSAGE))).signature;
const good = await verifyWalletSignature({ address, signature: sig });
ok(good && good.address === address.toLowerCase(), 'valid wallet signature verifies');
const wrong = (await kp.signPersonalMessage(new TextEncoder().encode('wrong message'))).signature;
ok((await verifyWalletSignature({ address, signature: wrong })) === null, 'wrong message rejected');
ok((await verifyWalletSignature({ address, signature: sig.slice(0, -4) + 'AAAA' })) === null, 'corrupted signature rejected');
ok((await verifyWalletSignature({ address: '0x1234', signature: sig })) === null, 'bad address rejected');
ok((await verifyWalletSignature({ address, signature: 'junk' })) === null, 'junk signature rejected');

// --- registry (temp store) ---
process.env.DD_REGISTRY_PATH = '.wallet-registry.selftest.json';
const reg = await import('./userRegistry.js');
ok(reg.getUser('0x' + 'cd'.repeat(32)) === null, 'registry empty lookup');
reg.upsertUser({ address: '0x' + 'cd'.repeat(32), accountId: '0x' + 'ef'.repeat(32), delegatePrivateKey: 'aa', delegatePublicKey: 'bb', delegateAddress: '0x' + '11'.repeat(32) });
const u = reg.getUser('0x' + 'cd'.repeat(32));
ok(u && u.accountId === '0x' + 'ef'.repeat(32), 'registry upsert + get');
reg.markAccountLinked('0x' + 'cd'.repeat(32), '0x' + 'ee'.repeat(32));
ok(reg.getUser('0x' + 'cd'.repeat(32)).accountId === '0x' + 'ee'.repeat(32), 'markAccountLinked updates');
try { fs.unlinkSync('.wallet-registry.selftest.json'); } catch { /* best effort */ }

// --- delegate client factory (pure config check, no network) ---
const mem = await import('./memory.js');
let threw = false;
try { mem.createDelegateClient({}); } catch { threw = true; }
ok(threw, 'createDelegateClient throws without key/account');
let built = null;
try { built = mem.createDelegateClient({ delegatePrivateKey: 'aa', accountId: '0x' + 'ef'.repeat(32) }); } catch { built = null; }
ok(built && typeof built === 'object', 'createDelegateClient with values constructs a client (lazy validation)');

// --- secret-at-rest encryption (AES-256-GCM) ---
{
  const cu = await import('./cryptoUtils.js');
  process.env.SESSION_SECRET = 'test-secret-123';
  const enc = cu.encryptSecret('deadbeef00');
  ok(enc.enc === true && /\/.+\//.test(enc.v.split('.')[2] || '') === false && enc.v.split('.').length === 3, 'encryptSecret emits iv.tag.ct');
  ok(!JSON.stringify(enc).includes('deadbeef00'), 'ciphertext does not contain plaintext');
  ok(cu.decryptSecret(enc) === 'deadbeef00', 'decryptSecret roundtrip');
  const tampered = { enc: true, v: enc.v.slice(0, -2) + 'xx' };
  let threwT = false;
  try { cu.decryptSecret(tampered); } catch { threwT = true; }
  ok(threwT, 'tampered ciphertext throws (GCM auth)');
  ok(cu.decryptSecret({ enc: false, v: 'plain' }) === 'plain', 'unencrypted rows pass through');
  ok(cu.decryptSecret('legacy-string') === 'legacy-string', 'legacy plaintext rows pass through');
  delete process.env.SESSION_SECRET;
  ok(cu.encryptionEnabled() === false && cu.encryptSecret('x').enc === false, 'no SESSION_SECRET -> honest plaintext mode');
}

// --- registry encryption at rest ---
{
  process.env.SESSION_SECRET = 'test-secret-123';
  process.env.DD_REGISTRY_PATH = '.wallet-registry.selftest2.json';
  const reg2 = await import('./userRegistry.js');
  const addr = '0x' + '99'.repeat(32);
  reg2.upsertUser({ address: addr, accountId: null, delegatePrivateKey: 'secret-key-hex', delegatePublicKey: 'pub', delegateAddress: '0x' + '22'.repeat(32) });
  const raw = JSON.parse(fs.readFileSync('.wallet-registry.selftest2.json', 'utf8'));
  ok(!JSON.stringify(raw).includes('secret-key-hex'), 'registry file does not contain plaintext delegate key');
  ok(raw.users[addr].keyEncrypted === true, 'registry records keyEncrypted=true');
  ok(reg2.getUser(addr).delegatePrivateKey === 'secret-key-hex', 'registry decrypts on read');
  // Restart-simulation: new module instances (serverless cold start) still decrypt.
  delete process.env.DD_REGISTRY_PATH;
  const reg3 = await import('./userRegistry.js');
  process.env.DD_REGISTRY_PATH = '.wallet-registry.selftest2.json';
  ok(reg3.getUser(addr).delegatePrivateKey === 'secret-key-hex', 'decrypt works across module reload');
  // Wrong secret must fail LOUDLY (null), never return garbage.
  process.env.SESSION_SECRET = 'different-secret';
  ok(reg3.getUser(addr) === null, 'wrong SESSION_SECRET -> null, not garbage');
  process.env.SESSION_SECRET = 'test-secret-123';
  fs.unlinkSync('.wallet-registry.selftest2.json');
  delete process.env.DD_REGISTRY_PATH;
  delete process.env.SESSION_SECRET;
}

// --- rate limiter ---
{
  const rl = await import('./rateLimit.js');
  const key = 'test:' + Math.random();
  ok(rl.rateLimit({ key, limit: 2, windowMs: 1000 }).allowed === true, 'rate limit 1st ok');
  ok(rl.rateLimit({ key, limit: 2, windowMs: 1000 }).allowed === true, 'rate limit 2nd ok');
  ok(rl.rateLimit({ key, limit: 2, windowMs: 1000 }).allowed === false, 'rate limit 3rd blocked');
}

import fs from 'node:fs';
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
