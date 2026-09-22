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

import fs from 'node:fs';
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
