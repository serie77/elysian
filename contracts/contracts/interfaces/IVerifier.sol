// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Groth16 verifier as emitted by snarkjs. N public signals.
interface ITransactionVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[8] calldata input
    ) external view returns (bool);
}

interface ISwapClaimVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[10] calldata input
    ) external view returns (bool);
}
