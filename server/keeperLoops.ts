/** Sampling must continue while a settlement waits for transaction confirmation.
 * Each loop has its own overlap guard; neither creates a retry backlog. */
export function startKeeperLoops(options: {
  sample: () => Promise<void>;
  settle: () => Promise<void>;
  onError: (loop: "sample" | "settle", error: unknown) => void;
  intervalMs: number;
}) {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new Error("Invalid keeper interval");
  let sampling = false, settling = false, stopped = false;
  const sample = async () => {
    if (sampling || stopped) return;
    sampling = true;
    try { await options.sample(); } catch (error) { options.onError("sample", error); }
    finally { sampling = false; }
  };
  const settle = async () => {
    if (settling || stopped) return;
    settling = true;
    try { await options.settle(); } catch (error) { options.onError("settle", error); }
    finally { settling = false; }
  };
  const sampleTimer = setInterval(() => void sample(), options.intervalMs);
  let settleTimer: ReturnType<typeof setInterval> | undefined;
  const started = (async () => {
    await sample();
    if (stopped) return;
    settleTimer = setInterval(() => void settle(), options.intervalMs);
    await settle();
  })();
  return { started, stop() { stopped = true; clearInterval(sampleTimer); clearInterval(settleTimer); } };
}
