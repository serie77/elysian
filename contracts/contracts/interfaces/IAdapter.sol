// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice A contract that may receive unshielded value from the pool and mint notes back into it.
/// Adapters are the composability surface of Elysian: swaps today, lending or staking tomorrow.
interface IAdapter {
    /// @dev Called by ElysianPool after `amount` of `asset` has been transferred to the adapter.
    function onShieldedTransfer(address asset, uint256 amount, bytes calldata data) external;
}

interface IElysianPool {
    function insertFromAdapter(bytes32 commitment, bytes calldata encryptedOutput) external returns (uint32);
}
