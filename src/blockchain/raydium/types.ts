export interface SwapConfig {
  fromTokenAddress: 'sol' | string
  toTokenAddress: 'sol' | string
  fromTokenAmount: number
  maxLamports?: number
  direction?: 'in' | 'out'
  txVersion?: 0 | 1
  slippagePercent?: number
}

export interface PoolReserves {
  token0: string;
  token1: string;
  reserveToken0: number;
  reserveToken1: number;
}
