import { describe, expect, it } from "vitest";
import { createProgressReporter } from "../progress";

describe("createProgressReporter", () => {
  it("reports the total at the start, then at most once per interval, then the final count", () => {
    let t = 0;
    const seen: string[] = [];
    const p = createProgressReporter(5, (c, total) => seen.push(`${c}/${total}`), 1000, () => t);

    p.start(); // 0/5
    t = 200; p.tick(); // 1 — too soon
    t = 900; p.tick(); // 2 — too soon
    t = 1000; p.tick(); // 3 — a second after the start
    t = 1500; p.tick(); // 4 — too soon
    t = 1600; p.tick(); // 5 — too soon
    p.finish(); // 5/5

    expect(seen).toEqual(["0/5", "3/5", "5/5"]);
  });

  it("does not repeat the final count when it was just reported", () => {
    let t = 0;
    const seen: number[] = [];
    const p = createProgressReporter(1, (c) => seen.push(c), 1000, () => t);
    p.start();
    t = 5000; p.tick(); // 1, reported
    p.finish();
    expect(seen).toEqual([0, 1]);
  });
});
