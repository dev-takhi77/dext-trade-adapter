import { PublicKey } from "@solana/web3.js";

const RAYDIUM_V4_MAINNET_PROGRAM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8")
const RAYDIUM_V4_DEVNET_PROGRAM = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8")

//* Raydium AMM Config *//

const RAY_V4_SEED = "amm_associated_seed";
const RAY_V4_TARGET_ORDER = "target_associated_seed";
const RAY_V4_AUTH_SEED = "amm authority";
const RAY_V4_OPENBOOK_ORDER_SEED = "open_order_associated_seed";
const RAY_V4_LP_MINT_SEED = "lp_mint_associated_seed";
const RAY_V4_COIN_VAULT_SEED = "coin_vault_associated_seed";
const RAY_V4_PC_VAULT_SEED = "pc_vault_associated_seed";

export {
    RAYDIUM_V4_MAINNET_PROGRAM,
    RAYDIUM_V4_DEVNET_PROGRAM,
    RAY_V4_SEED,
    RAY_V4_TARGET_ORDER,
    RAY_V4_AUTH_SEED,
    RAY_V4_OPENBOOK_ORDER_SEED,
    RAY_V4_LP_MINT_SEED,
    RAY_V4_COIN_VAULT_SEED,
    RAY_V4_PC_VAULT_SEED
}