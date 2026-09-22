import { parseAbi } from 'viem';

export const poolAbi = parseAbi([
  'event NewCommitment(bytes32 indexed commitment, uint256 index, bytes encryptedOutput)',
  'event NewNullifier(bytes32 indexed nullifier)',
  'function getLastRoot() view returns (bytes32)',
  'function nextIndex() view returns (uint32)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifier) view returns (bool)',
  'struct Proof { bytes proof; bytes32 root; bytes32[2] inputNullifiers; bytes32[2] outputCommitments; uint256 publicAmount; uint256 assetId; bytes32 extDataHash; }',
  'struct ExtData { address recipient; int256 extAmount; address relayer; uint256 fee; bytes encryptedOutput1; bytes encryptedOutput2; bytes adapterData; }',
  'function transact(Proof args, ExtData extData)',
]);

export const swapAbi = parseAbi([
  'function currentBatch() view returns (uint256)',
  'function batchDuration() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function getBatch(address assetIn, address assetOut, uint256 batchId) view returns ((uint128 totalIn, uint128 totalOut, bool executed, bool refunded))',
  'struct ClaimArgs { bytes proof; bytes32 swapRoot; uint256 batchId; address assetIn; address assetOut; bytes32 nullifier; bytes32 outputCommitment; bytes encryptedOutput; }',
  'function claim(ClaimArgs args)',
]);

export const dexAbi = parseAbi(['function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)']);

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function uiMultiplier() view returns (uint256)',
]);

export const registryAbi = parseAbi(['function isBlocked(address account) view returns (bool)']);
