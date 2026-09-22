// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {ITransactionVerifier} from "./interfaces/IVerifier.sol";
import {IAdapter, IElysianPool} from "./interfaces/IAdapter.sol";

/// @title ElysianPool: the shielded pool.
/// @notice Holds every ERC-20 that has been shielded and the commitment tree of the notes that
///         own them. A transaction spends up to two notes and creates two, moving publicAmount
///         across the shield boundary. Nothing about who owns what is stored here.
contract ElysianPool is MerkleTreeWithHistory, ReentrancyGuard, Ownable2Step, IElysianPool {
    using SafeERC20 for IERC20;

    /// @dev Amounts are range-checked to 120 bits inside the circuit; keep the boundary consistent.
    uint256 public constant MAX_EXT_AMOUNT = 2 ** 120;
    uint256 public constant MAX_FEE = 2 ** 120;

    ITransactionVerifier public immutable verifier;

    mapping(bytes32 => bool) public nullifierHashes;
    mapping(address => bool) public adapters;
    /// @dev Adapters can mint notes, so once the pool holds deposits a new one waits this long in the open.
    uint256 public constant ADAPTER_DELAY = 2 days;
    mapping(address => uint256) public adapterReadyAt;

    struct Proof {
        bytes proof; // abi.encode(uint[2] a, uint[2][2] b, uint[2] c)
        bytes32 root;
        bytes32[2] inputNullifiers;
        bytes32[2] outputCommitments;
        uint256 publicAmount;
        uint256 assetId;
        bytes32 extDataHash;
    }

    struct ExtData {
        address recipient;
        int256 extAmount; // > 0 shield, < 0 unshield (to recipient or adapter), 0 private transfer
        address relayer;
        uint256 fee;
        bytes encryptedOutput1;
        bytes encryptedOutput2;
        bytes adapterData;
    }

    event NewCommitment(bytes32 indexed commitment, uint256 index, bytes encryptedOutput);
    event NewNullifier(bytes32 indexed nullifier);
    event Shielded(address indexed asset, uint256 amount);
    event Unshielded(address indexed asset, address indexed recipient, uint256 amount);
    event AdapterSet(address indexed adapter, bool enabled);
    event AdapterProposed(address indexed adapter, uint256 readyAt);

    error UnknownRoot();
    error NullifierSpent();
    error InvalidExtDataHash();
    error InvalidPublicAmount();
    error InvalidProof();
    error InvalidAsset();
    error AmountOutOfRange();
    error FeeOutOfRange();
    error NotAdapter();
    error UnsupportedToken();
    error AdapterNotReady();
    error DuplicateNullifier();

    constructor(ITransactionVerifier _verifier, IHasher _hasher, uint32 _levels, address _owner)
        MerkleTreeWithHistory(_levels, _hasher)
        Ownable(_owner)
    {
        verifier = _verifier;
    }

    /* ------------------------------------ core ------------------------------------ */

    /// @notice Shield, unshield, transfer or route to an adapter, depending on extData.
    function transact(Proof calldata args, ExtData calldata extData) external nonReentrant {
        address asset = _asset(args.assetId);
        if (extData.extAmount > 0) {
            // Tokens that take a cut on transfer would leave the pool short for the last person out.
            uint256 held = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), uint256(extData.extAmount));
            if (IERC20(asset).balanceOf(address(this)) - held != uint256(extData.extAmount)) revert UnsupportedToken();
            emit Shielded(asset, uint256(extData.extAmount));
        }
        _transact(args, extData, asset);
    }

    /// @notice Adapters mint notes back into the pool (for example the output of a batch swap).
    function insertFromAdapter(bytes32 commitment, bytes calldata encryptedOutput) external returns (uint32 index) {
        if (!adapters[msg.sender]) revert NotAdapter();
        index = _insert(commitment);
        emit NewCommitment(commitment, index, encryptedOutput);
    }

    function proposeAdapter(address adapter) external onlyOwner {
        adapterReadyAt[adapter] = block.timestamp + ADAPTER_DELAY;
        emit AdapterProposed(adapter, adapterReadyAt[adapter]);
    }

    /// @notice Enabling is instant only while the pool is still empty (deployment). After the first
    ///         deposit it needs a proposal that has aged two days. Disabling is always instant.
    function setAdapter(address adapter, bool enabled) external onlyOwner {
        if (enabled && nextIndex != 0) {
            uint256 readyAt = adapterReadyAt[adapter];
            if (readyAt == 0 || block.timestamp < readyAt) revert AdapterNotReady();
        }
        adapters[adapter] = enabled;
        emit AdapterSet(adapter, enabled);
    }

    /* ---------------------------------- internals ---------------------------------- */

    function _transact(Proof calldata args, ExtData calldata extData, address asset) internal {
        if (!isKnownRoot(args.root)) revert UnknownRoot();
        if (args.inputNullifiers[0] == args.inputNullifiers[1]) revert DuplicateNullifier();
        for (uint256 i = 0; i < 2; i++) {
            if (nullifierHashes[args.inputNullifiers[i]]) revert NullifierSpent();
        }
        // The chain id and this pool's address are in the hash, so a proof is only ever valid here.
        if (uint256(args.extDataHash) != uint256(keccak256(bytes.concat(abi.encode(extData), abi.encode(block.chainid, address(this))))) % FIELD_SIZE) {
            revert InvalidExtDataHash();
        }
        if (args.publicAmount != calculatePublicAmount(extData.extAmount, extData.fee)) revert InvalidPublicAmount();
        if (!verifyProof(args)) revert InvalidProof();

        for (uint256 i = 0; i < 2; i++) {
            nullifierHashes[args.inputNullifiers[i]] = true;
            emit NewNullifier(args.inputNullifiers[i]);
        }

        // Both nullifiers are distinct by circuit constraint; mark before any external call.
        emit NewCommitment(args.outputCommitments[0], _insert(args.outputCommitments[0]), extData.encryptedOutput1);
        emit NewCommitment(args.outputCommitments[1], _insert(args.outputCommitments[1]), extData.encryptedOutput2);

        if (extData.extAmount < 0) {
            uint256 amount = uint256(-extData.extAmount);
            IERC20(asset).safeTransfer(extData.recipient, amount);
            emit Unshielded(asset, extData.recipient, amount);
            if (adapters[extData.recipient]) {
                IAdapter(extData.recipient).onShieldedTransfer(asset, amount, extData.adapterData);
            }
        }

        if (extData.fee > 0) {
            IERC20(asset).safeTransfer(extData.relayer, extData.fee);
        }
    }

    /// @dev publicAmount = extAmount - fee, mapped into the field. Negative values wrap to p - |x|.
    function calculatePublicAmount(int256 extAmount, uint256 fee) public pure returns (uint256) {
        if (fee >= MAX_FEE) revert FeeOutOfRange();
        if (extAmount >= int256(MAX_EXT_AMOUNT) || extAmount <= -int256(MAX_EXT_AMOUNT)) revert AmountOutOfRange();
        int256 publicAmount = extAmount - int256(fee);
        return publicAmount >= 0 ? uint256(publicAmount) : FIELD_SIZE - uint256(-publicAmount);
    }

    function verifyProof(Proof calldata args) public view returns (bool) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(args.proof, (uint256[2], uint256[2][2], uint256[2]));
        return verifier.verifyProof(
            a,
            b,
            c,
            [
                uint256(args.root),
                args.publicAmount,
                uint256(args.extDataHash),
                args.assetId,
                uint256(args.inputNullifiers[0]),
                uint256(args.inputNullifiers[1]),
                uint256(args.outputCommitments[0]),
                uint256(args.outputCommitments[1])
            ]
        );
    }

    function isSpent(bytes32 nullifier) external view returns (bool) {
        return nullifierHashes[nullifier];
    }

    function _asset(uint256 assetId) internal pure returns (address) {
        if (assetId == 0 || assetId >= (1 << 160)) revert InvalidAsset();
        return address(uint160(assetId));
    }
}
