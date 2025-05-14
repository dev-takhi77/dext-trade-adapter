import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PoolReserves } from "../types";

export abstract class IDexReadAdapter {
  abstract getPoolKeys(poolAddress: string): any;
  abstract getPoolReserves(): Promise<PoolReserves>;
  abstract getPrice(reserve: PoolReserves): Promise<number>;
  abstract getSwapQuote(inputAmount: number, inputMint: string, reserve: PoolReserves): number | Promise<number> | { amountOut: number, remainingAccount: PublicKey[] };
  abstract getSwapInstruction(amountIn: number, minAmountOut: number, swapAccountkey: any): TransactionInstruction;
}
