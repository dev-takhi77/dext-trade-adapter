import { ApiV3PoolInfoStandardItemCpmm, CpmmConfigInfoLayout, CpmmKeys, CpmmPoolInfoLayout, CpmmRpcData, fetchMultipleMintInfos, getMultipleAccountsInfoWithCustomFlags, getPdaObservationId, getPdaPoolAuthority, toApiV3Token, toFeeConfig } from "@raydium-io/raydium-sdk-v2";
import { AccountMeta, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { curveSwap } from "./curve/calcualtor";
import { struct, u64 } from "../../../instructions/mashmallow";
import { getCpmmPdaPoolId, RENT_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";


const anchorDataBuf = {
    initialize: [175, 175, 109, 31, 13, 152, 155, 237],
    deposit: [242, 35, 198, 137, 82, 225, 242, 182],
    withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
    swapBaseInput: [143, 190, 90, 218, 196, 30, 51, 222],
    swapBaseOutput: [55, 217, 98, 86, 163, 74, 180, 173],
    lockCpLiquidity: [216, 157, 29, 78, 38, 51, 31, 26],
    collectCpFee: [8, 30, 51, 199, 209, 184, 247, 133],
};

export function makeCreateCpmmPoolInInstruction(
    programId: PublicKey,
    creator: PublicKey,
    configId: PublicKey,
    authority: PublicKey,
    poolId: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    lpMint: PublicKey,
    userVaultA: PublicKey,
    userVaultB: PublicKey,
    userLpAccount: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    createPoolFeeAccount: PublicKey,
    mintProgramA: PublicKey,
    mintProgramB: PublicKey,
    observationId: PublicKey,

    amountMaxA: BN,
    amountMaxB: BN,
    openTime: BN,
): TransactionInstruction {
    const dataLayout = struct([u64("amountMaxA"), u64("amountMaxB"), u64("openTime")]);

    const pdaPoolId = getCpmmPdaPoolId(programId, configId, mintA, mintB).publicKey;

    const keys: Array<AccountMeta> = [
        { pubkey: creator, isSigner: true, isWritable: false },
        { pubkey: configId, isSigner: false, isWritable: false },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: poolId, isSigner: !poolId.equals(pdaPoolId), isWritable: true },
        { pubkey: mintA, isSigner: false, isWritable: false },
        { pubkey: mintB, isSigner: false, isWritable: false },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: userVaultA, isSigner: false, isWritable: true },
        { pubkey: userVaultB, isSigner: false, isWritable: true },
        { pubkey: userLpAccount, isSigner: false, isWritable: true },
        { pubkey: vaultA, isSigner: false, isWritable: true },
        { pubkey: vaultB, isSigner: false, isWritable: true },
        { pubkey: createPoolFeeAccount, isSigner: false, isWritable: true },
        { pubkey: observationId, isSigner: false, isWritable: true },

        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: mintProgramA, isSigner: false, isWritable: false },
        { pubkey: mintProgramB, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
        {
            amountMaxA,
            amountMaxB,
            openTime,
        },
        data,
    );

    return new TransactionInstruction({
        keys,
        programId,
        data: Buffer.from([...anchorDataBuf.initialize, ...data]),
    });
}

export const getRpcPoolInfo = async (connection: Connection, poolId: string, fetchConfigInfo?: boolean): Promise<CpmmRpcData> => {
    return (await getRpcPoolInfos(connection, [poolId], fetchConfigInfo))[poolId];
}

