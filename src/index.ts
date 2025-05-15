import { getPoolReserves, getSwapInstruction, getSwapQuote } from './blockchain/raydium'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import * as pumpSwap from './instructions/pumpSwap'
import { getBuyAmountOut, getPool, getSellAmountOut } from './dex/pumpSwap'

import { sendVtx } from './services/trade.service'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { prepareWsolSwapInstructions } from './helpers/solana.helpers'
import { AmmInfo, parseAmmInfo, RAYDIUM_V4_DEVNET_PROGRAM } from './blockchain/raydium/amm/src'
import { computeSwapAmount, getPoolInfoFromRpc, makeSwapCpmmBaseInInstruction } from './blockchain/raydium/cpmm'
import { BN } from 'bn.js'
import { curveSwap } from './blockchain/raydium/cpmm/curve/calcualtor'
import { getPdaObservationId, WSOLMint } from '@raydium-io/raydium-sdk-v2'

const PERCENT_BPS = 10_000n

export interface IDEXAdapter {
  // send tx and return signature

  buy(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }>

  buyWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId?: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }>

  // send tx and return signature
  sell(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }>

  sellWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }>

  // send tx and return signature
  swap(
    fromToken: string,
    toToken: string,
    amount: number,
    slippage: number,
    by: 'sell' | 'buy'
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }>

  // only instruction for sell without create ATA if posible for specific platfor pumpSwap, raydium, orca and other
  sellIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction

  // only instruction for buy without create ATA if posible for specific platfor pumpSwap, raydium, orca and other
  buyIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction

  // need for calc amount
  getQuote(
    fromToken: string,
    toToken: string,
    amount: number,
    by: 'sell' | 'buy'
  ): Promise<bigint>
}

export class RaydiumCpmmAdapter implements IDEXAdapter {
  async buyWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId: PublicKey,
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    const data = await getPoolInfoFromRpc(connection, poolId.toBase58())
    const poolInfo = data.poolInfo;
    const poolKeys = data.poolKeys;
    const rpcData = data.rpcData;

    const { minAmountOut: computedMinAmountOut } = await computeSwapAmount({ pool: rpcData, amountIn: new BN(amountIn.toString()), outputMint, slippage })

