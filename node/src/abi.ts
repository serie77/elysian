import { parseAbi } from 'viem';

export const poolAbi = parseAbi([
  'event NewCommitment(bytes32 indexed commitment, uint256 index, bytes encryptedOutput)',
  'event NewNullifier(bytes32 indexed nullifier)',
  'event Shielded(address indexed asset, uint256 amount)',
  'event Unshielded(address indexed asset, address indexed recipient, uint256 amount)',
  'function getLastRoot() view returns (bytes32)',
  'function nextIndex() view returns (uint32)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifier) view returns (bool)',
  'function calculatePublicAmount(int256 extAmount, uint256 fee) pure returns (uint256)',
  'struct Proof { bytes proof; bytes32 root; bytes32[2] inputNullifiers; bytes32[2] outputCommitments; uint256 publicAmount; uint256 assetId; bytes32 extDataHash; }',
  'struct ExtData { address recipient; int256 extAmount; address relayer; uint256 fee; bytes encryptedOutput1; bytes encryptedOutput2; bytes adapterData; }',
  'function transact(Proof args, ExtData extData)',
]);

export const swapAbi = parseAbi([
  'event SwapIntent(bytes32 indexed commitment, uint256 index, uint256 indexed batchId, address assetIn, address assetOut, uint256 amountIn, bytes ciphertext)',
  'event BatchExecuted(uint256 indexed batchId, address indexed assetIn, address indexed assetOut, uint256 totalIn, uint256 totalOut)',
  'event BatchCancelled(uint256 indexed batchId, address indexed assetIn, address indexed assetOut, uint256 totalIn)',
  'event SwapClaimed(bytes32 indexed nullifier, bytes32 indexed outputCommitment)',
  'function currentBatch() view returns (uint256)',
  'function batchDuration() view returns (uint256)',
  'function getLastRoot() view returns (bytes32)',
  'function nextIndex() view returns (uint32)',
  'function getBatch(address assetIn, address assetOut, uint256 batchId) view returns ((uint128 totalIn, uint128 totalOut, bool executed, bool refunded))',
  'function executeBatch(address assetIn, address assetOut, uint256 batchId, uint256 minOut)',
  'function cancelBatch(address assetIn, address assetOut, uint256 batchId)',
  'struct ClaimArgs { bytes proof; bytes32 swapRoot; uint256 batchId; address assetIn; address assetOut; bytes32 nullifier; bytes32 outputCommitment; bytes encryptedOutput; }',
  'function claim(ClaimArgs args)',
]);

export const dexAbi = parseAbi([
  'function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)',
]);

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);
