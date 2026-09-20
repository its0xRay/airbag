import { useEffect, useState } from "react";

const PAGE_LOAD_SECONDS = Math.floor(Date.now() / 1000);

/** A stable render-time clock that updates outside React's render phase. */
export function useNowSeconds(intervalMs = 15_000): number {
  const [now, setNow] = useState(PAGE_LOAD_SECONDS);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