    const feeAmount =
      (BigInt(computedMinAmountOut.toString()) * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    const minAmountOut = BigInt(computedMinAmountOut.toString()) - feeAmount;

    const tx = new Transaction();

    const { bypassAssociatedCheck, checkCreateATAOwner, associatedOnly } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false, associatedOnly: true },
      // custom
      ...poolKeys.config,
    };

    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];

    const baseIn = inputMint.toBase58() === poolInfo.mintA.address;

    const swapResult = await curveSwap(
      new BN(amountIn.toString()),
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo?.tradeFeeRate!
    )

    const mintAUseSOLBalance = poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = poolInfo.mintB.address === WSOLMint.toBase58();
    const mintAdata = await getOrCreateTokenAccount({
      mint: mintA,
      tokenProgram: new PublicKey(poolInfo.mintA.programId ?? TOKEN_PROGRAM_ID),
      owner: wallet.publicKey,
      createInfo:
        mintAUseSOLBalance || !baseIn
          ? {
            payer: wallet.publicKey,
            amount: baseIn ? Number(swapResult.sourceAmountSwapped) : 0,
          }
          : undefined,
      notUseTokenAccount: mintAUseSOLBalance,
      skipCloseAccount: !mintAUseSOLBalance,
      associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
      checkCreateATAOwner,
    });
    tx.add(...mintAdata.instructionParams);

    const mintBdata = await getOrCreateTokenAccount({
      mint: mintB,
      tokenProgram: new PublicKey(poolInfo.mintB.programId ?? TOKEN_PROGRAM_ID),
      owner: wallet.publicKey,
      createInfo:
        mintBUseSOLBalance || baseIn
          ? {
            payer: wallet.publicKey,
            amount: baseIn ? 0 : Number(swapResult.sourceAmountSwapped),
          }
          : undefined,
      notUseTokenAccount: mintBUseSOLBalance,
      skipCloseAccount: !mintBUseSOLBalance,
      associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
      checkCreateATAOwner,
    });
    tx.add(...mintBdata.instructionParams)

    const ix = await makeSwapCpmmBaseInInstruction(
      rpcData.programId,
      wallet.publicKey,
      new PublicKey(poolKeys.authority),
      new PublicKey(poolKeys.config.id),
      poolId,
      mintAdata.account,
      mintBdata.account,
      new PublicKey(poolKeys.vault.A),
      new PublicKey(poolKeys.vault.B),
      new PublicKey(poolInfo.mintA.programId),
      new PublicKey(poolInfo.mintB.programId),
      mintA,
      mintB,
      getPdaObservationId(new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)).publicKey,
      new BN(amountIn.toString()),
      new BN(minAmountOut.toString())
    )

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);
    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }
  async sellWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId: PublicKey,
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), outputMint.toBase58(), reserve, slippage)

    const feeAmount =
      (BigInt(minQuoteAmount) * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    const minAmountOut = BigInt(minQuoteAmount) - feeAmount;

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), Number(minAmountOut), {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(outputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(inputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);
    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  async buy(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), inputMint.toBase58(), reserve, slippage)

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), minQuoteAmount, {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(inputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  async sell(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), outputMint.toBase58(), reserve, slippage)

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), minQuoteAmount, {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(outputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(inputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  buyIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')
  }
  sellIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')
  }
  async getQuote(
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<bigint> {
    throw new Error('Method not implemented.')
  }

  async swap(
    fromToken: string,
    toToken: string,
    amount: number,
    slippage: number
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    // Генерация и отправка транзакции на Raydium
    throw new Error('Method not implemented.')
  }

  async getPoolInfo(): Promise<any> {
    // Возврат информации о пулах
    return { pool: 'RAY-USDC' }
  }
}

export class RaydiumAmmAdapter implements IDEXAdapter {
  async buyWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId: PublicKey,
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), inputMint.toBase58(), reserve, slippage)

    const feeAmount =
      (BigInt(minQuoteAmount) * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    const minAmountOut = BigInt(minQuoteAmount) - feeAmount;

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), Number(minAmountOut), {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(inputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);
    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }
  async sellWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[],
    poolId: PublicKey,
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), outputMint.toBase58(), reserve, slippage)

    const feeAmount =
      (BigInt(minQuoteAmount) * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    const minAmountOut = BigInt(minQuoteAmount) - feeAmount;

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), Number(minAmountOut), {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(outputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(inputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);
    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  async buy(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), inputMint.toBase58(), reserve, slippage)

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), minQuoteAmount, {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(inputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  async sell(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    poolId: PublicKey
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const connection = getSolanaConnection();

    let poolInfo: AmmInfo | null = null;
    const data = await connection.getAccountInfo(poolId);
    if (data) {
      poolInfo = parseAmmInfo(data.data);
    }

    if (!poolInfo?.baseVault || !poolInfo?.quoteVault || !poolInfo.baseMint || !poolInfo.quoteMint) {
      return {
        signature: undefined,
        error: {
          type: 1,
          msg: 'Invalid pool information',
        },
      };
    }

    const reserve = await getPoolReserves(connection, poolInfo);

    const minQuoteAmount = await getSwapQuote(Number(amountIn), outputMint.toBase58(), reserve, slippage)

    const tx = new Transaction();

    const ix = await getSwapInstruction(poolInfo, Number(amountIn), minQuoteAmount, {
      amm: new PublicKey(poolId),
      ammCoinVault: poolInfo.baseVault,
      ammPcVault: poolInfo.quoteVault,
      ammProgram: RAYDIUM_V4_DEVNET_PROGRAM,
      inputMint: new PublicKey(outputMint),
      userSourceOwner: wallet.publicKey
    }, "mainnet")

    const ata = getAssociatedTokenAddressSync(inputMint, wallet.publicKey);

    try {
      await getAccount(connection, ata)
    } catch (error) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(ix);

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  buyIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')
  }
  sellIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')
  }
  async getQuote(
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<bigint> {
    throw new Error('Method not implemented.')
  }

  async swap(
    fromToken: string,
    toToken: string,
    amount: number,
    slippage: number
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    // Генерация и отправка транзакции на Raydium
    throw new Error('Method not implemented.')
  }

  async getPoolInfo(): Promise<any> {
    // Возврат информации о пулах
    return { pool: 'RAY-USDC' }
  }
}

export class PumpSwapAdapter implements IDEXAdapter {
  async sellWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[]
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const pool = await getPool(inputMint, outputMint)

    const prepareWsol = await prepareWsolSwapInstructions(wallet.publicKey, 0n)

    if (amountOut === 0n) {
      amountOut = await getSellAmountOut(inputMint, amountIn, slippage)
    }

    const feeAmount =
      (amountOut * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    let minAmountOut = amountOut - feeAmount

    console.log('sell', {
      input: amountIn,
      minAmountOut,
      mint: inputMint,
      slippage,
    })

    const swapIx = pumpSwap.sellIx({
      poolKeys: {
        poolId: pool.id,
        baseMint: inputMint,
        qouteMint: outputMint,
        poolBaseAta: pool.baseAta,
        poolQouteAta: pool.quoteAta,
        coinCreatorVaultAuthority: pool.coinCreatorVaultAuthority,
      },
      userKeys: {
        payer: wallet,
      },
      amountIn: amountIn,
      minAmountOut: minAmountOut,
    })

    const tx = new Transaction()
      .add(...prepareWsol.instructionParams.instructions)
      .add(swapIx)

    if (prepareWsol.instructionParams.endInstructions.length > 0) {
      tx.add(...prepareWsol.instructionParams.endInstructions)
    }

    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }
  async buyWithFees(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number,
    serviceFee: {
      wallet: PublicKey
      percent: number
    },
    referralsFee: {
      wallet: PublicKey
      percent: number
    }[]
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const pool = await getPool(inputMint, outputMint)

    const feeAmount =
      (amountIn * BigInt(Math.floor(serviceFee.percent * 100))) / PERCENT_BPS +
      890880n * BigInt(referralsFee.length) // 1e6 * 1.5 * 100 / 10000

    amountIn -= feeAmount

    const prepareWsol = await prepareWsolSwapInstructions(
      wallet.publicKey,
      amountIn
    )

    if (amountOut == 0n) {
      amountOut = await getBuyAmountOut(outputMint, amountIn, slippage)
    }

    console.log('buy', {
      input: amountIn,
      amountOut,
      mint: outputMint,
      slippage,
    })

    const swapIx = pumpSwap.buyIx({
      poolKeys: {
        poolId: pool.id,
        baseMint: outputMint,
        qouteMint: inputMint,
        poolBaseAta: pool.baseAta,
        poolQouteAta: pool.quoteAta,
        coinCreatorVaultAuthority: pool.coinCreatorVaultAuthority,
      },
      userKeys: {
        payer: wallet,
      },
      maxAmountIn: amountIn,
      amountOut,
    })

    const tx = new Transaction().add(
      ...prepareWsol.instructionParams.instructions
    )

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey)

    try {
      const connection = getSolanaConnection()
      await getAccount(connection, ata)
    } catch (e) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(swapIx)

    if (prepareWsol.instructionParams.endInstructions.length > 0) {
      tx.add(...prepareWsol.instructionParams.endInstructions)
    }

    addFeeToTx(tx, wallet.publicKey, feeAmount, serviceFee, referralsFee)

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }
  buyIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')
  }
  sellIx(
    wallet: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint
  ): TransactionInstruction {
    throw new Error('Method not implemented.')

    // const tx = ammSell(wallet, inputMint, outputMint, amountIn, amountOut)

    // return tx.instructions[0]
  }
  async sell(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const pool = await getPool(inputMint, outputMint)

    const prepareWsol = await prepareWsolSwapInstructions(wallet.publicKey, 0n)

    const swapIx = pumpSwap.sellIx({
      poolKeys: {
        poolId: pool.id,
        baseMint: inputMint,
        qouteMint: outputMint,
        poolBaseAta: pool.baseAta,
        poolQouteAta: pool.quoteAta,
        coinCreatorVaultAuthority: (await pool).coinCreatorVaultAuthority,
      },
      userKeys: {
        payer: wallet,
      },
      amountIn: amountIn,
      minAmountOut: amountOut,
    })

    const tx = new Transaction()
      .add(...prepareWsol.instructionParams.instructions)
      .add(swapIx)

    if (prepareWsol.instructionParams.endInstructions.length > 0) {
      tx.add(...prepareWsol.instructionParams.endInstructions)
    }

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result

    // throw new Error('Method not implemented.')
  }

  async buy(
    wallet: Keypair,
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: bigint,
    amountOut: bigint,
    slippage: number
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    const pool = await getPool(inputMint, outputMint)

    const prepareWsol = await prepareWsolSwapInstructions(
      wallet.publicKey,
      amountIn
    )

    if (amountOut == 0n) {
      amountOut = await getBuyAmountOut(outputMint, amountIn, slippage)
    }

    const swapIx = pumpSwap.buyIx({
      poolKeys: {
        poolId: pool.id,
        baseMint: outputMint,
        qouteMint: inputMint,
        poolBaseAta: pool.baseAta,
        poolQouteAta: pool.quoteAta,
        coinCreatorVaultAuthority: pool.coinCreatorVaultAuthority,
      },
      userKeys: {
        payer: wallet,
      },
      maxAmountIn: amountIn,
      amountOut,
    })

    const tx = new Transaction().add(
      ...prepareWsol.instructionParams.instructions
    )

    const ata = getAssociatedTokenAddressSync(outputMint, wallet.publicKey)

    try {
      const connection = getSolanaConnection()

      await getAccount(connection, ata)
    } catch (e) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          wallet.publicKey,
          outputMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    tx.add(swapIx)

    if (prepareWsol.instructionParams.endInstructions.length > 0) {
      tx.add(...prepareWsol.instructionParams.endInstructions)
    }

    const result = await sendVtx(wallet, tx, [wallet], true)

    return result
  }

  async swap(
    fromToken: string,
    toToken: string,
    amount: number,
    slippage: number
  ): Promise<{
    signature?: string
    error?: {
      type: number
      msg: string
    }
  }> {
    throw new Error('Method not implemented.')
  }

  async getQuote(
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<bigint> {
    // Подключение к Raydium API или on-chain quote
    throw new Error('Method not implemented.')
  }
}

