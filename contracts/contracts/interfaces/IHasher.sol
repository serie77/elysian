// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Poseidon(2) over BN254, deployed from circomlibjs bytecode.
interface IHasher {
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);
}
