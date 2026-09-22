import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpendingKey, encodeAddress, decodeAddress, encodeViewingKey, decodeViewingKey, pkFromViewingKey,
  createNote, noteCommitment, serializeNote, encryptTo, tryDecrypt, MerkleTree, scanCommitments,
  swapCommitment, serializeSwap, scanSwaps, selectNotes, noteNullifier, ZERO_LEAF, publicAmount, FIELD_SIZE,
  deserializeNote, NOTE_PLAINTEXT_LENGTH, extDataHash, claimDataHash, ZERO_ADDRESS, legacyExtDataHash, hexToBytes, toHex32,
} from './index.js';

test('keys and addresses round trip', () => {
  const k = SpendingKey.random();
  const addr = encodeAddress(k.address());
  assert.ok(addr.startsWith('elysian1'));
  const d = decodeAddress(addr);
  assert.equal(d.pk, k.pk);
  assert.deepEqual([...d.encPub], [...k.encPub]);
  const v = decodeViewingKey(encodeViewingKey(k.viewingKey()));
  assert.equal(pkFromViewingKey(v), k.pk);
  const fromSig = SpendingKey.fromSignature('0x' + 'ab'.repeat(65));
  assert.equal(fromSig.sk, SpendingKey.fromSignature('0x' + 'ab'.repeat(65)).sk);
});

test('note encryption and scanning', () => {
  const alice = SpendingKey.random();
  const bob = SpendingKey.random();
  const note = createNote(0x1234n, 5n * 10n ** 18n, bob.pk);
  const ct = encryptTo(bob.encPub, serializeNote(note, 'for coffee'));
  assert.equal(tryDecrypt(alice.encPriv, ct), null);
  const found = scanCommitments(bob, [{ commitment: noteCommitment(note), index: 7, ciphertext: ct }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].amount, note.amount);
  assert.equal(found[0].memo, 'for coffee');
  assert.equal(found[0].nullifier, noteNullifier(noteCommitment(note), 7, bob.nk));
  assert.equal(scanCommitments(alice, [{ commitment: noteCommitment(note), index: 7, ciphertext: ct }]).length, 0);
});

test('merkle tree paths verify', () => {
  const t = new MerkleTree(20);
  const leaves = [ZERO_LEAF + 1n, 42n, 43n];
  leaves.forEach((l) => t.insert(l));
  const p = t.path(1);
  assert.equal(p.pathElements.length, 20);
  assert.equal(p.root, t.root);
  const t2 = new MerkleTree(20, leaves);
  assert.equal(t2.root, t.root);
});

test('swap scanning and public amount', () => {
  const k = SpendingKey.random();
  const s = { batchId: 12n, assetIn: 1n, assetOut: 2n, amountIn: 10n, pk: k.pk, blinding: 99n };
  const ct = encryptTo(k.encPub, serializeSwap(s));
  const found = scanSwaps(k, [{ commitment: swapCommitment(s), index: 0, batchId: 12n, assetIn: 1n, assetOut: 2n, amountIn: 10n, ciphertext: ct }]);
  assert.equal(found.length, 1);
  assert.equal(publicAmount(-5n, 2n), FIELD_SIZE - 7n);
  assert.equal(publicAmount(10n, 3n), 7n);
});

test('note selection', () => {
  const k = SpendingKey.random();
  const mk = (amount: bigint, i: number) => {
    const n = createNote(1n, amount, k.pk);
    const c = noteCommitment(n);
    return { ...n, commitment: c, leafIndex: i, nullifier: noteNullifier(c, i, k.nk) };
  };
  const notes = [mk(5n, 0), mk(3n, 1), mk(9n, 2)];
  assert.equal(selectNotes(notes, 9n).length, 1);
  assert.equal(selectNotes(notes, 12n).length, 2);
  assert.throws(() => selectNotes(notes, 100n));
});

