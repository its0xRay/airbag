import { afterEach, expect, it, vi } from "vitest";
import { createRpcQueue } from "./rpcQueue";
afterEach(() => vi.useRealTimers());
it("prioritizes confirmation reads with pacing and prevents ordinary-read starvation", async () => {
  vi.useFakeTimers();
  const queue = createRpcQueue(), order: string[] = [];
  const submit = (priority: boolean, name: string) => queue.run(priority, async () => { order.push(name); });
  const jobs = [submit(false, "history"), ...[1, 2, 3, 4].map(n => submit(true, `confirm${n}`))];
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(["confirm1"]);
  await vi.advanceTimersByTimeAsync(400);
  await Promise.all(jobs);
  expect(order).toEqual(["confirm1", "confirm2", "confirm3", "history", "confirm4"]);
  expect(queue.size()).toBe(0);
});
it("reserves capacity for transactions and bounds in-flight work", async () => {
  vi.useFakeTimers();
  const queue = createRpcQueue();
  const releases: (() => void)[] = [];
  const read = () => new Promise<void>(resolve => releases.push(resolve));
  for (let i = 0; i < 32; i++) expect(queue.run(false, read)).not.toBeNull();
  expect(queue.run(false, read)).toBeNull();
  for (let i = 0; i < 8; i++) expect(queue.run(true, read)).not.toBeNull();
  expect(queue.run(true, read)).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(releases).toHaveLength(8);
  expect(queue.size()).toBe(40);
  while (queue.size()) {
    releases.splice(0).forEach(release => release());
    await vi.advanceTimersByTimeAsync(1000);
  }
});
