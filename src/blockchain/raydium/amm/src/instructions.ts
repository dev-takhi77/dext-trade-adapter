import {
  PublicKey,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";

export function createRayV4SwapBaseInInstruction({
  programId,
  tokenProgram,
  amm,
  ammAuthority,
  ammOpenOrders,
  ammTargetOrders,
  poolCoinTokenAccount,
  poolPcTokenAccount,
  serumProgram,
  serumMarket,
  serumBids,
  serumAsks,
  serumEventQueue,
  serumCoinVaultAccount,
  serumPcVaultAccount,
  serumVaultSigner,
  userSourceTokenAccount,
  userDestinationTokenAccount,
  userSourceOwner,
  amountIn,
  minimumAmountOut,
}: {
  programId: PublicKey;
  tokenProgram: PublicKey;
  amm: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  ammTargetOrders: PublicKey;
  poolCoinTokenAccount: PublicKey;
  poolPcTokenAccount: PublicKey;
  serumProgram: PublicKey;
  serumMarket: PublicKey;
  serumBids: PublicKey;
  serumAsks: PublicKey;
  serumEventQueue: PublicKey;
  serumCoinVaultAccount: PublicKey;
  serumPcVaultAccount: PublicKey;
  serumVaultSigner: PublicKey;
  userSourceTokenAccount: PublicKey;
  userDestinationTokenAccount: PublicKey;
  userSourceOwner: PublicKey;
  amountIn: number | bigint;
  minimumAmountOut: number | bigint;
}): TransactionInstruction {
  const discriminator = Buffer.from([9]); // Raydium v4 swap_base_in discriminator
  const amountInBuf = Buffer.alloc(8);
  const minimumAmountOutBuf = Buffer.alloc(8);
  amountInBuf.writeBigUInt64LE(BigInt(amountIn));
  minimumAmountOutBuf.writeBigUInt64LE(BigInt(minimumAmountOut));

  const data = Buffer.concat([discriminator, amountInBuf, minimumAmountOutBuf]);

  const keys: AccountMeta[] = [
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: amm, isSigner: false, isWritable: true },
    { pubkey: ammAuthority, isSigner: false, isWritable: false },
    { pubkey: ammOpenOrders, isSigner: false, isWritable: true },
    { pubkey: ammTargetOrders, isSigner: false, isWritable: true },
    { pubkey: poolCoinTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolPcTokenAccount, isSigner: false, isWritable: true },
    { pubkey: serumProgram, isSigner: false, isWritable: false },
    { pubkey: serumMarket, isSigner: false, isWritable: true },
    { pubkey: serumBids, isSigner: false, isWritable: true },
    { pubkey: serumAsks, isSigner: false, isWritable: true },
    { pubkey: serumEventQueue, isSigner: false, isWritable: true },
    { pubkey: serumCoinVaultAccount, isSigner: false, isWritable: true },
    { pubkey: serumPcVaultAccount, isSigner: false, isWritable: true },
    { pubkey: serumVaultSigner, isSigner: false, isWritable: false },
    { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userSourceOwner, isSigner: true, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data,
  });
}
