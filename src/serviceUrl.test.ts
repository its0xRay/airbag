import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, normalizeServiceUrl } from "./serviceUrl";

afterEach(() => vi.unstubAllGlobals());

describe("quote-service URL handling", () => {
  it("adds https to a bare hosted service name", () => {
    expect(normalizeServiceUrl("web-production-44d1a.up.railway.app"))
      .toBe("https://web-production-44d1a.up.railway.app");
  });

  it("keeps localhost on http and removes a trailing slash", () => {
    expect(normalizeServiceUrl("localhost:8787/"))
      .toBe("http://localhost:8787");
  });

  it("rejects an HTML response before JSON parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })));
    await expect(fetchJson("https://example.test/config")).rejects.toThrow(/text\/html/);
  });
});

it("shares concurrent plain GETs, never completed results or POSTs", async () => {
  let resolve!: (r: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
  vi.stubGlobal("fetch", fetcher);
  const a = fetchJson("https://test/terms"), b = fetchJson("https://test/terms");
  expect(a).toBe(b);
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(Response.json({ ok: true }));
  await Promise.all([a, b]);
  fetcher.mockImplementation(async () => Response.json({ ok: true }));
  await fetchJson("https://test/terms");
  await Promise.all([fetchJson("https://test/quote", { method: "POST" }), fetchJson("https://test/quote", { method: "POST" })]);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("does not retain rejected reads or merge requests with caller options", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchJson("https://test/retry")).rejects.toThrow("offline");
  await fetchJson("https://test/retry");
  await Promise.all([fetchJson("https://test/retry", { signal: new AbortController().signal }), fetchJson("https://test/retry", { headers: { Authorization: "test" } })]);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
