// "current / total" for a long step, reported at most once per interval: often enough that
// the user sees the import is alive, without flooding the stream. Reporting is cheap (one
// short SSE line) and does not change how the work itself is batched.
export function createProgressReporter(
  total: number,
  emit: (current: number, total: number) => void,
  intervalMs = 1000,
  now: () => number = Date.now
) {
  let current = 0;
  let lastAt = -Infinity;
  let lastCount = -1;

  const report = () => {
    lastAt = now();
    lastCount = current;
    emit(current, total);
  };

  return {
    // "0 / total" right away, so the total is visible from the start
    start: report,
    // one item finished
    tick() {
      current++;
      if (now() - lastAt >= intervalMs) report();
    },
    // the final count, unless it was just reported
    finish() {
      if (current !== lastCount) report();
    },
  };
}
