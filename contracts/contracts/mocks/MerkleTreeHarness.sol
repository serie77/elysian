// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTreeWithHistory} from "../MerkleTreeWithHistory.sol";
import {IHasher} from "../interfaces/IHasher.sol";

/// @notice Exposes the tree's insert for tests of the root ring buffer.
contract MerkleTreeHarness is MerkleTreeWithHistory {
    constructor(uint32 levels, IHasher hasher) MerkleTreeWithHistory(levels, hasher) {}

    function insert(bytes32 leaf) external returns (uint32) {
        return _insert(leaf);
    }
}
