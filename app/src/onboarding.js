// Onboarding orchestrator (DoseDaughter).
// Flow — the visitor's wallet signs and PAYS every transaction (v1 relayer
// model: users own and fund their memory; the bot holds NO wallet power):
//   fresh user:  tx 1 create_account  →  tx 2 add_delegate_key (link us)
//   existing:    tx 1 add_delegate_key only
// After linking, the server talks Walrus Memory AS THE USER's delegate —
// memory lives in the user's own MemWalAccount, Seal-encrypted on Walrus.
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateDelegateKey } from '@mysten-incubation/memwal/account';
import {
  buildCreateAccountTx,
  buildLinkDelegateTx,
  accountForOwner,
  verifyAccount,
  executeSigned,
} from './onchain.js';
import { upsertUser, markAccountLinked, getUser } from './userRegistry.js';

// Graphql client is only used for tx byte building (tx.build({ client })).
function buildClient() {
  return new SuiGraphQLClient({ url: process.env.SUI_GRAPHQL_URL || 'https://graphql.mainnet.sui.io/graphql', network: 'mainnet' });
}

function keypairFromHexPrivateKey(hex) {
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(String(hex).replace(/^0x/, ''), 'hex')));
}

export async function walletStatus(address) {
  const user = getUser(address);
  let onchain = null;
  if (!user?.accountId) onchain = await accountForOwner(address);
  const accountId = user?.accountId || onchain?.accountId || null;
  return {
    address,
    onboarded: Boolean(accountId),
    // true => account exists onchain but this server lost its registry row
    // (e.g. redeploy): user only needs the LINK step, not create.
    needsRelink: Boolean(!user?.accountId && onchain?.accountId),
    accountId,
  };
}

// --- Step 1a (fresh user): build create_account tx for the wallet to sign.
export async function prepareCreateAccount(address) {
  const delegate = await generateDelegateKey();
  const delegatePublicKeyHex = Buffer.from(delegate.publicKey).toString('hex');
  const tx = buildCreateAccountTx(address);
  const bytes = await tx.build({ client: buildClient() });
  const txBytesBase64 = Buffer.from(bytes).toString('base64');
  // Persist BEFORE the signature is requested. If the tab closes mid-flow,
  // the delegate keypair is already durably stored; a re-prepare regenerates
  // a fresh pair (last one wins) and any stale signed tx fails onchain.
  upsertUser({
    address,
    accountId: null,
    delegatePrivateKey: delegate.privateKey,
    delegatePublicKey: delegatePublicKeyHex,
    delegateAddress: delegate.suiAddress,
    pendingPhase: 'create',
    pendingTxBytes: txBytesBase64,
  });
  return { txBytesBase64, delegateAddress: delegate.suiAddress };
}

// --- Step 1b (existing account, or fresh user after tx 1 landed): link tx.
export async function prepareLinkDelegate(address) {
  const user = getUser(address);
  let accountId = user?.accountId || (await accountForOwner(address))?.accountId || null;
  if (!accountId) throw new Error('No MemWalAccount found for this address — create one first');
  if (!user?.delegatePrivateKey) throw new Error('No delegate key on file — call prepareCreateAccount first');
  const delegatePublicKey = Uint8Array.from(Buffer.from(user.delegatePublicKey, 'hex'));
  const tx = buildLinkDelegateTx(address, accountId, delegatePublicKey);
  const bytes = await tx.build({ client: buildClient() });
  const txBytesBase64 = Buffer.from(bytes).toString('base64');
  // Persist the account id with the pending phase: if the user signs but
  // closes the tab before completion, the next visit finds the account id
  // locally instead of re-discovering it via events.
  upsertUser({ address, accountId, pendingPhase: 'link', pendingTxBytes: txBytesBase64 });
  return { txBytesBase64, accountId };
}

// --- Step 2: submit the visitor-signed bytes, then verify onchain state.
export async function completeOnboarding(address, signatureBase64) {
  const user = getUser(address);
  if (!user?.pendingTxBytes || !user?.pendingPhase) {
    throw new Error('No onboarding in progress for this address — call prepare first');
  }
  const res = await executeSigned(
    Uint8Array.from(Buffer.from(user.pendingTxBytes, 'base64')),
    signatureBase64,
  );
  const digest = res?.digest || null;
  upsertUser({ address, pendingPhase: null, pendingTxBytes: null });

  if (user.pendingPhase === 'create') {
    // Account id arrives via AccountCreated events (sender = the user).
    let account = null;
    for (let i = 0; i < 6 && !account; i++) {
      account = await accountForOwner(address);
      if (!account) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!account?.accountId) {
      throw new Error(`Transaction ${digest || ''} landed but the AccountCreated event is not indexed yet — retry /api/wallet/status in a few seconds`);
    }
    const check = await verifyAccount(account.accountId, { expectOwner: address });
    if (!check.ok) throw new Error(`Account verification failed: ${check.reason}`);
    markAccountLinked(address, account.accountId);
    return { stage: 'created', accountId: account.accountId, digest, nextStep: 'link' };
  }

  // link phase: the delegate key must now be registered on the account.
  const accountId = user.accountId || (await accountForOwner(address))?.accountId;
  if (!accountId) throw new Error('Account not found after link transaction — unexpected state');
  const check = await verifyAccount(accountId, {
    expectOwner: address,
    expectDelegateAddress: user.delegateAddress,
  });
  if (!check.ok) throw new Error(`Link verification failed: ${check.reason}`);
  return { stage: 'linked', accountId, digest, nextStep: null };
}

// Recover a lost registry: re-link an account that already exists onchain.
export async function relinkExisting(address) {
  const account = await accountForOwner(address);
  if (!account) return null;
  markAccountLinked(address, account.accountId);
  return { accountId: account.accountId, alreadyLinked: true };
}
