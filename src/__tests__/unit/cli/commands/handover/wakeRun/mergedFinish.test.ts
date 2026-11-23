/**
 * `handover wake` settling a MERGED pull request's park without a reseat: the real `handover finish` is asked
 * first, its exit 0 believed only off the journal, any other ending falls through to the reseat, and a run asks
 * at most `WAKE_FINISH_ASKS` times.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { finishCwd, hatchFreeEnv, WAKE_FINISH_ASKS } from "../../../../../../cli/commands/handover/wakeFinish.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { appendRunEvent } from "../../../../../../handover/runStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { AFTER, record } from "./fixtures.js";
import { childExit, fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

/** The reason a merged checks wake is judged due on, read off the report so the case names no provider wording. */
function reasonOf({ judgement }: { judgement: { readonly kind: string } & Partial<{ reason: string }> }): string {
  return judgement.reason!;
}

describe("runHandoverWake on a merged pull request's park", () => {
  let runsDir: string;

  beforeEach(() => {
    ({ runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("settles the run with handover finish and spends no reseat", async () => {
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    const [row] = report.rows;
    expect([code, recorded.finished, recorded.spawned]).toEqual([EXIT_OK, ["landed"], []]);
    expect(recorded.mergeChecks).toEqual(["/repo/acme@merge-7"]);
    expect([report.finished, report.attempted, report.spawned]).toEqual([1, 0, 0]);
    expect([row!.action, row!.detail]).toEqual([
      "finished",
      `settled without a reseat: ${reasonOf(row!)}, and handover finish closed the run`,
    ]);
    expect(stillParked({ slug: "landed" })).toBe(false);
  });

  it("asks handover finish --dry-run on a dry run, and writes nothing", async () => {
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const { code, report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    const [row] = report.rows;
    expect([code, recorded.finished, recorded.spawned, report.finished]).toEqual([
      EXIT_OK,
      ["landed --dry-run"],
      [],
      1,
    ]);
    expect([row!.action, row!.detail]).toEqual([
      "would-finish",
      `would settle without a reseat: ${reasonOf(row!)}, and handover finish --dry-run passed`,
    ]);
    expect(stillParked({ slug: "landed" })).toBe(true);
  });

  it("carries a warning a passing dry-run finish printed", async () => {
    parkedRow({ slug: "warned", wake: { kind: "checks", number: 16, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 16: { prState: "MERGED" } }, recorded }),
      finish: async () => childExit({ code: 0, stderr: "warning:\n  probe skipped\n" }),
    };
    const { report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect(report.rows[0]!.detail).toBe(
      `would settle without a reseat: ${reasonOf(report.rows[0]!)}, and handover finish --dry-run passed ` +
        "(warning: probe skipped)",
    );
  });

  it("reseats a merged park whose finish failed silently, saying it printed nothing", async () => {
    parkedRow({ slug: "unfinished", wake: { kind: "checks", number: 8, repo: "o/r" } });
    const recorded = record();
    const deps = fakes({ checks: { 8: { prState: "MERGED" } }, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    const [row] = report.rows;
    expect([code, recorded.finished, recorded.spawned, report.finished]).toEqual([
      EXIT_OK,
      ["unfinished"],
      ["unfinished"],
      0,
    ]);
    expect([row!.action, row!.detail]).toEqual([
      "spawned",
      `${reasonOf(row!)}, but handover finish ended exit 1 (it printed nothing on stderr), so it did not close ` +
        "the run; reseated by cmux spawn unfinished (was parked at 2026-10-15T02:00:00.000Z)",
    ]);
  });

  it("names the refusal finish printed, on one line, in the row it reseats", async () => {
    parkedRow({ slug: "asked", wake: { kind: "checks", number: 13, repo: "o/r" } });
    const recorded = record();
    const refusal =
      "handover finish: asked is waiting on an answer, so it is not finished:\n" +
      "  question: Keep the backup to their words?\n" +
      '  answer it: slopweaver handover answer asked --answer "<answer>"\n';
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 13: { prState: "MERGED" } }, recorded }),
      finish: async () => childExit({ code: 1, stderr: refusal }),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect(report.rows[0]!.detail).toBe(
      `${reasonOf(report.rows[0]!)}, but handover finish ended exit 1 (handover finish: asked is waiting on an ` +
        "answer, so it is not finished: question: Keep the backup to their words? answer it: slopweaver handover " +
        'answer asked --answer "<answer>"), so it did not close the run; ' +
        "reseated by cmux spawn asked (was parked at 2026-10-15T02:00:00.000Z)",
    );
  });

  it("names a cut when finish printed more than the row keeps", async () => {
    parkedRow({ slug: "noisy", wake: { kind: "checks", number: 14, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 14: { prState: "MERGED" } }, recorded }),
      finish: async () => childExit({ code: 1, stderr: "Error: boom\n    at a", stderrBytes: 90_000 }),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect(report.rows[0]!.detail).toBe(
      `${reasonOf(report.rows[0]!)}, but handover finish ended exit 1 (Error: boom at a … [cut: the first 20 of ` +
        "90000 stderr bytes kept]), so it did not close the run; " +
        "reseated by cmux spawn noisy (was parked at 2026-10-15T02:00:00.000Z)",
    );
  });

  // Collapsing a whitespace-only stderr to nothing read as a child that printed nothing.
  it("says finish printed only whitespace rather than dropping it", async () => {
    parkedRow({ slug: "blank", wake: { kind: "checks", number: 15, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 15: { prState: "MERGED" } }, recorded }),
      finish: async () => childExit({ code: 1, stderr: "\n\t" }),
    };
    const { report } = await wakeJson({ deps, recorded });
    expect(report.rows[0]!.detail).toBe(
      `${reasonOf(report.rows[0]!)}, but handover finish ended exit 1 ([2 stderr byte(s), all whitespace]), so it ` +
        "did not close the run; reseated by cmux spawn blank (was parked at 2026-10-15T02:00:00.000Z)",
    );
  });

  // An exit 0 the journal does not bear out is not a finish, and never holds the park forever.
  it("reseats a park still standing after an exit 0 the journal does not bear out, saying so", async () => {
    parkedRow({ slug: "claimed", wake: { kind: "checks", number: 9, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 9: { prState: "MERGED" } }, recorded }),
      finish: async () => childExit({ code: 0, stderr: "warning: probe skipped\n" }),
    };
    const { code, report } = await wakeJson({ deps, recorded });
    const [row] = report.rows;
    expect([code, recorded.spawned, report.finished, row!.action]).toEqual([EXIT_OK, ["claimed"], 0, "spawned"]);
    expect(row!.detail).toBe(
      `${reasonOf(row!)}; handover finish exited 0 but no \`finished\` line cleared the park; still parked` +
        " (warning: probe skipped); " +
        "reseated by cmux spawn claimed (was parked at 2026-10-15T02:00:00.000Z)",
    );
  });

  it("never reseats a park an exit 0 cleared by some other line, since its run moved", async () => {
    parkedRow({ slug: "moved", wake: { kind: "checks", number: 12, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ checks: { 12: { prState: "MERGED" } }, recorded }),
      finish: async () => {
        const event = { atIso: AFTER, kind: "abandoned", why: "gone" } as const;
        unwrap(appendRunEvent({ event, runsDir, slug: "moved" }));
        return childExit({ code: 0 });
      },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, recorded.spawned, report.rows[0]!.action]).toEqual([EXIT_EXPECTED_EMPTY, [], "none"]);
  });

  // The repark guard holds a finish exactly as it holds a reseat.
  it("never asks finish about a park re-parked on the merge its last reseat already acted on", async () => {
    const wake = { kind: "checks", number: 11, repo: "o/r" } as const;
    parkedRow({ slug: "reparked", wake });
    const first = record();
    await wakeJson({ deps: fakes({ checks: { 11: { prState: "MERGED" } }, recorded: first }), recorded: first });
    expect([first.finished, first.spawned]).toEqual([["reparked"], ["reparked"]]);
    const seat = { atIso: "2026-10-15T03:15:00.000Z", sessionId: "s2-reparked", worktree: "/wt/reparked" };
    unwrap(appendRunEvent({ event: { ...seat, kind: "launched", pid: 9 }, runsDir, slug: "reparked" }));
    const park = { branch: "reparked", kind: "parked", screenTail: "❯ ", wake, workspaceRef: "workspace:9" } as const;
    unwrap(appendRunEvent({ event: { ...seat, ...park }, runsDir, slug: "reparked" }));

    const second = record();
    const deps = fakes({ checks: { 11: { prState: "MERGED" } }, finishes: { reparked: 0 }, recorded: second });
    const { code, report } = await wakeJson({ deps, recorded: second });
    expect([code, second.finished, second.spawned, report.rows[0]!.judgement.kind]).toEqual([
      EXIT_EXPECTED_EMPTY,
      [],
      [],
      "not-due",
    ]);
    expect(stillParked({ slug: "reparked" })).toBe(true);
  });

  it("never asks finish about an open pull request's park", async () => {
    parkedRow({ slug: "open", wake: { kind: "checks", number: 10, repo: "o/r" } });
    const recorded = record();
    const deps = fakes({ checks: { 10: { prState: "CLOSED" } }, finishes: { open: 0 }, recorded });
    await wakeJson({ deps, recorded });
    expect(recorded.finished).toEqual([]);
  });

  it(`asks finish at most ${String(WAKE_FINISH_ASKS)} times a run, longest due first, and reseats the rest`, async () => {
    const slugs = Array.from({ length: WAKE_FINISH_ASKS + 1 }, (_, index) => `m${String(index)}`);
    const checks: Record<number, { prState: "MERGED" }> = {};
    const finishes: Record<string, number> = {};
    slugs.forEach((slug, index) => {
      const minute = String(10 + index).padStart(2, "0");
      const number = index + 1;
      parkedRow({
        parkedAtIso: `2026-10-15T02:${minute}:00.000Z`,
        slug,
        wake: { kind: "checks", number, repo: "o/r" },
      });
      checks[number] = { prState: "MERGED" };
      finishes[slug] = 0;
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ checks, finishes, recorded }), recorded });
    expect([code, report.finished, recorded.finished, recorded.spawned]).toEqual([
      EXIT_OK,
      WAKE_FINISH_ASKS,
      slugs.slice(0, WAKE_FINISH_ASKS),
      [slugs.at(-1)],
    ]);
  });
});

describe("hatchFreeEnv", () => {
  it("drops every override variable and keeps the rest", () => {
    const env = {
      PATH: "/bin",
      SLOPWEAVER_ALLOW_BASH: "1",
      SLOPWEAVER_ALLOW_UNPROBED_FINISH: "1",
      SLOPWEAVER_HOME: "/h",
    };
    expect(hatchFreeEnv({ env })).toEqual({ PATH: "/bin", SLOPWEAVER_HOME: "/h" });
  });
});

describe("finishCwd", () => {
  it("stands in the seat's worktree while it exists, and in the state home once it is gone", () => {
    expect([
      finishCwd({ home: "/h", worktree: "/wt/a", worktreeExists: true }),
      finishCwd({ home: "/h", worktree: "/wt/a", worktreeExists: false }),
    ]).toEqual(["/wt/a", "/h"]);
  });
});
