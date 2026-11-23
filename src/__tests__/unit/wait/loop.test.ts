/**
 * The one wait contract over a fake clock: the first read is immediate, an unchanged unsettled reading prints
 * once, and the deadline is judged before sleeping — never a real timer.
 */
import { describe, expect, it } from "vitest";

import {
  nextWaitDelayMs,
  PROVIDER_WAIT_CEILING_MS,
  PROVIDER_WAIT_SCHEDULE_MS,
  type WaitClock,
  waitUntilSettled,
} from "../../../wait/loop.js";

/** A clock that advances only when the loop sleeps, recording every sleep. */
function fakeClock(): { clock: WaitClock; slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    clock: {
      nowMs: () => now,
      sleep: ({ ms }) => {
        slept.push(ms);
        now += ms;
        return Promise.resolve();
      },
    },
    slept,
  };
}

/** A read that returns each reading in turn, then repeats the last. */
function sequence({ readings }: { readings: readonly string[] }): () => Promise<string> {
  let index = 0;
  return () => {
    const reading = readings[Math.min(index, readings.length - 1)]!;
    index += 1;
    return Promise.resolve(reading);
  };
}

describe("nextWaitDelayMs", () => {
  it("steps through the schedule, then holds at the ceiling", () => {
    const delays = [0, 1, 2, 3, 4, 9].map((attempt) =>
      nextWaitDelayMs({ attempt, ceilingMs: PROVIDER_WAIT_CEILING_MS, schedule: PROVIDER_WAIT_SCHEDULE_MS }),
    );
    expect(delays).toEqual([10_000, 20_000, 30_000, 45_000, 60_000, 60_000]);
  });
});

describe("waitUntilSettled", () => {
  it("returns on the first read when it is already settled, without printing or sleeping", async () => {
    const { clock, slept } = fakeClock();
    const emitted: string[] = [];
    const outcome = await waitUntilSettled({
      ceilingMs: 5,
      clock,
      emit: (line) => emitted.push(line),
      lines: (reading) => [reading],
      read: sequence({ readings: ["done"] }),
      schedule: [1],
      settled: (reading) => reading === "done",
      timeoutSeconds: 60,
    });
    expect(outcome).toEqual({ kind: "settled", reading: "done", reads: 1 });
    expect(emitted).toEqual([]);
    expect(slept).toEqual([]);
  });

  it("prints an unsettled state only when it changes, and sleeps on the schedule", async () => {
    const { clock, slept } = fakeClock();
    const emitted: string[] = [];
    const outcome = await waitUntilSettled({
      ceilingMs: 40,
      clock,
      emit: (line) => emitted.push(line),
      lines: (reading) => [`state ${reading}`],
      read: sequence({ readings: ["a", "a", "b", "b", "done"] }),
      schedule: [10, 20, 30],
      settled: (reading) => reading === "done",
      timeoutSeconds: 60,
    });
    expect(outcome).toEqual({ kind: "settled", reading: "done", reads: 5 });
    expect(emitted).toEqual(["state a", "state b"]);
    expect(slept).toEqual([10, 20, 30, 40]);
  });

  it("times out before a sleep that would pass the deadline, carrying the last reading", async () => {
    const { clock, slept } = fakeClock();
    const outcome = await waitUntilSettled({
      ceilingMs: 1_000,
      clock,
      emit: () => undefined,
      lines: (reading) => [reading],
      read: sequence({ readings: ["working"] }),
      schedule: [1_000],
      settled: () => false,
      timeoutSeconds: 3,
    });
    expect(outcome).toEqual({ kind: "timed-out", reading: "working", reads: 4 });
    expect(slept).toEqual([1_000, 1_000, 1_000]);
  });
});
