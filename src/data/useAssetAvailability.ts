import { useEffect, useState } from "react";
import { fetchJson } from "../serviceUrl";
import { useNowSeconds } from "../useNowSeconds";

export interface AssetAvailability {
  assetId: number; checkedAt: number; canQuote: boolean; reason: string | null;
  exposureLimit: string; outstandingExposure: string; availableExposure: string; depositsPaused: boolean;
}
export function validAvailability(data: AssetAvailability, assetId: number) {
  return data?.assetId === assetId && Number.isFinite(data.checkedAt) && typeof data.canQuote === "boolean" && typeof data.depositsPaused === "boolean"
    && (data.reason === null || typeof data.reason === "string")
    && [data.availableExposure, data.exposureLimit, data.outstandingExposure].every(v => typeof v === "string" && /^\d+$/.test(v));
}
export function useAssetAvailability(assetId: number, serviceUrl: string) {
  const now = useNowSeconds(1000);
  const [result, setResult] = useState<{ scope: string; data: AssetAvailability } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const scope = `${serviceUrl}:${assetId}`;
  useEffect(() => {
    let alive = true, busy = false;
    async function read() {
      if (busy) return;
      busy = true;
      try {
        const data = await fetchJson<AssetAvailability>(`${serviceUrl}/availability?assetId=${assetId}`);
        if (!validAvailability(data, assetId)) throw new Error("Invalid availability");
        if (alive) { setResult({ scope, data }); setFailed(null); }
      } catch { if (alive) setFailed(scope); }
      finally { busy = false; }
    }
    void read();
    const timer = setInterval(read, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [assetId, serviceUrl, scope, retry]);
  const data = result?.scope === scope && failed !== scope && now - result.data.checkedAt <= 30 && result.data.checkedAt <= now + 5 ? result.data : null;
  return { data, label: data ? data.reason : failed === scope ? "Availability unavailable" : "Checking availability…", refresh: () => setRetry(n => n + 1) };
}
