/*
 * `assessPassActivity` over the exit-code signal alone — when a run of failed commands is a misroute to abort, a
 * suspicion to keep, or ordinary exploration. It moved here when `tripwire.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { CodexActivity } from "../../../../codex/progress.js";
import { foldCodexEvent, initialCodexActivity } from "../../../../codex/progress.js";
import { assessPassActivity, EARLY_WINDOW_MS, tripwireExplanation } from "../../../../codex/tripwire.js";
import type { CodexObservedEvent } from "../../../../codex/types.js";

const WORKSPACE = "/scratch/pass-1";
const REPO = "/w/personal/slopweaver";

/** Assess against the standard roots, so each test states only what it is varying. */
function assess({ activity, elapsedMs }: { activity: CodexActivity; elapsedMs: number }) {
  return assessPassActivity({ activity, elapsedMs, repoRoot: REPO, workspaceRoot: WORKSPACE });
}

/** Fold a run of command results into an activity, as the stream would. */
function activityOf({ exits }: { exits: readonly number[] }) {
  return exits.reduce(
    (activity, exitCode) =>
      foldCodexEvent({
        activity,
        event: {
          item: { command: `cat ${REPO}/file-${String(exitCode)}.md`, exitCode, itemKind: "command_execution" },
          kind: "item",
        } satisfies CodexObservedEvent,
      }),
    initialCodexActivity(),
  );
}

describe("assessPassActivity", () => {
  it("is ok while nothing has failed, however many commands have run", () => {
    const assessment = assess({ activity: activityOf({ exits: [0, 0, 0, 0, 0] }), elapsedMs: 5_000 });

    expect(assessment.verdict).toBe("ok");
    expect(assessment.reasons).toEqual([]);
  });

  /**
   * The failure this whole mechanism exists for: a pass pointed at a workspace that is not there fails every
   * command, immediately. Aborting at ~18 seconds instead of at the bound is the entire saving.
   */
  it("ABORTS when every command fails early — the signature of a wrong workspace", () => {
    const assessment = assess({ activity: activityOf({ exits: [1, 1, 2] }), elapsedMs: 18_000 });

    expect(assessment.verdict).toBe("abort");
    expect(assessment.reasons.join(" ")).toContain("every command has failed");
  });

  it("does NOT abort when some commands are succeeding — that is exploration, not hunting", () => {
    const assessment = assess({ activity: activityOf({ exits: [1, 0, 1, 0, 1] }), elapsedMs: 18_000 });

    expect(assessment.verdict).toBe("suspect");
  });

  it("does NOT abort on two failures, however early — one grep miss is not a misroute", () => {
    const assessment = assess({ activity: activityOf({ exits: [1, 1] }), elapsedMs: 3_000 });

    expect(assessment.verdict).toBe("suspect");
  });

  /**
   * Deliberately asymmetric about time. A long pass over a large repository accumulates failed greps for
   * perfectly good reasons, and killing those would make this worse than the silence it replaced.
   */
  it("only ever suspects after the early window, never aborts", () => {
    const assessment = assess({ activity: activityOf({ exits: [1, 1, 1, 1, 1, 1] }), elapsedMs: EARLY_WINDOW_MS + 1 });

    expect(assessment.verdict).toBe("suspect");
  });

  it("aborts at the boundary of the early window, not one millisecond after", () => {
    expect(assess({ activity: activityOf({ exits: [1, 1, 1] }), elapsedMs: EARLY_WINDOW_MS }).verdict).toBe("abort");
    expect(assess({ activity: activityOf({ exits: [1, 1, 1] }), elapsedMs: EARLY_WINDOW_MS + 1 }).verdict).toBe(
      "suspect",
    );
  });

  it("explains itself with the counts, so an abort is actionable rather than mysterious", () => {
    const assessment = assess({ activity: activityOf({ exits: [1, 1, 1] }), elapsedMs: 20_000 });

    expect(tripwireExplanation({ assessment })).toContain("3 of 3 commands failed");
    expect(tripwireExplanation({ assessment })).toContain("stopped early");
  });

  it("ignores web searches and scratch writes — only commands carry the signal", () => {
    const activity = foldCodexEvent({
      activity: activityOf({ exits: [0] }),
      event: { item: { itemKind: "web_search", query: "anything" }, kind: "item" },
    });

    expect(assess({ activity, elapsedMs: 1_000 }).verdict).toBe("ok");
  });
});