export const getRpcPoolInfos = async (
    connection: Connection,
    poolIds: string[],
    fetchConfigInfo?: boolean,
): Promise<{
    [poolId: string]: CpmmRpcData;
}> => {
    const accounts = await getMultipleAccountsInfoWithCustomFlags(
        connection,
        poolIds.map((i) => ({ pubkey: new PublicKey(i) })),
    );
    const poolInfos: { [poolId: string]: ReturnType<typeof CpmmPoolInfoLayout.decode> & { programId: PublicKey } } = {};

    const needFetchConfigId = new Set<string>();
    const needFetchVaults: PublicKey[] = [];

    for (let i = 0; i < poolIds.length; i++) {
        const item = accounts[i];
        if (item.accountInfo === null) throw Error("fetch pool info error: " + String(poolIds[i]));
        const rpc = CpmmPoolInfoLayout.decode(item.accountInfo.data);
        poolInfos[String(poolIds[i])] = {
            ...rpc,
            programId: item.accountInfo.owner,
        };
        needFetchConfigId.add(String(rpc.configId));

        needFetchVaults.push(rpc.vaultA, rpc.vaultB);
    }

    const configInfo: { [configId: string]: ReturnType<typeof CpmmConfigInfoLayout.decode> } = {};

    if (fetchConfigInfo) {
        const configIds = [...needFetchConfigId];
        const configState = await getMultipleAccountsInfoWithCustomFlags(
            connection,
            configIds.map((i) => ({ pubkey: new PublicKey(i) })),
        );

        for (let i = 0; i < configIds.length; i++) {
            const configItemInfo = configState[i].accountInfo;
            if (configItemInfo === null) throw Error("fetch pool config error: " + configIds[i]);
            configInfo[configIds[i]] = CpmmConfigInfoLayout.decode(configItemInfo.data);
        }
    }

    const vaultInfo: { [vaultId: string]: BN } = {};

    const vaultAccountInfo = await getMultipleAccountsInfoWithCustomFlags(
        connection,
        needFetchVaults.map((i) => ({ pubkey: new PublicKey(i) })),
    );

    for (let i = 0; i < needFetchVaults.length; i++) {
        const vaultItemInfo = vaultAccountInfo[i].accountInfo;
        if (vaultItemInfo === null) throw Error("fetch vault info error: " + needFetchVaults[i]);

        vaultInfo[String(needFetchVaults[i])] = new BN(AccountLayout.decode(vaultItemInfo.data).amount.toString());
    }

    const returnData: { [poolId: string]: CpmmRpcData } = {};

    for (const [id, info] of Object.entries(poolInfos)) {
        const baseReserve = vaultInfo[info.vaultA.toString()].sub(info.protocolFeesMintA).sub(info.fundFeesMintA);
        const quoteReserve = vaultInfo[info.vaultB.toString()].sub(info.protocolFeesMintB).sub(info.fundFeesMintB);
        returnData[id] = {
            ...info,
            baseReserve,
            quoteReserve,
            vaultAAmount: vaultInfo[info.vaultA.toString()],
            vaultBAmount: vaultInfo[info.vaultB.toString()],
            configInfo: configInfo[info.configId.toString()],
            poolPrice: new Decimal(quoteReserve.toString())
                .div(new Decimal(10).pow(info.mintDecimalB))
                .div(new Decimal(baseReserve.toString()).div(new Decimal(10).pow(info.mintDecimalA))),
        };
    }

    return returnData;
}

export const getPoolInfoFromRpc = async (connection: Connection, poolId: string): Promise<{
    poolInfo: ApiV3PoolInfoStandardItemCpmm;
    poolKeys: CpmmKeys;
    rpcData: CpmmRpcData;
}> => {
    const rpcData = await getRpcPoolInfo(connection, poolId, true);
    const mintInfos = await fetchMultipleMintInfos({
        connection: connection,
        mints: [rpcData.mintA, rpcData.mintB],
    });

    const mintA = toApiV3Token({
        address: rpcData.mintA.toBase58(),
        decimals: rpcData.mintDecimalA,
        programId: rpcData.mintProgramA.toBase58(),
        extensions: {
            feeConfig: mintInfos[rpcData.mintA.toBase58()].feeConfig
                ? toFeeConfig(mintInfos[rpcData.mintA.toBase58()].feeConfig)
                : undefined,
        },
    });
    const mintB = toApiV3Token({
        address: rpcData.mintB.toBase58(),
        decimals: rpcData.mintDecimalB,
        programId: rpcData.mintProgramB.toBase58(),
        extensions: {
            feeConfig: mintInfos[rpcData.mintB.toBase58()].feeConfig
                ? toFeeConfig(mintInfos[rpcData.mintB.toBase58()].feeConfig)
                : undefined,
        },
    });

    const lpMint = toApiV3Token({
        address: rpcData.mintLp.toBase58(),
        decimals: rpcData.lpDecimals,
        programId: TOKEN_PROGRAM_ID.toBase58(),
    });

    const configInfo = {
        id: rpcData.configId.toBase58(),
        index: rpcData.configInfo!.index,
        protocolFeeRate: rpcData.configInfo!.protocolFeeRate.toNumber(),
        tradeFeeRate: rpcData.configInfo!.tradeFeeRate.toNumber(),
        fundFeeRate: rpcData.configInfo!.fundFeeRate.toNumber(),
        createPoolFee: rpcData.configInfo!.createPoolFee.toString(),
    };

    const mockRewardData = {
        volume: 0,
        volumeQuote: 0,
        volumeFee: 0,
        apr: 0,
        feeApr: 0,
        priceMin: 0,
        priceMax: 0,
        rewardApr: [],
    };

    return {
        poolInfo: {
            programId: rpcData.programId.toBase58(),
            id: poolId,
            type: "Standard",
            lpMint,
            lpPrice: 0,
            lpAmount: rpcData.lpAmount.toNumber(),
            config: configInfo,
            mintA,
            mintB,
            rewardDefaultInfos: [],
            rewardDefaultPoolInfos: "Ecosystem",
            price: rpcData.poolPrice.toNumber(),
            mintAmountA: new Decimal(rpcData.vaultAAmount.toString()).div(10 ** mintA.decimals).toNumber(),
            mintAmountB: new Decimal(rpcData.vaultBAmount.toString()).div(10 ** mintB.decimals).toNumber(),
            feeRate: rpcData.configInfo!.tradeFeeRate.toNumber(),
            openTime: rpcData.openTime.toString(),
            tvl: 0,
            burnPercent: 0,

            day: mockRewardData,
            week: mockRewardData,
            month: mockRewardData,
            pooltype: [],

            farmUpcomingCount: 0,
            farmOngoingCount: 0,
            farmFinishedCount: 0,
        },
        poolKeys: {
            programId: rpcData.programId.toBase58(),
            id: poolId,
            mintA,
            mintB,
            openTime: rpcData.openTime.toString(),
            vault: { A: rpcData.vaultA.toBase58(), B: rpcData.vaultB.toBase58() },
            authority: getPdaPoolAuthority(rpcData.programId).publicKey.toBase58(),
            mintLp: lpMint,
            config: configInfo,
            observationId: getPdaObservationId(rpcData.programId, new PublicKey(poolId)).publicKey.toBase58(),
        },
        rpcData,
    };
}

