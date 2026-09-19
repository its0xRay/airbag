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
