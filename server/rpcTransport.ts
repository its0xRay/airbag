// Shared by the quote service and browser relay in this process. Never delays
// writes or confirmation methods. Other processes still respect upstream 429s.
const scanSlots = new Map<string, number>();
const pause = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
  signal?.addEventListener("abort", abort, { once: true });
});
/** Per-process RPC visibility and concurrent-read sharing. No completed-result cache. */
export function createRpcTransport(label: string, upstream: typeof fetch = fetch) {
  const pending = new Map<string, Promise<Response>>();
  const methods: Record<string, { sent: number; shared: number; errors: number; milliseconds: number }> = {};
  const cooldowns = new Map<string, number>();
  let rateLimits = 0;
  const startedAt = Date.now();
  const readMethods = new Set(["getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getBalance", "getTokenAccountBalance", "getGenesisHash"]);
  const transport: typeof fetch = async (input, init) => {
    let body: { method?: string; params?: unknown; id?: unknown } = {};
    try { body = JSON.parse(String(init?.body)); } catch { /* passthrough */ }
    const method = typeof body.method === "string" && /^[a-zA-Z]{1,64}$/.test(body.method) ? body.method : "other";
    const metric = methods[method] ??= { sent: 0, shared: 0, errors: 0, milliseconds: 0 };
    const limited = (until: number) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32005, message: "RPC rate limited; retry after cooldown" } }), { status: 429, headers: { "retry-after": String(Math.ceil((until - Date.now()) / 1000)) } });
    const key = readMethods.has(method) ? `${String(input)}:${method}:${JSON.stringify(body.params)}` : null;
    const existing = key ? pending.get(key) : undefined;
    if (existing) {
      metric.shared++;
      const response = (await existing).clone();
      const value = await response.json() as Record<string, unknown>;
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify({ ...value, id: body.id }), { status: response.status, headers });
    }
    const begin = Date.now();
    const operation = (async () => {
      try {
        for (let attempt = 0; ; attempt++) {
        const cooldown = cooldowns.get(method) ?? 0;
        if (cooldown > Date.now()) {
          if (!readMethods.has(method) || cooldown - Date.now() > 4000) return limited(cooldown);
          await pause(cooldown - Date.now(), init?.signal);
        }
        if (method === "getProgramAccounts") {
          const endpoint = String(input);
          const slot = Math.max(Date.now(), scanSlots.get(endpoint) ?? 0);
          // Bound queueing even if the provider or a visitor is slow.
          if (slot - Date.now() > 6000) return limited(Date.now() + 2000);
          scanSlots.set(endpoint, slot + 1100);
          if (slot > Date.now()) await pause(slot - Date.now(), init?.signal);
        }
        init?.signal?.throwIfAborted();
        metric.sent++;
        const response = await upstream(input, init);
        let rpcError = false;
        try { rpcError = Boolean((await response.clone().json() as { error?: unknown }).error); } catch { rpcError = true; }
        if (!response.ok || rpcError) metric.errors++;
        if (response.status === 429) {
          rateLimits++;
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 2;
          const delay = Math.min(60, Math.max(1, Number.isFinite(seconds) ? seconds : 2)) * 1000;
          cooldowns.set(method, Date.now() + delay);
          if (readMethods.has(method) && attempt < 2 && delay <= 4000) continue;
        }
        return response;
        }
      } catch (error) { metric.errors++; throw error; }
      finally { metric.milliseconds += Date.now() - begin; }
    })();
    if (key) pending.set(key, operation);
    try { return (await operation).clone(); }
    finally { if (key && pending.get(key) === operation) pending.delete(key); }
  };
  return { fetch: transport, stats: () => ({ component: label, startedAt, rateLimits, cooldownRemainingMs: Math.max(0, ...[...cooldowns.values()].map(until => until - Date.now())), inFlightReads: pending.size, methods }) };
}
