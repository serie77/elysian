// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {ISwapClaimVerifier} from "./interfaces/IVerifier.sol";
import {IAdapter, IElysianPool} from "./interfaces/IAdapter.sol";
import {IDexAdapter} from "./interfaces/IDexAdapter.sol";

/// @title ElysianSwap: sealed batch swaps for shielded value.
/// @notice Swap intents arrive from the pool as unshielded value plus a swap commitment. Every
///         intent for a (assetIn, assetOut) pair in the same batch clears at one price against
///         an external venue. Owners later prove their share and mint the output straight back
///         into the pool. The chain learns the pair and the amount of each intent, never the owner,
///         and never which claim belongs to which intent.
contract ElysianSwap is MerkleTreeWithHistory, ReentrancyGuard, Ownable2Step, IAdapter {
    using SafeERC20 for IERC20;

    IElysianPool public immutable pool;
    ISwapClaimVerifier public immutable verifier;
    uint256 public immutable batchDuration;
    /// @dev After this many seconds past a batch's close anyone may cancel it, which refunds every order.
    uint256 public constant EXECUTION_GRACE = 1 hours;
    /// @dev A new venue only takes effect after this long, so nobody can swap it out under open orders.
    uint256 public constant DEX_DELAY = 2 days;
    /// @dev Amounts are range-checked to 120 bits inside the claim circuit.
    uint256 public constant MAX_AMOUNT = 2 ** 120;

    IDexAdapter public dex;
    IDexAdapter public pendingDex;
    uint256 public pendingDexAt;
    mapping(address => bool) public executors;

    struct Batch {
        uint128 totalIn;
        uint128 totalOut;
        bool executed;
        /// @dev Cancelled rather than traded: claims pay each order back in assetIn, one for one.
        bool refunded;
    }

    /// pairKey => batchId => Batch
    mapping(bytes32 => mapping(uint256 => Batch)) public batches;
    mapping(bytes32 => bool) public swapNullifiers;

    event SwapIntent(
        bytes32 indexed commitment,
        uint256 index,
        uint256 indexed batchId,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        bytes ciphertext
    );
    event BatchExecuted(uint256 indexed batchId, address indexed assetIn, address indexed assetOut, uint256 totalIn, uint256 totalOut);
    event BatchCancelled(uint256 indexed batchId, address indexed assetIn, address indexed assetOut, uint256 totalIn);
    event SwapClaimed(bytes32 indexed nullifier, bytes32 indexed outputCommitment);
    event DexProposed(address dex, uint256 activeAt);
    event DexSet(address dex);
    event ExecutorSet(address executor, bool enabled);

    error OnlyPool();
    error BadBatch();
    error BatchNotClosed();
    error BatchAlreadyExecuted();
    error BatchEmpty();
    error BatchNotExecuted();
    error NotExecutor();
    error UnknownSwapRoot();
    error SwapAlreadyClaimed();
    error InvalidClaimProof();
    error SameAsset();
    error InsufficientOutput();
    error OutputOutOfRange();
    error DexNotReady();

    constructor(
        IElysianPool _pool,
        ISwapClaimVerifier _verifier,
        IHasher _hasher,
        uint32 _levels,
        uint256 _batchDuration,
        IDexAdapter _dex,
        address _owner
    ) MerkleTreeWithHistory(_levels, _hasher) Ownable(_owner) {
        pool = _pool;
        verifier = _verifier;
        batchDuration = _batchDuration;
        dex = _dex;
        emit DexSet(address(_dex));
    }

    /* --------------------------------- batching -------------------------------- */

    function currentBatch() public view returns (uint256) {
        return block.timestamp / batchDuration;
    }

    function pairKey(address assetIn, address assetOut) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(assetIn, assetOut));
    }

    function getBatch(address assetIn, address assetOut, uint256 batchId) external view returns (Batch memory) {
        return batches[pairKey(assetIn, assetOut)][batchId];
    }

    /// @inheritdoc IAdapter
    /// @dev data = abi.encode(address assetOut, bytes32 ownerTag, uint256 batchId, bytes ciphertext).
    ///      The leaf is built here from the amount the pool really sent, so an order cannot overstate its size:
    ///      leaf = H(H(H(H(ownerTag, amountIn), batchId), assetIn), assetOut)
    function onShieldedTransfer(address assetIn, uint256 amountIn, bytes calldata data) external override {
        if (msg.sender != address(pool)) revert OnlyPool();
        (address assetOut, bytes32 ownerTag, uint256 batchId, bytes memory ciphertext) =
            abi.decode(data, (address, bytes32, uint256, bytes));
        if (assetOut == assetIn) revert SameAsset();
        {
            uint256 now_ = currentBatch();
            if (batchId != now_ && batchId != now_ + 1) revert BadBatch();
        }
        {
            Batch storage b = batches[pairKey(assetIn, assetOut)][batchId];
            if (b.executed) revert BatchAlreadyExecuted();
            b.totalIn += uint128(amountIn);
        }
        bytes32 commitment = _leaf(ownerTag, amountIn, batchId, assetIn, assetOut);
        emit SwapIntent(commitment, _insert(commitment), batchId, assetIn, assetOut, amountIn, ciphertext);
    }

    function _leaf(bytes32 ownerTag, uint256 amountIn, uint256 batchId, address assetIn, address assetOut) internal view returns (bytes32 leaf) {
        leaf = hashLeftRight(hasher, ownerTag, bytes32(amountIn));
        leaf = hashLeftRight(hasher, leaf, bytes32(batchId));
        leaf = hashLeftRight(hasher, leaf, bytes32(uint256(uint160(assetIn))));
        leaf = hashLeftRight(hasher, leaf, bytes32(uint256(uint160(assetOut))));
    }

    /// @notice Clear a closed batch against the venue. Output lands in the pool. Executors only: the
    ///         caller sets the slippage floor, so this is never open to a stranger with a sandwich ready.
    function executeBatch(address assetIn, address assetOut, uint256 batchId, uint256 minOut) external nonReentrant {
        if (batchId >= currentBatch()) revert BatchNotClosed();
        if (!executors[msg.sender]) revert NotExecutor();

        Batch storage b = batches[pairKey(assetIn, assetOut)][batchId];
        if (b.executed) revert BatchAlreadyExecuted();
        if (b.totalIn == 0) revert BatchEmpty();

        IERC20(assetIn).forceApprove(address(dex), b.totalIn);
        // Claims are paid from what the pool actually received, not from what the venue reports.
        uint256 held = IERC20(assetOut).balanceOf(address(pool));
        dex.swap(assetIn, assetOut, b.totalIn, minOut, address(pool));
        uint256 out = IERC20(assetOut).balanceOf(address(pool)) - held;
        if (out < minOut) revert InsufficientOutput();
        if (out == 0 || out >= MAX_AMOUNT) revert OutputOutOfRange();
        b.totalOut = uint128(out);
        b.executed = true;
        emit BatchExecuted(batchId, assetIn, assetOut, b.totalIn, out);
    }

    /// @notice Give a closed batch back instead of trading it: no route, no liquidity, or no executor.
    ///         The funds return to the pool and every order claims its own amountIn back in assetIn.
    ///         An executor may do this at once; after the grace period anyone may, so orders cannot get stuck.
    function cancelBatch(address assetIn, address assetOut, uint256 batchId) external nonReentrant {
        if (batchId >= currentBatch()) revert BatchNotClosed();
        if (!executors[msg.sender] && block.timestamp <= (batchId + 1) * batchDuration + EXECUTION_GRACE) revert NotExecutor();

        Batch storage b = batches[pairKey(assetIn, assetOut)][batchId];
        if (b.executed) revert BatchAlreadyExecuted();
        if (b.totalIn == 0) revert BatchEmpty();

        b.totalOut = b.totalIn;
        b.executed = true;
        b.refunded = true;
        IERC20(assetIn).safeTransfer(address(pool), b.totalIn);
        emit BatchCancelled(batchId, assetIn, assetOut, b.totalIn);
    }

    /* ---------------------------------- claims --------------------------------- */

    struct ClaimArgs {
        bytes proof;
        bytes32 swapRoot;
        uint256 batchId;
        address assetIn;
        address assetOut;
        bytes32 nullifier;
        bytes32 outputCommitment;
        bytes encryptedOutput;
    }

    /// @notice Prove ownership of an intent in an executed batch and mint the output note.
    function claim(ClaimArgs calldata args) external nonReentrant {
        if (!isKnownRoot(args.swapRoot)) revert UnknownSwapRoot();
        if (swapNullifiers[args.nullifier]) revert SwapAlreadyClaimed();
        Batch storage b = batches[pairKey(args.assetIn, args.assetOut)][args.batchId];
        if (!b.executed) revert BatchNotExecuted();

        (uint256[2] memory a, uint256[2][2] memory bb, uint256[2] memory c) =
            abi.decode(args.proof, (uint256[2], uint256[2][2], uint256[2]));
        bool ok = verifier.verifyProof(
            a,
            bb,
            c,
            [
                // Binds the ciphertext (and this chain and contract) to the proof: a relayer cannot swap it out.
                uint256(keccak256(abi.encode(block.chainid, address(this), args.encryptedOutput))) % FIELD_SIZE,
                uint256(args.swapRoot),
                args.batchId,
                uint256(uint160(args.assetIn)),
                uint256(uint160(args.assetOut)),
                uint256(uint160(b.refunded ? args.assetIn : args.assetOut)),
                uint256(b.totalIn),
                uint256(b.totalOut),
                uint256(args.nullifier),
                uint256(args.outputCommitment)
            ]
        );
        if (!ok) revert InvalidClaimProof();

        swapNullifiers[args.nullifier] = true;
        pool.insertFromAdapter(args.outputCommitment, args.encryptedOutput);
        emit SwapClaimed(args.nullifier, args.outputCommitment);
    }

    /* ---------------------------------- admin ---------------------------------- */

    /// @notice Changing the venue is a two-step, two-day affair.
    function proposeDex(IDexAdapter _dex) external onlyOwner {
        pendingDex = _dex;
        pendingDexAt = block.timestamp + DEX_DELAY;
        emit DexProposed(address(_dex), pendingDexAt);
    }

    function setDex() external onlyOwner {
        if (pendingDexAt == 0 || block.timestamp < pendingDexAt) revert DexNotReady();
        dex = pendingDex;
        pendingDexAt = 0;
        emit DexSet(address(dex));
    }

    function setExecutor(address executor, bool enabled) external onlyOwner {
        executors[executor] = enabled;
        emit ExecutorSet(executor, enabled);
    }
}
