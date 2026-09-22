// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

/// @notice Constant-product venue over its own balances, for tests and local development.
contract MockDex is IDexAdapter {
    using SafeERC20 for IERC20;

    error Slippage();

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 rIn = IERC20(tokenIn).balanceOf(address(this));
        uint256 rOut = IERC20(tokenOut).balanceOf(address(this));
        return (rOut * amountIn) / (rIn + amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        override
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
