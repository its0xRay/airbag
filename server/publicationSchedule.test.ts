import { describe, expect, it } from "vitest";
import { PublicationSchedule } from "./publicationSchedule";

describe("background-only deadline scheduling", () => {
  it("checks on restart, at the deadline or within five minutes, whichever is first", () => {
    let wall = 1_000_000, monotonic = 100;
    const schedule = new PublicationSchedule(() => ({ wall, monotonic }));
    expect(schedule.due()).toBe(true);
    schedule.defer(86400);
    expect(schedule.nextCheckAt).toBe(1300);
    expect(schedule.due()).toBe(false);
    wall += 86400_000; // wall-clock jumps do not break the bounded interval
    monotonic += 299_000;
    expect(schedule.due()).toBe(false);
    monotonic += 1000;
    expect(schedule.due()).toBe(true);
    schedule.defer(10);
    monotonic += 10_000;
    expect(schedule.due()).toBe(true);
    schedule.defer(300); schedule.clear();
    expect(schedule.due()).toBe(true);
    expect(new PublicationSchedule().due()).toBe(true);
  });
});
