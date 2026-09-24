/** Ten starts/second, bounded concurrency, and eight reserved transaction slots. */
export function createRpcQueue() {
  const urgent: (() => void)[] = [], normal: (() => void)[] = [];
  let running = 0, nextStart = 0, streak = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    if (timer || running >= 8 || !urgent.length && !normal.length) return;
    timer = setTimeout(() => {
      timer = undefined;
      const queue = urgent.length && (streak < 3 || !normal.length) ? urgent : normal;
      streak = queue === urgent ? streak + 1 : 0;
      running++;
      nextStart = Date.now() + 100;
      queue.shift()!();
      pump();
    }, Math.max(0, nextStart - Date.now()));
  };
  return {
    size: () => running + urgent.length + normal.length,
    run<T>(priority: boolean, operation: () => Promise<T>): Promise<T> | null {
      const size = running + urgent.length + normal.length;
      if (size >= (priority ? 40 : 32)) return null;
      return new Promise<T>((resolve, reject) => {
        (priority ? urgent : normal).push(() => {
          void Promise.resolve().then(operation).then(resolve, reject).finally(() => { running--; pump(); });
        });
        pump();
      });
    },
  };
}