export const computeSwapAmount = async ({
    pool,
    amountIn,
    outputMint,
    slippage,
}: {
    pool: CpmmRpcData;
    amountIn: BN;
    outputMint: string | PublicKey;
    slippage: number;
}): Promise<{
    allTrade: boolean;
    amountIn: BN;
    amountOut: BN;
    minAmountOut: BN;
    fee: BN;
    executionPrice: Decimal;
    priceImpact: any;
}> => {
    const isBaseIn = outputMint.toString() === pool.mintB.toBase58();

    const swapResult = curveSwap(
        amountIn,
        isBaseIn ? pool.baseReserve : pool.quoteReserve,
        isBaseIn ? pool.quoteReserve : pool.baseReserve,
        pool.configInfo!.tradeFeeRate,
    );

    const executionPrice = new Decimal(swapResult.destinationAmountSwapped.toString()).div(
        swapResult.sourceAmountSwapped.toString(),
    );

    const minAmountOut = swapResult.destinationAmountSwapped.mul(new BN((1 - slippage) * 10000)).div(new BN(10000));

    return {
        allTrade: swapResult.sourceAmountSwapped.eq(amountIn),
        amountIn,
        amountOut: swapResult.destinationAmountSwapped,
        minAmountOut,
        executionPrice,
        fee: swapResult.tradeFee,
        priceImpact: pool.poolPrice.sub(executionPrice).div(pool.poolPrice),
    };
}

export function makeSwapCpmmBaseInInstruction(
    programId: PublicKey,
    payer: PublicKey,
    authority: PublicKey,
    configId: PublicKey,
    poolId: PublicKey,
    userInputAccount: PublicKey,
    userOutputAccount: PublicKey,
    inputVault: PublicKey,
    outputVault: PublicKey,
    inputTokenProgram: PublicKey,
    outputTokenProgram: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    observationId: PublicKey,

    amountIn: BN,
    amounOutMin: BN,
): TransactionInstruction {
    const dataLayout = struct([u64("amountIn"), u64("amounOutMin")]);

    const keys: Array<AccountMeta> = [
        { pubkey: payer, isSigner: true, isWritable: false },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: configId, isSigner: false, isWritable: false },
        { pubkey: poolId, isSigner: false, isWritable: true },
        { pubkey: userInputAccount, isSigner: false, isWritable: true },
        { pubkey: userOutputAccount, isSigner: false, isWritable: true },
        { pubkey: inputVault, isSigner: false, isWritable: true },
        { pubkey: outputVault, isSigner: false, isWritable: true },
        { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
        { pubkey: outputTokenProgram, isSigner: false, isWritable: false },
        { pubkey: inputMint, isSigner: false, isWritable: false },
        { pubkey: outputMint, isSigner: false, isWritable: false },
        { pubkey: observationId, isSigner: false, isWritable: true },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
        {
            amountIn,
            amounOutMin,
        },
        data,
    );

    return new TransactionInstruction({
        keys,
        programId,
        data: Buffer.from([...anchorDataBuf.swapBaseInput, ...data]),
    });
}