test('note plaintexts are one fixed size whatever the memo, and v1 notes still decode', () => {
  const k = SpendingKey.random();
  const note = createNote(0x1234n, 7n, k.pk);
  const sizes = ['', 'hi', 'x'.repeat(128)].map((m) => serializeNote(note, m).length);
  assert.deepEqual(sizes, [NOTE_PLAINTEXT_LENGTH, NOTE_PLAINTEXT_LENGTH, NOTE_PLAINTEXT_LENGTH]);
  assert.equal(deserializeNote(serializeNote(note, 'for coffee'), k.pk).memo, 'for coffee');
  assert.equal(deserializeNote(serializeNote(note, ''), k.pk).memo, '');
  assert.throws(() => serializeNote(note, 'x'.repeat(129)));
  // a v1 plaintext from the first pool: asset(20) | amount(16) | blinding(32) | memo
  const v1 = new Uint8Array(68 + 3);
  v1.set([0x12, 0x34], 18);
  v1[35] = 7;
  v1.set([0x61, 0x62, 0x63], 68);
  const legacy = deserializeNote(v1, k.pk);
  assert.equal(legacy.note.amount, 7n);
  assert.equal(legacy.note.asset, 0x1234n);
  assert.equal(legacy.memo, 'abc');
});

test('hashes are bound to the chain, the contract and the ciphertext', () => {
  const ext = { recipient: ZERO_ADDRESS, extAmount: 0n, relayer: ZERO_ADDRESS, fee: 0n, encryptedOutput1: new Uint8Array(3), encryptedOutput2: new Uint8Array(3), adapterData: new Uint8Array() };
  const here = { chainId: 4663, contract: '0x00691Ac23D51d4CD3d2Db435Ee33ADc6d7306074' as `0x${string}` };
  assert.notEqual(extDataHash(ext, here), extDataHash(ext, { ...here, chainId: 31337 }));
  assert.notEqual(extDataHash(ext, here), extDataHash(ext, { ...here, contract: ZERO_ADDRESS }));
  assert.ok(extDataHash(ext, here) < FIELD_SIZE);
  const ct = new Uint8Array([1, 2, 3, 4]);
  const h = claimDataHash(here, ct);
  assert.notEqual(h, claimDataHash(here, new Uint8Array([1, 2, 3, 5])));
  assert.notEqual(h, claimDataHash(here, new Uint8Array()));
  assert.notEqual(h, claimDataHash({ ...here, chainId: 1 }, ct));
  assert.ok(h < FIELD_SIZE);
});

test('the version 1 hash still reproduces a version 1 mainnet transaction', () => {
  // Robinhood Chain tx 0x6016277a930a500100dd6c178547422e0369e06cb82654d9d4a9e7e9f5cfab5e, an unshield from the v1 pool.
  const ext = {
    recipient: '0x1788E38EB9A26C8aF3c7149E4B1c35e95290E295' as const,
    extAmount: -983386n,
    relayer: '0x1788E38EB9A26C8aF3c7149E4B1c35e95290E295' as const,
    fee: 983n,
    encryptedOutput1: hexToBytes('0x5a9114658c5d7d94050d8b179645e12540ff44f5a1265e107e4f7d7ba6b2a775e649d91cbd5891b394f173660857106c3e64b63e1970ebef8c5205557d606412bc446af412b93b173591f549c9298965df844ea185fc98afe63cfabd7ccb4f1008ff987f05f8dd4a43a58b2580c620be5645353be26d7dae93e365d335ef188c56ac3611328b269820d9d1e9'),
    encryptedOutput2: hexToBytes('0xc310873d25f5a7ff3788867604cabd30386fa7df43cec203e600cf5ad96b02502ce3379f8a122b73515c4d38d42f3088479cf8bf5ba66f3b262c3f57661988a1cb8dde11b02bbc2f57d769efb508ac59d38189c4ed083cf8886435e31337347ccb0099a040167655cce06342ad557959a49c40190f838595efb8ecb01045304e3595b433a104a6b876cfda23'),
    adapterData: new Uint8Array(),
  };
  assert.equal(toHex32(legacyExtDataHash(ext)), '0x180d4e577e44009ddb0dd88dc522e73e004790265139cd430653dbe02e20d4f7');
  // The version 2 hash of the same fields differs, so a version 1 proof can never be replayed on a version 2 pool.
  assert.notEqual(extDataHash(ext, { chainId: 4663, contract: '0x00691Ac23D51d4CD3d2Db435Ee33ADc6d7306074' }), legacyExtDataHash(ext));
});
