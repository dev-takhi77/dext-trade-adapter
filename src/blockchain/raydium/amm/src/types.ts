import { PublicKey } from "@solana/web3.js";

export interface Fees {
    minSeparateNumerator: bigint;
    minSeparateDenominator: bigint;
    tradeFeeNumerator: bigint;
    tradeFeeDenominator: bigint;
}

export interface OutPutData {
    swapBaseInAmount: bigint;
    swapQuoteOutAmount: bigint;
    swapBase2QuoteFee: bigint;
    swapQuoteInAmount: bigint;
    swapBaseOutAmount: bigint;
    swapQuote2BaseFee: bigint;
}

export interface AmmInfo {
    status: bigint;
    nonce: bigint;
    orderNum: bigint;
    depth: bigint;
    coinDecimals: bigint;
    pcDecimals: bigint;
    state: bigint;
    resetFlag: bigint;
    minSize: bigint;
    volMaxCutRatio: bigint;
    amountWave: bigint;
    coinLotSize: bigint;
    pcLotSize: bigint;
    minPriceMultiplier: bigint;
    maxPriceMultiplier: bigint;
    sysDecimalValue: bigint;
    fees: Fees;

    pnlNumerator: bigint;
    pnlDenominator: bigint;
    swapFeeNumerator: bigint;
    swapFeeDenominator: bigint;
    baseNeedTakePnl: bigint;
    quoteNeedTakePnl: bigint;
    quoteTotalPnl: bigint;
    baseTotalPnl: bigint;
    poolOpenTime: bigint;
    punishPcAmount: bigint;
    punishCoinAmount: bigint;
    orderbookToInitTime: bigint;
    outPut: OutPutData;
    baseVault: PublicKey; // PublicKey (32 bytes)
    quoteVault: PublicKey;  // PublicKey (32 bytes)
    baseMint: PublicKey; // PublicKey (32 bytes)
    quoteMint: PublicKey;   // PublicKey (32 bytes)
    lpMint: PublicKey;   // PublicKey (32 bytes)
    openOrders: PublicKey; // PublicKey (32 bytes)
    marketId: PublicKey;   // PublicKey (32 bytes)
    marketProgramId: PublicKey; // PublicKey (32 bytes)
    targetOrders: PublicKey; // PublicKey (32 bytes)
    withdrawQueue: PublicKey; // PublicKey (32 bytes)
    lpVault: PublicKey; // PublicKey (32 bytes)
    ammOwner: PublicKey; // PublicKey (32 bytes)
    lpAmount: bigint;
    clientOrderId: bigint;
    padding: [bigint, bigint]; // Array of 2 u64 values
}

export interface RaydiumV4SwapAccount {
    amm: PublicKey;
    ammCoinVault: PublicKey;
    ammPcVault: PublicKey;
    ammProgram: PublicKey;
    inputMint: PublicKey;
    userSourceOwner: PublicKey;
}