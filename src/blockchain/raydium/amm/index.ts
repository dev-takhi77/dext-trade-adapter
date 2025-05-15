import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PoolReserves } from "../types";
import { AmmInfo, RAY_V4_AUTH_SEED, RAYDIUM_V4_DEVNET_PROGRAM, RAYDIUM_V4_MAINNET_PROGRAM, RaydiumV4SwapAccount } from "./src";
import { AccountLayout, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createRayV4SwapBaseInInstruction } from "./src/instructions";

export const getPoolReserves = async (connection: Connection, poolInfo: AmmInfo): Promise<PoolReserves> => {
    try {
        if (!poolInfo || !poolInfo?.baseVault || !poolInfo?.quoteVault) return {
            //  @ts-ignore
            token0: poolInfo.baseMint.toBase58(),
            //  @ts-ignore
            token1: poolInfo.quoteMint.toBase58(),
            reserveToken0: 0,
            reserveToken1: 0,
        }

        const [baseVaultData, quoteVaultData] = await connection.getMultipleAccountsInfo([
            poolInfo.baseVault,
            poolInfo.quoteVault,
        ]);

        if (!baseVaultData || !quoteVaultData) {
            return {
                token0: poolInfo.baseMint.toBase58(),
                token1: poolInfo.quoteMint.toBase58(),
                reserveToken0: 0,
                reserveToken1: 0
            };
        }

        const baseVaultDecoded = AccountLayout.decode(baseVaultData.data);
        const quoteVaultDecoded = AccountLayout.decode(quoteVaultData.data);

        return {
            token0: poolInfo.baseMint.toBase58(),
            token1: poolInfo.quoteMint.toBase58(),
            reserveToken0: Number(baseVaultDecoded.amount),
            reserveToken1: Number(quoteVaultDecoded.amount),
        };
    } catch (err) {
        console.error("Failed to fetch pool reserves:", err);
        return {
            token0: "",
            token1: "",
            reserveToken0: 0,
            reserveToken1: 0
        };
    }
}

export const getSwapQuote = async (baseAmountIn: number, inputMint: string, reserve: PoolReserves, slippage: number): Promise<number> => {
    let reserveIn: number, reserveOut: number
    if (inputMint == reserve.token0) { reserveIn = reserve.reserveToken0, reserveOut = reserve.reserveToken1 }
    else { reserveOut = reserve.reserveToken0, reserveIn = reserve.reserveToken1 }
    const feeRaw = baseAmountIn * 25 / 10000;
    const amountInWithFee = baseAmountIn - feeRaw;

    const denominator = reserveIn + amountInWithFee;

    const amountOutRaw =
        Math.floor((Number(reserveOut) / Number(denominator)) * Number(amountInWithFee));

    const amountOutRawWithSlippage = Math.floor(amountOutRaw * (1 - slippage / 100))
    return amountOutRawWithSlippage;
}

export const getSwapInstruction = async (poolInfo: AmmInfo, amountIn: number, minAmountOut: number, swapAccountkey: RaydiumV4SwapAccount, cluster: string): Promise<TransactionInstruction> => {
    const {
        amm,
        ammCoinVault,
        ammPcVault,
        inputMint,
        ammProgram,
        userSourceOwner,
    } = swapAccountkey;

    if (!poolInfo) {
        throw new Error("Pool info not loaded.");
    }

    let outputMint: PublicKey;
    if (inputMint == poolInfo.quoteMint) {
        outputMint = poolInfo.baseMint
    } else {
        outputMint = poolInfo.quoteMint
    }

    const userSourceTokenAccount = getAssociatedTokenAddressSync(inputMint, userSourceOwner);
    const userDestinationTokenAccount = getAssociatedTokenAddressSync(outputMint, userSourceOwner);

    const [ammAuthority] = PublicKey.findProgramAddressSync([Buffer.from(RAY_V4_AUTH_SEED)], cluster == "mainnet" ? RAYDIUM_V4_MAINNET_PROGRAM : RAYDIUM_V4_DEVNET_PROGRAM);

    const ix = createRayV4SwapBaseInInstruction({
        programId: ammProgram,
        amm,
        ammAuthority,
        ammOpenOrders: amm,
        ammTargetOrders: amm,
        poolCoinTokenAccount: ammCoinVault,
        poolPcTokenAccount: ammPcVault,
        serumAsks: amm,
        serumBids: amm,
        serumCoinVaultAccount: amm,
        serumEventQueue: amm,
        serumMarket: amm,
        serumPcVaultAccount: amm,
        serumProgram: amm,
        serumVaultSigner: amm,
        tokenProgram: TOKEN_PROGRAM_ID,
        userSourceTokenAccount,
        userDestinationTokenAccount,
        userSourceOwner,
        amountIn,
        minimumAmountOut: minAmountOut,
    })

    return ix
}