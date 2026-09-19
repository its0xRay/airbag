import { afterEach, describe, expect, it, vi } from "vitest";
import { JupiterPreStocksAdapter, PythEquityAdapter } from "./references";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("reference integrity", () => {
  it("does not settle equity against a restamped last print while the market is closed", async () => {
    const fetchMock = vi.fn(async () => json([{
      id: "feed",
      market_hours: { is_open: false, next_open: 2_000_000_000 },
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const observation = await new PythEquityAdapter(0, "NVDA", "feed").observe();
    expect(observation.available).toBe(false);
    expect(observation.reason).toMatch(/session closed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves Jupiter's real block id and source timestamp for the equity fallback", async () => {
    const updatedAt = "2026-09-19T18:41:49.000Z";
    const responses = [
      json([{ id: "feed", market_hours: { is_open: true } }]),
      json({ error: "auth required" }, 401),
      json({ mint: { blockId: 448492126, stockData: { price: 222.53, updatedAt } } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));

    const observation = await new PythEquityAdapter(0, "NVDA", "feed", "https://hermes.test", "mint", "https://jup.test").observe();
    expect(observation.available).toBe(true);
    expect(observation.slot).toBe(448492126n);
    expect(observation.sourceTs).toBe(Math.floor(new Date(updatedAt).getTime() / 1000));
  });

  it("never invents increasing Jupiter slots when the upstream block id is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      mint: { usdPrice: 1016.5, blockId: 448492126 },
    })));

    const observations = await new JupiterPreStocksAdapter(1, "mint", "https://jup.test", 0).observe(3);
    expect(observations).toHaveLength(1);
    expect(observations[0].slot).toBe(448492126n);
  });
});
