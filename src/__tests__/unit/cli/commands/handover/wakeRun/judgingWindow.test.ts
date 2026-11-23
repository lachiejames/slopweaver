/**
 * `handover wake`'s judging pass is bounded: one checks read is cut at its limit, and no read
 * starts once the run's judging window closes — the park longest unread first, the rest UNKNOWN until a later tick
 * reads them ahead of every park this one read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import {
  boundedReadChecks,
  WAKE_CHECKS_READ_TIMEOUT_MS,
  WAKE_JUDGE_CONCURRENCY,
  WAKE_JUDGE_DEADLINE_MS,
} from "../../../../../../cli/commands/handover/wakeJudge.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import type { ChecksWakeObservation } from "../../../../../../handover/parkWake.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

/** A promise that never settles: a read, or a timer, that never answers. */
function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

describe("boundedReadChecks", () => {
  it("answers the read when it lands first", async () => {
    const read = boundedReadChecks({
      read: async () => ok<ChecksWakeObservation>({ mergeCommitOid: "m1", prState: "MERGED" }),
      timeoutMs: WAKE_CHECKS_READ_TIMEOUT_MS,
      timer: never,
    });
    expect(unwrap(await read({ number: 1, repo: "o/r" }))).toEqual({ mergeCommitOid: "m1", prState: "MERGED" });
  });

  it("answers a read failure naming the limit when the timer lands first", async () => {
    const asked: number[] = [];
    const read = boundedReadChecks({
      read: never,
      timeoutMs: WAKE_CHECKS_READ_TIMEOUT_MS,
      timer: async ({ ms }) => {
        asked.push(ms);
      },
    });
    const failure = unwrapErr(await read({ number: 1, repo: "o/r" }));
    expect([asked, failure.code, failure.message]).toEqual([
      [WAKE_CHECKS_READ_TIMEOUT_MS],
      "READ_FAILED",
      "the read did not answer inside 30s, so it was abandoned",
    ]);
  });
});

describe("handover wake's judging window", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  /** Eight checks parks, `z-park` first and `s-park` last, so slug order and park order disagree. */
  function eightParks(): void {
    const slugs = Array.from({ length: WAKE_JUDGE_CONCURRENCY + 2 }, (_, index) => `${"zyxwvuts"[index]!}-park`);
    slugs.forEach((slug, index) => {
      const minute = String(10 + index).padStart(2, "0");
      parkedRow({
        parkedAtIso: `2026-10-15T02:${minute}:00.000Z`,
        slug,
        wake: { kind: "checks", number: index + 1, repo: "o/r" },
      });
    });
  }

  /**
   * A run whose every read takes the whole window's share, so the window closes as the first round lands.
   *
   * @returns the run's report and the pull requests it read, in order
   */
  async function slowRun({ clock }: { clock: { ms: number } }): Promise<{
    readonly readAt: readonly number[];
    readonly report: Awaited<ReturnType<typeof wakeJson>>["report"];
  }> {
    const recorded = record();
    const readAt: number[] = [];
    const deps: HandoverWakeDeps = {
      ...fakes({ bootsInFlight: 3, recorded }),
      now: () => new Date(clock.ms),
      readChecks:
        () =>
        async ({ number }) => {
          readAt.push(number);
          clock.ms += WAKE_JUDGE_DEADLINE_MS / WAKE_JUDGE_CONCURRENCY;
          return ok<ChecksWakeObservation>({ prState: "CLOSED" });
        },
    };
    const { report } = await wakeJson({ deps, recorded });
    return { readAt, report };
  }

  it("reads parks never read before ahead of the ones the last tick read, so a shut-out park is not starved", async () => {
    eightParks();
    const clock = { ms: NOW.getTime() };
    const first = await slowRun({ clock });
    clock.ms += 5 * 60_000;
    const second = await slowRun({ clock });
    expect([first.readAt, second.readAt]).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 1, 2, 3, 4],
    ]);
  });

  it("reads the oldest parks first and starts no read once the window has closed", async () => {
    eightParks();
    const { readAt, report } = await slowRun({ clock: { ms: NOW.getTime() } });
    const kinds = Object.fromEntries(report.rows.map((row) => [row.slug, row.judgement.kind]));
    expect(readAt).toEqual([1, 2, 3, 4, 5, 6]);
    expect(kinds).toEqual({
      "s-park": "unknown",
      "t-park": "unknown",
      "u-park": "due",
      "v-park": "due",
      "w-park": "due",
      "x-park": "due",
      "y-park": "due",
      "z-park": "due",
    });
    expect(report.rows.find((row) => row.slug === "s-park")!.detail).toBe(
      "this run's 120s judging window closed before its checks were read; a later tick reads it before any park " +
        "this one read",
    );
  });
});
