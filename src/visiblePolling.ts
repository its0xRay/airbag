/** Nonessential reads only. Transaction confirmation must never use this timer. */
export function visiblePolling(read: () => unknown, interval: number, immediate = true) {
  const tick = () => { if (document.visibilityState !== "hidden") read(); };
  const resume = () => tick();
  const first = immediate ? setTimeout(tick, 0) : undefined;
  const timer = setInterval(tick, interval);
  document.addEventListener("visibilitychange", resume);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
  };
}
