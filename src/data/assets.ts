// Verified real asset registry (PRD §4 activation gate).
//
// These identities were verified against Solana mainnet and the Jupiter Price
// API on 2026-09-18: real Token-2022 mints, decimals, the scaledUiAmountConfig
// multiplier that must be applied to raw balances (§4.1), and live price
// coverage. Only assets that pass this gate are shown with LIVE references; the
// live multiplier and prices are refreshed at runtime from mainnet/Jupiter.

export interface VerifiedAsset {
  key: string;
  symbol: string;
  logo: string;
  name: string;
  kind: "EquityToken" | "PreStocks";
  /** Real on-chain mint (mainnet). */
  mint: string;
  program: "Token-2022";
  decimals: number;
  /** scaledUiAmountConfig multiplier snapshot; refreshed live from the mint. */
  scaledMultiplier: number;
  /** What the protected reference tracks (§5). */
  benchmarkLabel: string;
  underlying: string;
  /** Verified live Jupiter price coverage. */
  jupiter: boolean;
  verifiedAt: string;
}

export const VERIFIED_ASSETS: VerifiedAsset[] = [
  {
    key: "nvdax",
    symbol: "NVDAx",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
    name: "NVIDIA xStock",
    kind: "EquityToken",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    program: "Token-2022",
    decimals: 8,
    scaledMultiplier: 1.0009180758490996,
    benchmarkLabel: "NVDAx token market · 5-minute median",
    underlying: "NVIDIA Corp (NASDAQ: NVDA)",
    jupiter: true,
    verifiedAt: "2026-09-18",
  },
  {
    key: "anthropic",
    symbol: "ANTHROPIC",
    logo: "https://www.prestocks.com/logos/anthropic.png?cachebust=1",
    name: "Anthropic PreStocks",
    kind: "PreStocks",
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    program: "Token-2022",
    decimals: 9,
    scaledMultiplier: 1.0,
    benchmarkLabel: "ANTHROPIC token market price (Jupiter 5-minute median)",
    underlying: "Anthropic PBC (private)",
    jupiter: true,
    verifiedAt: "2026-09-18",
  },
];

export const assetByKey = (key: string) => VERIFIED_ASSETS.find((a) => a.key === key);
