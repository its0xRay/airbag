import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useChain } from "./store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import { fetchJson } from "../serviceUrl";
vi.mock("../serviceUrl", () => ({ normalizeServiceUrl: () => "https://service.test", fetchJson: vi.fn() }));
const wallet = Keypair.generate();
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value) });
  useChain.setState({ busy: false, connected: false, burner: null, address: null, error: null, refresh: vi.fn(async () => {}) });
  vi.spyOn(useChain.getState().conn, "getGenesisHash").mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  vi.spyOn(useChain.getState().conn, "getAccountInfo").mockResolvedValue(null);
  vi.mocked(fetchJson).mockReset();
  vi.mocked(fetchJson).mockImplementation(async url => {
    if (String(url).endsWith("/config")) return { programId: OPTKET_PROGRAM_ID.toBase58(), demoMint: PublicKey.default.toBase58(), quoteAuthority: PublicKey.default.toBase58() };
    if (String(url).endsWith("/faucet")) return { tokenBalance: 20000 };
    return null;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function saveWallet() { storage.set("optket.burner.sk", JSON.stringify([...wallet.secretKey])); }
const faucetCalls = () => vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).endsWith("/faucet"));
describe("demo session restoration", () => {
  it("does not create a wallet or contact the faucet on a new visitor's page load", async () => {
    await useChain.getState().connect(true);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(useChain.getState().connected).toBe(false);
  });
  it("restores the existing wallet read-only even with a zero token balance", async () => {
    saveWallet();
    await useChain.getState().connect(true);
    expect(useChain.getState().address).toBe(wallet.publicKey.toBase58());
    expect(useChain.getState().connected).toBe(true);
    expect(faucetCalls()).toHaveLength(0);
  });
  it("claims tokens only on an explicit connection with zero balance", async () => {
    saveWallet();
    await useChain.getState().connect();
    expect(faucetCalls()).toHaveLength(1);
    expect(useChain.getState().tokenBalance).toBe(20000);
  });
  it("does not claim again when an existing account is funded", async () => {
    saveWallet();
    vi.mocked(useChain.getState().conn.getAccountInfo).mockResolvedValue({ data: new Uint8Array(), executable: false, lamports: 1, owner: PublicKey.default } as never);
    vi.spyOn(useChain.getState().conn, "getTokenAccountBalance").mockResolvedValue({ context: { slot: 1 }, value: { amount: "10000000", decimals: 6, uiAmount: 10, uiAmountString: "10" } });
    await useChain.getState().connect();
    expect(faucetCalls()).toHaveLength(0);
    expect(useChain.getState().tokenBalance).toBe(10);
  });
  it("does not interpret an RPC outage as an empty balance", async () => {
    saveWallet();
    vi.mocked(useChain.getState().conn.getAccountInfo).mockRejectedValue(new Error("offline"));
    await useChain.getState().connect();
    expect(faucetCalls()).toHaveLength(0);
    expect(useChain.getState().connected).toBe(false);
    expect(useChain.getState().error).toBeTruthy();
  });
  it("preserves malformed stored wallet data rather than silently replacing it", async () => {
    storage.set("optket.burner.sk", "broken-wallet-data");
    await useChain.getState().connect(true);
    expect(storage.get("optket.burner.sk")).toBe("broken-wallet-data");
    expect(useChain.getState().error).toContain("preserved");
    expect(faucetCalls()).toHaveLength(0);
  });
});
