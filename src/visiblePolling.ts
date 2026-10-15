/** Nonessential reads only. Transaction confirmation must never use this timer. */
export function visiblePolling(read: () => unknown, interval: number, immediate = true) {
  let pending = false, stopped = false;
  const tick = () => {
    if (stopped || pending || document.visibilityState === "hidden") return;
    pending = true;
    try {
      const result = read();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch(() => {}).finally(() => { pending = false; });
      } else pending = false;
    } catch { pending = false; }
  };
  const resume = () => tick();
  const first = immediate ? setTimeout(tick, 0) : undefined;
  const timer = setInterval(tick, interval);
  document.addEventListener("visibilitychange", resume);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
  };
}
