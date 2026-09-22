import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadObservations, pruneObservations, saveObservations, type ObservationScope } from "./observationStore";

const scope: ObservationScope = { genesisHash: "test-genesis", program: "test-program",
  publisher: "test-publisher", versions: { 0: 2, 1: 1 } };
const sample = { slot: 42n, sourceTs: 1000, collectedTs: 1001, price: 1038000000n };
const directories: string[] = [];
function path() {
  const directory = mkdtempSync(join(tmpdir(), "optket-observations-test-"));
  directories.push(directory);
  return join(directory, "observations.json");
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true }); });

describe("keeper observation persistence", () => {
  it("restores exact timestamps and bigint values after restart", () => {
    const file = path();
    saveObservations(file, scope, { 0: [sample], 1: [] }, 1010);
    expect(loadObservations(file, scope, 1050)).toEqual({ 0: [sample], 1: [] });
  });
  it("does not freshen samples beyond retention", () => {
    const file = path();
    saveObservations(file, scope, { 0: [sample], 1: [] }, 1010);
    expect(loadObservations(file, scope, 1901)[0]).toEqual([]);
  });
  it("rejects another network, program, publisher or reference version", () => {
    const file = path();
    saveObservations(file, scope, { 0: [sample], 1: [] }, 1010);
    for (const different of [{ genesisHash: "other" }, { program: "other" },
      { publisher: "other" }, { versions: { 0: 1, 1: 1 } }]) {
      expect(() => loadObservations(file, { ...scope, ...different }, 1010)).toThrow("scope mismatch");
    }
  });
  it("drops future, stale-at-collection, invalid and out-of-range observations", () => {
    const invalid = [ { ...sample, collectedTs: 1100 }, { ...sample, collectedTs: 999 },
      { ...sample, collectedTs: 1061 }, { ...sample, price: 0n },
      { ...sample, slot: 1n << 64n }, { ...sample, sourceTs: NaN } ];
    expect(pruneObservations({ 0: invalid, 1: [sample] }, 1070)).toEqual({ 0: [], 1: [sample] });
  });
  it("starts empty for a missing file, but surfaces corruption", () => {
    const file = path();
    expect(loadObservations(file, scope, 1010)).toEqual({ 0: [], 1: [] });
    writeFileSync(file, "invalid-json");
    expect(() => loadObservations(file, scope, 1010)).toThrow();
  });
});
