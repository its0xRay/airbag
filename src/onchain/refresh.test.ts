import { afterEach, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useChain } from "./store";
import { loadVaultPortfolio } from "../client/vaultPortfolio";
vi.mock("../serviceUrl", () => ({ normalizeServiceUrl: () => "https://service.test", fetchJson: vi.fn(async (url: string) => url.includes("/series/all") ? [] : null) }));
vi.mock("../client/vaultPortfolio", () => ({ loadVaultPortfolio: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("keeps vault positions and deposits on read failure, marks stale data, and clears the warning after recovery", async () => {
  vi.stubEnv("VITE_VAULTS_ENABLED", "true");
  const state = useChain.getState();
  const previous = { address: PublicKey.default.toBase58(), vaultRound: "round", assetId: 0 } as never;
  const deposit = { round: { address: PublicKey.default } } as never;
  useChain.setState({ burner: Keypair.generate(), demoMint: PublicKey.default, connected: true, refreshing: false,
    contracts: [previous], vaultDeposits: [deposit], requests: [], history: [], programHistory: [], requestTransactions: {}, error: null });
  vi.spyOn(state.client, "getPool").mockResolvedValue(null as never);
  vi.spyOn(state.client, "getContractsForBuyer").mockResolvedValue([]);
  vi.spyOn(state.client, "getRequestsForContracts").mockResolvedValue([]);
  vi.spyOn(state.conn, "getBalance").mockResolvedValue(0);
  vi.spyOn(state.conn, "getTokenAccountBalance").mockResolvedValue({ context: { slot: 1 }, value: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" } });
  vi.mocked(loadVaultPortfolio).mockRejectedValueOnce(new Error("RPC read unavailable"));
  await state.refresh({ history: false });
  expect(useChain.getState().contracts).toEqual([previous]);
  expect(useChain.getState().vaultDeposits).toEqual([deposit]);
  expect(useChain.getState().refreshWarning).toContain("Previously loaded data");
  expect(useChain.getState().error).toBeNull();
  expect(useChain.getState().connected).toBe(true);
  vi.mocked(loadVaultPortfolio).mockResolvedValueOnce({ contracts: [], requests: [], vaultDeposits: [] });
  await state.refresh({ history: false });
  expect(useChain.getState().refreshWarning).toBeNull();
  expect(useChain.getState().contracts).toEqual([]);
});
