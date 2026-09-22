// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IHasher} from "./interfaces/IHasher.sol";

/// @title Append-only Poseidon Merkle tree with a ring buffer of recent roots.
/// @notice Proofs are checked against any of the last ROOT_HISTORY_SIZE roots so a transaction
///         built a few blocks ago still verifies after other insertions.
contract MerkleTreeWithHistory {
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant ROOT_HISTORY_SIZE = 100;

    IHasher public immutable hasher;
    uint32 public immutable levels;

    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public zeros;
    mapping(uint256 => bytes32) public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    error TreeFull();
    error ValueOutOfField();

    constructor(uint32 _levels, IHasher _hasher) {
        require(_levels > 0 && _levels < 32, "levels");
        levels = _levels;
        hasher = _hasher;

        // Empty leaf: keccak256("elysian") mod p. Mirrored by ZERO_LEAF in @elysian/core.
        bytes32 currentZero = bytes32(uint256(keccak256("elysian")) % FIELD_SIZE);
        for (uint32 i = 0; i < _levels; i++) {
            zeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = hashLeftRight(_hasher, currentZero, currentZero);
        }
        roots[0] = currentZero;
    }

    function hashLeftRight(IHasher _hasher, bytes32 left, bytes32 right) public pure returns (bytes32) {
        if (uint256(left) >= FIELD_SIZE || uint256(right) >= FIELD_SIZE) revert ValueOutOfField();
        return bytes32(_hasher.poseidon([uint256(left), uint256(right)]));
    }

    function _insert(bytes32 leaf) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        if (_nextIndex == uint32(2) ** levels) revert TreeFull();

        uint32 currentIndex = _nextIndex;
        bytes32 currentLevelHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(hasher, left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);
        return false;
    }

    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }
}
