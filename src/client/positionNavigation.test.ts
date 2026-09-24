import { expect, it } from "vitest";
import { preferredPositionKind } from "./positionNavigation";
import type { ContractAcct } from "./optketProgram";
import type { OwnedVaultDeposit } from "./vaultPortfolio";
const floor = (status: string) => ({ status } as ContractAcct);
const deposit = (phase: string, redeemed = false) => ({ round: { phase }, deposit: { redeemed } } as OwnedVaultDeposit);
it("leads with withdrawals needing action over a buyer empty state", () => {
  expect(preferredPositionKind([], [deposit("redeemable")])).toBe("vaults");
  expect(preferredPositionKind([floor("Active")], [deposit("redeemable")])).toBe("vaults");
});
it("otherwise prioritizes active holdings, then existing history", () => {
  expect(preferredPositionKind([floor("Active")], [deposit("funding")])).toBe("floors");
  expect(preferredPositionKind([floor("Expired")], [deposit("active")])).toBe("vaults");
  expect(preferredPositionKind([], [deposit("redeemable", true)])).toBe("vaults");
  expect(preferredPositionKind([floor("Expired")], [])).toBe("floors");
  expect(preferredPositionKind([], [])).toBe("floors");
});
