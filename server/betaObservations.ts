import type { Observation } from "../src/client/optketProgram";

/** Same ordered, bounded observation window as the existing vault keeper. */
export function betaObservationWindow(samples: Observation[], lo: number, hi: number): Observation[] {
  const ordered = samples.filter(o => o.sourceTs >= lo && o.sourceTs <= hi
    && o.collectedTs >= o.sourceTs && o.collectedTs - o.sourceTs <= 60)
    .sort((a, b) => a.sourceTs - b.sourceTs || Number(a.slot - b.slot));
  const out: Observation[] = [];
  let previous = -1n;
  for (const observation of ordered) {
    if (observation.slot <= previous) continue;
    out.push(observation);
    previous = observation.slot;
    if (out.length === 8) break;
  }
  return out;
}
