import { ComputeBudgetProgram, type Transaction } from "@solana/web3.js";

export const SPONSOR_FEE_ALLOWANCE = 20_000;

export function validateSponsoredComputeBudget(tx: Transaction) {
  if (tx.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId))) {
    throw new Error("sponsorship refused: custom compute budgets are not sponsored");
  }
}

export function validateSponsoredFee(fee: number | null) {
  if (fee == null || !Number.isSafeInteger(fee) || fee < 0 || fee > SPONSOR_FEE_ALLOWANCE) {
    throw new Error("sponsorship refused: transaction fee unavailable or above the sponsorship cap");
  }
}
