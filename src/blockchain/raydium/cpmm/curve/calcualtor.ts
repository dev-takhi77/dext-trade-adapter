import { ApiV3Token, BNDivCeil, FEE_RATE_DENOMINATOR_VALUE, SwapResult, SwapWithoutFeesResult } from "@raydium-io/raydium-sdk-v2";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

export function ceilDiv(tokenAmount: BN, feeNumerator: BN, feeDenominator: BN): BN {
    return tokenAmount.mul(feeNumerator).add(feeDenominator).sub(new BN(1)).div(feeDenominator);
}

export const tradingFee = (amount: BN, tradeFeeRate: BN): BN => {
    return ceilDiv(amount, tradeFeeRate, FEE_RATE_DENOMINATOR_VALUE);
}

function checkedRem(dividend: BN, divisor: BN): BN {
    if (divisor.isZero()) throw Error("divisor is zero");

    const result = dividend.mod(divisor);
    return result;
}

const ZERO = new BN(0);

function checkedCeilDiv(dividend: BN, rhs: BN): BN[] {
    if (rhs.isZero()) throw Error("rhs is zero");

    let quotient = dividend.div(rhs);

    if (quotient.isZero()) throw Error("quotient is zero");

    let remainder = checkedRem(dividend, rhs);

    if (remainder.gt(ZERO)) {
        quotient = quotient.add(new BN(1));

        rhs = dividend.div(quotient);
        remainder = checkedRem(dividend, quotient);
        if (remainder.gt(ZERO)) {
            rhs = rhs.add(new BN(1));
        }
    }
    return [quotient, rhs];
}

export const swapWithoutFees = (sourceAmount: BN, swapSourceAmount: BN, swapDestinationAmount: BN): SwapWithoutFeesResult => {
    const invariant = swapSourceAmount.mul(swapDestinationAmount);

    const newSwapSourceAmount = swapSourceAmount.add(sourceAmount);
    const [newSwapDestinationAmount] = checkedCeilDiv(invariant, newSwapSourceAmount);

    const destinationAmountSwapped = swapDestinationAmount.sub(newSwapDestinationAmount);
    if (destinationAmountSwapped.isZero()) throw Error("destinationAmountSwapped is zero");

    return {
        destinationAmountSwapped,
    };
}

export const curveSwap = (sourceAmount: BN, swapSourceAmount: BN, swapDestinationAmount: BN, tradeFeeRate: BN): SwapResult => {
    const tradeFee = tradingFee(sourceAmount, tradeFeeRate);

    const sourceAmountLessFees = sourceAmount.sub(tradeFee);

    const { destinationAmountSwapped } = swapWithoutFees(
        sourceAmountLessFees,
        swapSourceAmount,
        swapDestinationAmount,
    );

    return {
        newSwapDestinationAmount: swapDestinationAmount.sub(destinationAmountSwapped),
        sourceAmountSwapped: sourceAmount,
        destinationAmountSwapped,
        tradeFee,
    };
}

export const swapBaseOut = ({
    poolMintA,
    poolMintB,
    tradeFeeRate,
    baseReserve,
    quoteReserve,
    outputMint,
    outputAmount,
}: {
    poolMintA: ApiV3Token;
    poolMintB: ApiV3Token;
    tradeFeeRate: BN;
    baseReserve: BN;
    quoteReserve: BN;
    outputMint: string | PublicKey;
    outputAmount: BN;
}): {
    amountRealOut: BN;
    amountIn: BN;
    amountInWithoutFee: BN;
    tradeFee: BN;
    priceImpact: number;
} => {
    const [reserveInAmount, reserveOutAmount, reserveInDecimals, reserveOutDecimals, inputMint] =
        poolMintB.address === outputMint.toString()
            ? [baseReserve, quoteReserve, poolMintA.decimals, poolMintB.decimals, poolMintA.address]
            : [quoteReserve, baseReserve, poolMintB.decimals, poolMintA.decimals, poolMintB.address];
    const currentPrice = new Decimal(reserveOutAmount.toString())
        .div(10 ** reserveOutDecimals)
        .div(new Decimal(reserveInAmount.toString()).div(10 ** reserveInDecimals));
    const amountRealOut = outputAmount.gte(reserveOutAmount) ? reserveOutAmount.sub(new BN(1)) : outputAmount;

    const denominator = reserveOutAmount.sub(amountRealOut);
    const amountInWithoutFee = BNDivCeil(reserveInAmount.mul(amountRealOut), denominator);
    const amountIn = BNDivCeil(amountInWithoutFee.mul(new BN(1_000_000)), new BN(1_000_000).sub(tradeFeeRate));
    const fee = amountIn.sub(amountInWithoutFee);
    const executionPrice = new Decimal(amountRealOut.toString())
        .div(10 ** reserveOutDecimals)
        .div(new Decimal(amountIn.toString()).div(10 ** reserveInDecimals));
    const priceImpact = currentPrice.isZero() ? 0 : executionPrice.sub(currentPrice).div(currentPrice).abs().toNumber();

    return {
        amountRealOut,
        amountIn,
        amountInWithoutFee,
        tradeFee: fee,
        priceImpact,
    };
}