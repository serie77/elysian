// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

/// @dev Uniswap SwapRouter02, the router deployed on Robinhood Chain (no deadline field).
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IQuoterV2 {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256 gasEstimate);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3Pool {
    function liquidity() external view returns (uint128);
}

/// @title Clears batches against Uniswap v3 on Robinhood Chain, for any pair with a pool.
/// @notice Nobody registers tokens or fee tiers. For each swap the adapter looks at two routes, the
///         deepest direct pool and the deepest pools through WETH, asks the quoter which pays more
///         for this exact size, and trades on that one. A memecoin that only has a WETH pool at the
///         1% tier is therefore reachable from USDG or a stock token without anyone configuring it.
contract UniswapV3Adapter is IDexAdapter {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable router;
    IQuoterV2 public immutable quoter;
    IUniswapV3Factory public immutable factory;
    address public immutable weth;

    error NoRoute();

    constructor(ISwapRouter02 _router, IQuoterV2 _quoter, IUniswapV3Factory _factory, address _weth) {
        router = _router;
        quoter = _quoter;
        factory = _factory;
        weth = _weth;
    }

    /// @dev The fee tier whose pool holds the most in-range liquidity for the pair; 0 when none exists.
    function deepestFee(address a, address b) public view returns (uint24 best) {
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10000];
        uint128 deepest;
        for (uint256 i; i < tiers.length; i++) {
            address pool = factory.getPool(a, b, tiers[i]);
            if (pool == address(0)) continue;
            uint128 l = IUniswapV3Pool(pool).liquidity();
            if (l > deepest) (deepest, best) = (l, tiers[i]);
        }
    }

    function _quote(bytes memory path, uint256 amountIn) internal returns (uint256 out) {
        try quoter.quoteExactInput(path, amountIn) returns (uint256 o, uint160[] memory, uint32[] memory, uint256) {
            out = o;
        } catch {}
    }

    /// @notice Best route and its output for this size. Not a view, because the Uniswap quoter
    ///         simulates the swap; call it with eth_call.
    function route(address tokenIn, address tokenOut, uint256 amountIn) public returns (bytes memory path, uint256 amountOut) {
        uint24 direct = deepestFee(tokenIn, tokenOut);
        if (direct != 0) {
            path = abi.encodePacked(tokenIn, direct, tokenOut);
            amountOut = _quote(path, amountIn);
        }
        if (tokenIn != weth && tokenOut != weth) {
            uint24 a = deepestFee(tokenIn, weth);
            uint24 b = deepestFee(weth, tokenOut);
            if (a != 0 && b != 0) {
                bytes memory hop = abi.encodePacked(tokenIn, a, weth, b, tokenOut);
                uint256 out = _quote(hop, amountIn);
                if (out > amountOut) (path, amountOut) = (hop, out);
            }
        }
        if (amountOut == 0) revert NoRoute();
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        (, amountOut) = route(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        override
        returns (uint256 amountOut)
    {
        (bytes memory path, ) = route(tokenIn, tokenOut, amountIn);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.exactInput(
            ISwapRouter02.ExactInputParams({path: path, recipient: recipient, amountIn: amountIn, amountOutMinimum: minOut})
        );
    }
}
