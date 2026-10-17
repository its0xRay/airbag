import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import type { KeeperSnapshot } from "./keeperSnapshot";
import { samplingAssets } from "./keeperActivity";

const address = Keypair.generate().publicKey;
function snapshot(): KeeperSnapshot {
  return { contracts: [], requests: [], vaults: { rounds: [], positions: [], requests: [] }, accountCount: 0, dataBytes: 0 };
}
describe("keeper idle sampling policy", () => {
  it("samples both on startup and failed discovery", () => {
    expect(samplingAssets(null)).toEqual([0, 1]);
  });
  it("does not sample empty vaults, but keeps their lifecycle discovery independent", () => {
    const s = snapshot();
    s.vaults.rounds = [{ address, assetId: 0 }] as KeeperSnapshot["vaults"]["rounds"];
    expect(samplingAssets(s)).toEqual([]);
    expect(s.vaults.rounds).toHaveLength(1);
  });
  it.each([0, 1])("activates asset %i on purchase and idles after full settlement", assetId => {
    const s = snapshot();
    s.vaults.rounds = [{ address, assetId }] as KeeperSnapshot["vaults"]["rounds"];
    s.vaults.positions = [{ round: address, remainingQuantity: 1n }] as KeeperSnapshot["vaults"]["positions"];
    expect(samplingAssets(s)).toEqual([assetId]);
    s.vaults.positions = [];
    expect(samplingAssets(s)).toEqual([]);
  });
  it("preserves sampling for legacy and partially settled contracts", () => {
    const s = snapshot();
    s.contracts = [{ assetId: 0 }, { assetId: 1 }] as KeeperSnapshot["contracts"];
    expect(samplingAssets(s)).toEqual([0, 1]);
  });
  it("never idles pending requests or positions whose round cannot be resolved", () => {
    const s = snapshot();
    s.requests = [{}] as KeeperSnapshot["requests"];
    expect(samplingAssets(s)).toEqual([0, 1]);
    s.requests = [];
    s.vaults.requests = [{}] as KeeperSnapshot["vaults"]["requests"];
    expect(samplingAssets(s)).toEqual([0, 1]);
    s.vaults.requests = [];
    s.vaults.positions = [{ round: address }] as KeeperSnapshot["vaults"]["positions"];
    expect(samplingAssets(s)).toEqual([0, 1]);
  });
});
