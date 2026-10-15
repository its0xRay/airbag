/** Background publication only. Never used for user quotes, balances or
 * settlement. Restart/error triggers a fresh read; reconcile at least every
 * five minutes even when a fixed onchain deadline is much further away. */
export class PublicationSchedule {
  nextCheckAt = 0;
  private nextMonotonic = 0;
  constructor(private clock = () => ({ wall: Date.now(), monotonic: performance.now() })) {}
  due() { return this.clock().monotonic >= this.nextMonotonic; }
  clear() { this.nextMonotonic = 0; this.nextCheckAt = 0; }
  defer(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) { this.clear(); return; }
    const clock = this.clock(), delay = Math.min(seconds, 300) * 1000;
    this.nextMonotonic = clock.monotonic + delay;
    this.nextCheckAt = Math.ceil((clock.wall + delay) / 1000);
  }
}
