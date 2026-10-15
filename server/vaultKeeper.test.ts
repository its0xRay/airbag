import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { VaultClient } from "../src/client/vaultProgram";
import { tickVaults } from "./vaultKeeper";

describe("vault keeper idle reads", () => {
  it("skips idle round rereads but checks eligible rounds against fresh state", async () => {
    const now = Math.floor(Date.now() / 1000);
    const address = PublicKey.default;
    const getRound = vi.fn(async () => null);
    const client = {
      rounds: async () => [
        { address, phase: "funding", fundingClose: now + 60, salesClose: now + 120 },
        { address, phase: "active", fundingClose: now - 60, salesClose: now + 120 },
        { address, phase: "active", fundingClose: now - 120, salesClose: now - 60, openContracts: 0n, reserved: 0n },
      ],
      positions: async () => [], requests: async () => [], getRound,
    } as unknown as VaultClient;
    expect(await tickVaults(client, Keypair.generate(), () => [])).toEqual([]);
    expect(getRound).toHaveBeenCalledTimes(1);
  });
  it("uses the supplied fresh snapshot without extra scans and skips blocked/empty rounds", async () => {
    const now = Math.floor(Date.now() / 1000), address = PublicKey.default;
    const client = { rounds: vi.fn(), positions: vi.fn(), requests: vi.fn(), getRound: vi.fn() } as unknown as VaultClient;
    const snapshot = { positions: [], requests: [], rounds: [
      { address, phase: "funding", fundingClose: now - 60, salesClose: now + 60, totalShares: 0n },
      { address, phase: "active", fundingClose: now - 120, salesClose: now - 60, openContracts: 1n, reserved: 1n },
    ] } as unknown as Parameters<typeof tickVaults>[3];
    expect(await tickVaults(client, Keypair.generate(), () => [], snapshot)).toEqual([]);
    expect(client.rounds).not.toHaveBeenCalled();
    expect(client.positions).not.toHaveBeenCalled();
    expect(client.requests).not.toHaveBeenCalled();
    expect(client.getRound).not.toHaveBeenCalled();
  });
});
