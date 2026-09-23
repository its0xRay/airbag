/** Per-process RPC visibility and concurrent-read sharing. No completed-result cache. */
export function createRpcTransport(label: string, upstream: typeof fetch = fetch) {
  const pending = new Map<string, Promise<Response>>();
  const methods: Record<string, { sent: number; shared: number; errors: number; milliseconds: number }> = {};
  let cooldownUntil = 0;
  let rateLimits = 0;
  const startedAt = Date.now();
  const readMethods = new Set(["getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getBalance", "getTokenAccountBalance", "getGenesisHash"]);
  const transport: typeof fetch = async (input, init) => {
    let body: { method?: string; params?: unknown; id?: unknown } = {};
    try { body = JSON.parse(String(init?.body)); } catch { /* passthrough */ }
    const method = typeof body.method === "string" && /^[a-zA-Z]{1,64}$/.test(body.method) ? body.method : "other";
    const metric = methods[method] ??= { sent: 0, shared: 0, errors: 0, milliseconds: 0 };
    if (Date.now() < cooldownUntil) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32005, message: "RPC rate limited; retry after cooldown" } }), { status: 429, headers: { "retry-after": String(Math.ceil((cooldownUntil - Date.now()) / 1000)) } });
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
    metric.sent++;
    const operation = (async () => {
      try {
        const response = await upstream(input, init);
        let rpcError = false;
        try { rpcError = Boolean((await response.clone().json() as { error?: unknown }).error); } catch { rpcError = true; }
        if (!response.ok || rpcError) metric.errors++;
        if (response.status === 429) {
          rateLimits++;
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 2;
          cooldownUntil = Date.now() + Math.min(60, Math.max(1, Number.isFinite(seconds) ? seconds : 2)) * 1000;
        }
        return response;
      } catch (error) { metric.errors++; throw error; }
      finally { metric.milliseconds += Date.now() - begin; }
    })();
    if (key) pending.set(key, operation);
    try { return (await operation).clone(); }
    finally { if (key && pending.get(key) === operation) pending.delete(key); }
  };
  return { fetch: transport, stats: () => ({ component: label, startedAt, rateLimits, cooldownRemainingMs: Math.max(0, cooldownUntil - Date.now()), inFlightReads: pending.size, methods }) };
}
