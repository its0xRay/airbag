import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Observation } from "../src/client/optketProgram";

export type ObservationBuffer = Record<number, Observation[]>;
export interface ObservationScope {
  genesisHash: string;
  program: string;
  publisher: string;
  versions: Record<number, number>;
}
const RETENTION = 900;
const MAX_SAMPLES = 1800;
const U64_MAX = (1n << 64n) - 1n;

function valid(o: Observation, now: number): boolean {
  return Number.isSafeInteger(o.sourceTs) && Number.isSafeInteger(o.collectedTs)
    && o.sourceTs > 0 && o.sourceTs <= o.collectedTs && o.collectedTs <= now
    && now - o.sourceTs <= RETENTION && o.collectedTs - o.sourceTs <= 60
    && o.slot > 0n && o.slot <= U64_MAX && o.price > 0n && o.price <= U64_MAX;
}

/** No timestamp rewriting: recovered observations keep their original window. */
export function pruneObservations(buffer: ObservationBuffer, now: number): ObservationBuffer {
  return Object.fromEntries([0, 1].map(asset => [asset,
    (buffer[asset] ?? []).filter(o => valid(o, now)).slice(-MAX_SAMPLES),
  ]));
}

export function saveObservations(path: string, scope: ObservationScope, buffer: ObservationBuffer, now: number) {
  const data = JSON.stringify({ schema: 1, scope, samples: pruneObservations(buffer, now) },
    (_key, value) => typeof value === "bigint" ? value.toString() : value);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600, flush: true });
  renameSync(temporary, path);
}

export function loadObservations(path: string, scope: ObservationScope, now: number): ObservationBuffer {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { 0: [], 1: [] };
    throw error;
  }
  const data = JSON.parse(raw);
  if (data.schema !== 1 || data.scope?.genesisHash !== scope.genesisHash
    || data.scope?.program !== scope.program || data.scope?.publisher !== scope.publisher
    || [0, 1].some(asset => data.scope?.versions?.[asset] !== scope.versions[asset])) {
    throw new Error("Observation snapshot scope mismatch");
  }
  const samples: ObservationBuffer = { 0: [], 1: [] };
  for (const asset of [0, 1]) {
    if (!Array.isArray(data.samples?.[asset]) || data.samples[asset].length > MAX_SAMPLES) {
      throw new Error("Invalid observation snapshot");
    }
    for (const row of data.samples[asset]) {
      if (!row || typeof row.slot !== "string" || typeof row.price !== "string"
        || !/^\d{1,20}$/.test(row.slot) || !/^\d{1,20}$/.test(row.price)) continue;
      const observation = { slot: BigInt(row.slot), price: BigInt(row.price),
        sourceTs: row.sourceTs, collectedTs: row.collectedTs };
      if (valid(observation, now)) samples[asset].push(observation);
    }
  }
  return samples;
}
