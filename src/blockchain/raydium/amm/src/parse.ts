import { PublicKey } from "@solana/web3.js";
import { AmmInfo } from "./types";

// Function to parse the raw bytes into AmmInfo
export function parseAmmInfo(buffer: Buffer): AmmInfo {
    let offset = 0;

    // Function to read a u64 value (8 bytes) and advance the offset
    function readU64() {
        const value = buffer.readBigUInt64LE(offset);
        offset += 8;
        return value;
    }
    
    function readU128() {
        const value = buffer.readBigUInt64LE(offset);
        offset += 16;
        return value;
    }

    // Function to read a publicKey (32 bytes) and advance the offset
    function readPublicKey() {
        const value = buffer.slice(offset, offset + 32);
        offset += 32;
        return value;
    }

    // Parsing the fields
    const ammInfo: AmmInfo = {
        status: readU64(),
        nonce: readU64(),
        orderNum: readU64(),
        depth: readU64(),
        coinDecimals: readU64(),
        pcDecimals: readU64(),
        state: readU64(),
        resetFlag: readU64(),
        minSize: readU64(),
        volMaxCutRatio: readU64(),
        amountWave: readU64(),
        coinLotSize: readU64(),
        pcLotSize: readU64(),
        minPriceMultiplier: readU64(),
        maxPriceMultiplier: readU64(),
        sysDecimalValue: readU64(),

        // Parsing the nested Fees and OutPutData objects
        fees: {
            minSeparateNumerator: readU64(),
            minSeparateDenominator: readU64(),
            tradeFeeNumerator: readU64(),
            tradeFeeDenominator: readU64(),
        },
        pnlNumerator : readU64(),
        pnlDenominator : readU64(),
        swapFeeNumerator : readU64(),
        swapFeeDenominator : readU64(),
        baseNeedTakePnl : readU64(),
        quoteNeedTakePnl : readU64(),
        quoteTotalPnl : readU64(),
        baseTotalPnl : readU64(),
        poolOpenTime : readU64(),
        punishPcAmount : readU64(),
        punishCoinAmount : readU64(),
        orderbookToInitTime : readU64(),
        outPut: {
            swapBaseInAmount: readU128(),
            swapQuoteOutAmount: readU128(),
            swapBase2QuoteFee: readU128(),
            swapQuoteInAmount: readU128(),
            swapBaseOutAmount: readU64(),
            swapQuote2BaseFee: readU64(),
        },

        // Parsing publicKeys (32 bytes each)
        baseVault: new PublicKey(readPublicKey()),
        quoteVault: new PublicKey(readPublicKey()),
        baseMint: new PublicKey(readPublicKey()),
        quoteMint: new PublicKey(readPublicKey()),
        lpMint: new PublicKey(readPublicKey()),
        openOrders: new PublicKey(readPublicKey()),
        marketId: new PublicKey(readPublicKey()),
        marketProgramId: new PublicKey(readPublicKey()),
        targetOrders: new PublicKey(readPublicKey()),
        withdrawQueue: new PublicKey(readPublicKey()),
        lpVault: new PublicKey(readPublicKey()),
        ammOwner: new PublicKey(readPublicKey()),

        lpAmount: readU64(),
        clientOrderId: readU64(),
        // Parsing padding (array of 2 u64s)
        padding: [readU64(), readU64()],
    };

    return ammInfo;
}
