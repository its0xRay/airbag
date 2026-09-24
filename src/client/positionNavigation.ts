import type { ContractAcct } from "./optketProgram";
import type { OwnedVaultDeposit } from "./vaultPortfolio";
export type PositionKind = "floors" | "vaults";
export function preferredPositionKind(contracts: ContractAcct[], deposits: OwnedVaultDeposit[]): PositionKind {
  if (deposits.some(d => !d.deposit.redeemed && d.round.phase === "redeemable")) return "vaults";
  if (contracts.some(c => c.status === "Active" || c.status === "PartiallySettled")) return "floors";
  if (deposits.some(d => !d.deposit.redeemed)) return "vaults";
  return contracts.length || !deposits.length ? "floors" : "vaults";
}