export class DEXFactory {
  static create(dex: 'raydiumAmm' | 'raydiumCpmm' | 'orca' | 'pumpswap'): IDEXAdapter {
    switch (dex) {
      case 'pumpswap':
        return new PumpSwapAdapter()
      case 'raydiumAmm': {
        return new RaydiumAmmAdapter()
      }
      case 'raydiumCpmm': {
        return new RaydiumCpmmAdapter()
      }
      // case 'orca':
      //   return new OrcaAdapter()
      default:
        throw new Error(`Unsupported DEX: ${dex}`)
    }
  }

  // static
}

export interface ISwapStrategy {
  executeSwap(
    adapter: IDEXAdapter,
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<string> // returns txHash
}

export class MarketSwapStrategy implements ISwapStrategy {
  constructor(private slippage: number = 0.5) { }

  async executeSwap(
    adapter: IDEXAdapter,
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<string> {
    return '' // adapter.swap(fromToken, toToken, amount, this.slippage)
  }
}

export class LimitSwapStrategy implements ISwapStrategy {
  constructor(private targetPrice: number) { }

  async executeSwap(
    adapter: IDEXAdapter,
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<string> {
    // const quote = await adapter.getQuote(fromToken, toToken, amount)

    // if (quote >= this.targetPrice) {
    //   return adapter.swap(fromToken, toToken, amount, 0.5)
    // } else {
    //   throw new Error(
    //     `Current quote (${quote}) < target price (${this.targetPrice})`
    //   )
    // }

    return ''
  }
}

export class RetailStrategy implements ISwapStrategy {
  constructor(private targetPrice: number) { }

