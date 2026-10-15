import { afterEach, describe, expect, it, vi } from "vitest";
import { startKeeperLoops } from "./keeperLoops";

afterEach(() => vi.useRealTimers());
describe("independent keeper scheduling", () => {
  it("continues real sampling during slow settlement, without overlapping settlements", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const sample = vi.fn(async () => {}), settle = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const loops = startKeeperLoops({ sample, settle, intervalMs: 5000, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(20000);
    expect(sample).toHaveBeenCalledTimes(5);
    expect(settle).toHaveBeenCalledTimes(1);
    finish(); await loops.started;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sample).toHaveBeenCalledTimes(6);
    expect(settle).toHaveBeenCalledTimes(2);
    finish(); loops.stop();
  });
  it("does not overlap samples and resumes after either loop fails", async () => {
    vi.useFakeTimers();
    const onError = vi.fn(), sample = vi.fn().mockRejectedValueOnce(new Error("reference"))
      .mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 8000)));
    const settle = vi.fn().mockRejectedValueOnce(new Error("rpc")).mockResolvedValue(undefined);
    const loops = startKeeperLoops({ sample, settle, onError, intervalMs: 5000 });
    await loops.started;
    expect(onError).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(sample).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sample).toHaveBeenCalledTimes(3);
    loops.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(sample).toHaveBeenCalledTimes(3);
  });
});
