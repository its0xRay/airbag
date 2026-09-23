import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { validateSponsoredComputeBudget, validateSponsoredFee } from "./sponsorFeePolicy";

describe("sponsored fee boundaries", () => {
  it("rejects arbitrary priority fees before signing", () => {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000n }));
    expect(() => validateSponsoredComputeBudget(tx)).toThrow("custom compute budgets");
  });
  it("rejects custom unit limits and accepts the default budget", () => {
    expect(() => validateSponsoredComputeBudget(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })))).toThrow();
    expect(() => validateSponsoredComputeBudget(new Transaction())).not.toThrow();
  });
  it.each([null, 20001, -1, NaN, Infinity])("rejects unavailable or excessive actual fee %s", fee => {
    expect(() => validateSponsoredFee(fee)).toThrow();
  });
  it("accepts only fees covered by the reserved allowance", () => {
    expect(() => validateSponsoredFee(10000)).not.toThrow();
    expect(() => validateSponsoredFee(20000)).not.toThrow();
  });
});
