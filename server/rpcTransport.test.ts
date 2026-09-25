import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcTransport } from "./rpcTransport";

const options = (id: number, method = "getAccountInfo", params = ["account"]) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
afterEach(() => vi.useRealTimers());
describe("RPC request efficiency", () => {
  it("paces scans across relay and service without delaying confirmation", async () => {
    vi.useFakeTimers();
    const calls: Array<{ method: string; time: number }> = [];
    const upstream = vi.fn(async (_input, init) => {
      calls.push({ method: JSON.parse(init.body).method, time: Date.now() });
      return new Response(JSON.stringify({ result: [] }));
    });
    const a = createRpcTransport("service", upstream), b = createRpcTransport("relay", upstream);
    const jobs = [a.fetch("https://paced.test", options(1, "getProgramAccounts")), b.fetch("https://paced.test", options(2, "getProgramAccounts", ["other"]))];
    await b.fetch("https://paced.test", options(3, "getSignatureStatuses"));
    expect(calls.map(c => c.method)).toEqual(["getProgramAccounts", "getSignatureStatuses"]);
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.all(jobs);
    expect(calls[2].time - calls[0].time).toBeGreaterThanOrEqual(1100);
  });
  it("retries rate-limited reads at most twice and never retries a write", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(async () => new Response("limited", { status: 429, headers: { "retry-after": "1" } }));
    const rpc = createRpcTransport("retry", upstream);
    const read = rpc.fetch("https://retry.test", options(1));
    await vi.advanceTimersByTimeAsync(2500);
    expect((await read).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(3);
    await rpc.fetch("https://retry.test", options(2, "sendTransaction"));
    expect(upstream).toHaveBeenCalledTimes(4);
  });
  it("recovers a read after a short cooldown", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn().mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, result: 42 })));
    const rpc = createRpcTransport("recover", upstream);
    const read = rpc.fetch("https://recover.test", options(1));
    await vi.advanceTimersByTimeAsync(1100);
    expect(await (await read).json()).toHaveProperty("result", 42);
  });
  it("aborts a queued scan before contacting the provider", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(async () => new Response(JSON.stringify({ result: [] })));
    const rpc = createRpcTransport("abort", upstream);
    await rpc.fetch("https://abort.test", options(1, "getProgramAccounts"));
    const controller = new AbortController();
    const next = rpc.fetch("https://abort.test", { ...options(2, "getProgramAccounts"), signal: controller.signal });
    const check = expect(next).rejects.toThrow();
    controller.abort();
    await check;
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("shares concurrent identical reads, preserves IDs, never caches completed results", async () => {
    let release!: (value: Response) => void;
    const upstream = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const rpc = createRpcTransport("test", upstream);
    const first = rpc.fetch("https://rpc.test", options(1));
    const second = rpc.fetch("https://rpc.test", options(2));
    release(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 5 } })));
    expect(await (await first).json()).toHaveProperty("id", 1);
    expect(await (await second).json()).toHaveProperty("id", 2);
    expect(upstream).toHaveBeenCalledTimes(1);
    const third = rpc.fetch("https://rpc.test", options(3));
    release(new Response(JSON.stringify({ id: 3, result: { value: 6 } })));
    expect(await (await third).json()).toHaveProperty("result.value", 6);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(rpc.stats().methods.getAccountInfo.shared).toBe(1);
  });
  it("never merges writes, confirmation polls, or different account reads", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ result: null })));
    const rpc = createRpcTransport("test", upstream);
    await Promise.all([rpc.fetch("https://rpc.test", options(1,"sendTransaction")), rpc.fetch("https://rpc.test", options(2,"sendTransaction")), rpc.fetch("https://rpc.test", options(3,"getSignatureStatuses")), rpc.fetch("https://rpc.test", options(4,"getSignatureStatuses")), rpc.fetch("https://rpc.test", options(5)), rpc.fetch("https://rpc.test", options(6,"getAccountInfo",["other"]))]);
    expect(upstream).toHaveBeenCalledTimes(6);
  });
  it("backs off after 429 without reporting success or leaking endpoint details", async () => {
    const upstream = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "10" } }));
    const rpc = createRpcTransport("test", upstream);
    expect((await rpc.fetch("https://rpc.test/secret", options(1))).status).toBe(429);
    expect((await rpc.fetch("https://rpc.test/secret", options(2))).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rpc.stats())).not.toContain("secret");
    expect(rpc.stats().rateLimits).toBe(1);
  });
  it("clears failed reads so retries can recover", async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(new Response(JSON.stringify({ id: 2, result: 4 })));
    const rpc = createRpcTransport("test", upstream);
    await expect(rpc.fetch("https://rpc.test", options(1))).rejects.toThrow("network");
    expect(await (await rpc.fetch("https://rpc.test", options(2))).json()).toHaveProperty("result",4);
  });
});
