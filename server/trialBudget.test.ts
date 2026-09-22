import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TrialBudget, type TrialConfig } from "./trialBudget";
vi.mock("./keys", () => ({ loadKey: () => Keypair.generate() }));
const cfg: TrialConfig = { capSol: 1, perGrantSol: 1, perWalletMaxSol: 1, cooldownMs: 0, rateWindowMs: 60000, rateMax: 10 };
const connection = { getBalance: async () => 2e9 } as unknown as Connection;
let directory: string;
let path: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "optket-budget-test-")); path = join(directory, "state.json"); });
afterEach(() => rmSync(directory, { recursive: true }));
const budget = (config = cfg) => new TrialBudget(connection, config, "unused-test-key", path);
describe("durable sponsorship limits", () => {
  it("retains total and per-wallet spend across restarts", async () => {
    expect(budget().authorizeSponsorship("wallet", 600000000).ok).toBe(true);
    const restored = budget();
    expect((await restored.status()).spentSol).toBe(0.6);
    expect(restored.authorizeSponsorship("wallet", 500000000).ok).toBe(false);
  });
  it("allows an explicit cap increase without resetting historical spend", async () => {
    budget().authorizeSponsorship("wallet", 1e9);
    expect((await budget().status()).active).toBe(false);
    const raised = budget({ ...cfg, capSol: 2 });
    expect((await raised.status()).spentSol).toBe(1);
    expect(raised.authorizeSponsorship("other-wallet", 100000000).ok).toBe(true);
    expect(raised.authorizeSponsorship("wallet", 100000000).ok).toBe(false);
  });
  it("does not let an oversized request disable smaller affordable requests", () => {
    const b = budget();
    b.authorizeSponsorship("wallet", 600000000);
    expect(b.authorizeSponsorship("other-wallet", 500000000).ok).toBe(false);
    expect(b.authorizeSponsorship("other-wallet", 100000000).ok).toBe(true);
  });
  it("fails closed for invalid persisted spending and invalid configured caps", () => {
    writeFileSync(path, JSON.stringify({ spentLamports: -1 }));
    expect(() => budget()).toThrow("Invalid persisted");
    expect(() => budget({ ...cfg, capSol: NaN })).toThrow("Invalid trial");
  });
});