  async executeSwap(
    adapter: IDEXAdapter,
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<string> {
    // const quote = await adapter.getQuote(fromToken, toToken, amount)

    // if (quote >= this.targetPrice) {
    //   return adapter.swap(fromToken, toToken, amount, 0.5)
    // } else {
    //   throw new Error(
    //     `Current quote (${quote}) < target price (${this.targetPrice})`
    //   )
    // }

    return ''
  }
}

export let getSolanaConnectionImpl: () => Connection = () => {
  throw new Error('getSolanaConnection not initialized')
}

export function getSolanaConnection(): Connection {
  return getSolanaConnectionImpl()
}

export function init(f: () => Connection) {
  getSolanaConnectionImpl = f
}

function addFeeToTx(
  tx: Transaction,
  from: PublicKey,
  feeAmount: bigint,
  service: {
    wallet: PublicKey
    percent: number
  },
  referrals: {
    wallet: PublicKey
    percent: number
  }[]
) {
  console.log('referral', referrals)

  if (feeAmount > 0n) {
    let amount = feeAmount

    for (const referral of referrals) {
      amount =
        (amount * BigInt(Math.floor(referral.percent * 100))) / PERCENT_BPS

      feeAmount -= amount

      if (amount > 0n) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: from,
            toPubkey: referral.wallet,
            lamports: amount + 890880n,
          })
        )
      }
    }

    if (feeAmount > 0n) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: service.wallet,
          lamports: feeAmount,
        })
      )
    }
  }
}

export async function getOrCreateTokenAccount({
  mint,
  tokenProgram,
  owner,
  createInfo,
  notUseTokenAccount,
  skipCloseAccount,
  associatedOnly,
  checkCreateATAOwner,
}: {
  mint: PublicKey;
  tokenProgram: PublicKey;
  owner: PublicKey;
  createInfo?: { payer: PublicKey; amount: number };
  notUseTokenAccount?: boolean;
  skipCloseAccount?: boolean;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}): Promise<{
  account: PublicKey;
  instructionParams: TransactionInstruction[];
}> {
  const ata = getAssociatedTokenAddressSync(mint, owner);

  try {
    await getAccount(getSolanaConnection(), ata);
    return { account: ata, instructionParams: [] };
  } catch (error) {
    const instructions: TransactionInstruction[] = [];
    instructions.push(
      createAssociatedTokenAccountInstruction(
        createInfo?.payer || owner,
        ata,
        owner,
        mint,
        tokenProgram
      )
    );
    return { account: ata, instructionParams: instructions };
  }
}