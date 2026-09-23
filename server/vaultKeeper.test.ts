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
        { address, phase: "active", fundingClose: now - 120, salesClose: now - 60 },
      ],
      positions: async () => [], requests: async () => [], getRound,
    } as unknown as VaultClient;
    expect(await tickVaults(client, Keypair.generate(), () => [])).toEqual([]);
    expect(getRound).toHaveBeenCalledTimes(1);
  });
});
