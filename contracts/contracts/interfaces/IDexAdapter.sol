// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Venue abstraction used by ElysianSwap to clear a batch's net flow.
interface IDexAdapter {
    /// @dev Pulls `amountIn` of `tokenIn` from msg.sender, delivers at least `minOut` of `tokenOut` to `recipient`.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 amountOut);
}
