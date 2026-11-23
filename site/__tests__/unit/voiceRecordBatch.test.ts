/*
 * The voice record read as a few processes, the larger groups each one `console batch`: which slugs share one, how a batch's lines become each
 * slug's reading, and what a slug with no line is answered as — never read as empty.
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_BATCH_VERBS } from "../../../src/cli/commands/console/batchVerbs";
import { liveVerbFor } from "../../lib/liveVerbs";
import type { SpawnOutcome } from "../../lib/spawnVerb";
import {
  type BatchRun,
  batchItems,
  batchKilledAtDeadline,
  batchReadings,
  parseBatchLines,
  VOICE_RECORD_GROUPS,
} from "../../lib/voiceRecordBatch";
import { VOICE_RECORD_SLUGS } from "../../lib/voiceRecordRead";

const AT = "2026-11-20T00:00:00.000Z";

/**
 * One item's wire line, as `console batch` prints it.
 *
 * @param index the item's position in the batch
 * @param exitCode what the item exited with
 * @param out what it printed on stdout
 * @param err what it printed on stderr
 * @returns the line, newline included
 */
function wire({
  index,
  exitCode = 0,
  out = "",
  err = "",
}: {
  index: number;
  exitCode?: number;
  out?: string;
  err?: string;
}): string {
  return `${JSON.stringify({ err, exitCode, index, out, tookMs: 12 })}\n`;
}

/**
 * A batch process that ran to a clean exit, having printed `out`.
 *
 * @param out what the batch printed
 * @returns the run
 */
function finished({ out }: { out: string }): BatchRun {
  return { killedAtDeadline: false, launched: true, outcome: { err: "", ok: true, out, tookMs: 900 } };
}

/**
 * A batch process killed at the read's deadline, having printed `out` before the kill.
 *
 * @param out what the batch printed before it was killed
 * @returns the run
 */
function killed({ out }: { out: string }): BatchRun {
  const outcome: SpawnOutcome = {
    err: "",
    exitCode: undefined,
    notMeasured: "slopweaver console batch did not answer within 15s",
    ok: false,
    out,
    tookMs: 15_000,
  };
  return { killedAtDeadline: true, launched: true, outcome };
}

const HANDS = liveVerbFor({ slug: "hands" })!;
const WORKSTREAMS = liveVerbFor({ slug: "workstreams" })!;
const SLUGS = ["hands", "workstreams"];
const VERBS = [HANDS, WORKSTREAMS];

describe("VOICE_RECORD_GROUPS", () => {
  it("reads every slug of the record exactly once, in four processes", () => {
    const every = VOICE_RECORD_GROUPS.flat();
    expect(every.toSorted()).toEqual(Object.values(VOICE_RECORD_SLUGS).toSorted());
    expect(new Set(every).size).toBe(every.length);
    expect(VOICE_RECORD_GROUPS.map((group) => group.length)).toEqual([1, 1, 2, 11]);
  });

  it("runs board alone, and review-drafts alone, since a batch refuses its external-write verb", () => {
    expect([VOICE_RECORD_GROUPS[0], VOICE_RECORD_GROUPS[1]]).toEqual([["board"], ["review-drafts"]]);
    expect(liveVerbFor({ slug: "review-drafts" })!.argv.slice(0, 2)).toEqual(["github", "review-draft"]);
  });

  it("names only slugs the allowlist carries", () => {
    expect(VOICE_RECORD_GROUPS.flat().filter((slug) => liveVerbFor({ slug }) === undefined)).toEqual([]);
  });

  it("batches only verbs `console batch` will run, so no batched read comes back refused", () => {
    const batched = VOICE_RECORD_GROUPS.filter((group) => group.length > 1).flat();
    expect(batched.length).toBe(13);
    const unlisted = batched.filter((slug) => {
      const argv = liveVerbFor({ slug })!.argv;
      return !CONSOLE_BATCH_VERBS.some((prefix) => prefix.every((word, at) => argv[at] === word));
    });
    expect(unlisted).toEqual([]);
  });
});

describe("batchItems", () => {
  it("sends each known slug's argv in order and skips a slug the allowlist lacks", () => {
    expect(batchItems({ verbs: [HANDS, undefined, WORKSTREAMS] })).toEqual([HANDS.argv, WORKSTREAMS.argv]);
  });

  it("sends nothing for no slugs", () => {
    expect(batchItems({ verbs: [] })).toEqual([]);
  });
});

describe("parseBatchLines", () => {
  it("reads each complete line into its index, in whatever order they arrived", () => {
    const parsed = parseBatchLines({ count: 2, out: wire({ index: 1, out: "b" }) + wire({ index: 0, out: "a" }) });
    expect(parsed.problem).toBeUndefined();
    expect(parsed.lines.map((line) => line!.out)).toEqual(["a", "b"]);
  });

  it("drops a fragment a kill cut mid-write rather than misreading it", () => {
    const parsed = parseBatchLines({ count: 2, out: `${wire({ index: 0, out: "a" })}{"index":1,"exi` });
    expect(parsed).toEqual({
      lines: [{ err: "", exitCode: 0, index: 0, out: "a", tookMs: 12 }, undefined],
      problem: undefined,
    });
  });

  it("names a line that is not JSON, one whose index is no item's, and a second line for one item", () => {
    expect([
      parseBatchLines({ count: 1, out: "not json\n" }).problem,
      parseBatchLines({ count: 1, out: wire({ index: 1 }) }).problem,
      parseBatchLines({ count: 2, out: wire({ index: 0 }) + wire({ index: 0 }) }).problem,
      parseBatchLines({ count: 1, out: '{"index":0,"exitCode":0,"out":"","err":""}\n' }).problem,
    ]).toEqual([
      "the batch printed a line that is not JSON, beginning `not json`",
      "the batch printed a line whose index 1 is not one of its 1 items",
      "the batch printed a second line for item 0",
      "the batch printed item 0's line with no non-negative tookMs",
    ]);
  });

  it("reads empty output as no lines at all", () => {
    expect(parseBatchLines({ count: 2, out: "" })).toEqual({ lines: [undefined, undefined], problem: undefined });
  });
});

describe("batchReadings", () => {
  it("reads each item's stdout as its verb's payload", () => {
    const out = wire({ index: 0, out: "" }) + wire({ index: 1, out: '{"rows":[]}' });
    const readings = Object.fromEntries(
      batchReadings({ receivedAtIso: AT, run: finished({ out }), slugs: SLUGS, verbs: VERBS }),
    );
    expect(readings["workstreams"]).toEqual({
      observedAtIso: AT,
      ok: true,
      payload: { rows: [] },
      stampedByRoute: !WORKSTREAMS.stampsItsOwnTime,
    });
  });

  it("reads an item's declared expected-empty exit as an answer, and any other non-zero as a failure with its stderr", () => {
    const out =
      wire({ err: "boom", exitCode: 1, index: 0 }) + wire({ err: "no workstreams yet", exitCode: 3, index: 1 });
    const readings = Object.fromEntries(
      batchReadings({ receivedAtIso: AT, run: finished({ out }), slugs: SLUGS, verbs: VERBS }),
    );
    expect([readings["hands"], readings["workstreams"]]).toEqual([
      { notMeasured: `${HANDS.title} exited 1: boom`, observedAtIso: AT, ok: false },
      {
        observedAtIso: AT,
        ok: true,
        payload: {
          code: "NO_WORKSTREAMS",
          kind: "expected-empty",
          why: `${WORKSTREAMS.title} exited 3: no workstreams yet`,
        },
        stampedByRoute: true,
      },
    ]);
  });

  it("keeps what a batch killed at the deadline answered, and names the rest as out of time", () => {
    const run = killed({ out: wire({ index: 0, out: "" }) });
    const readings = Object.fromEntries(batchReadings({ receivedAtIso: AT, run, slugs: SLUGS, verbs: VERBS }));
    expect(readings["hands"].ok).toBe(true);
    expect(readings["workstreams"]).toEqual({
      notMeasured: "workstreams did not answer within the 15 s the voice record read has",
      observedAtIso: AT,
      ok: false,
    });
  });

  it("names a slug the batch never reached by how the batch ended, never as empty", () => {
    const signalled: BatchRun = {
      killedAtDeadline: false,
      launched: true,
      outcome: {
        err: "",
        exitCode: undefined,
        notMeasured: "slopweaver console batch was killed by SIGTERM before it answered",
        ok: false,
        out: "",
        tookMs: 300,
      },
    };
    expect([
      batchReadings({ receivedAtIso: AT, run: signalled, slugs: ["hands"], verbs: [HANDS] }),
      batchReadings({ receivedAtIso: AT, run: finished({ out: "" }), slugs: ["hands"], verbs: [HANDS] }),
      batchReadings({ receivedAtIso: AT, run: finished({ out: "garbage\n" }), slugs: ["hands"], verbs: [HANDS] }),
    ]).toEqual([
      [
        [
          "hands",
          {
            notMeasured: "hands was not read: slopweaver console batch was killed by SIGTERM before it answered",
            observedAtIso: AT,
            ok: false,
          },
        ],
      ],
      [
        [
          "hands",
          {
            notMeasured: "hands was not read: the batch it ran in finished without answering it",
            observedAtIso: AT,
            ok: false,
          },
        ],
      ],
      [
        [
          "hands",
          {
            notMeasured: "hands was not read: the batch printed a line that is not JSON, beginning `garbage`",
            observedAtIso: AT,
            ok: false,
          },
        ],
      ],
    ]);
  });

  it("names every slug of a batch that never launched, and a slug with no allowlist row, reading the rest by position", () => {
    const notLaunched = batchReadings({
      receivedAtIso: AT,
      run: { launched: false, why: "the voice record read's deadline had passed" },
      slugs: ["hands"],
      verbs: [HANDS],
    });
    const gap = batchReadings({
      receivedAtIso: AT,
      run: finished({ out: wire({ err: "late", exitCode: 1, index: 0 }) }),
      slugs: ["nope", "hands"],
      verbs: [undefined, HANDS],
    });
    expect([...notLaunched, ...gap]).toEqual([
      [
        "hands",
        {
          notMeasured: "hands was not started: the voice record read's deadline had passed",
          observedAtIso: AT,
          ok: false,
        },
      ],
      ["nope", { notMeasured: "no live verb named nope", observedAtIso: AT, ok: false }],
      ["hands", { notMeasured: `${HANDS.title} exited 1: late`, observedAtIso: AT, ok: false }],
    ]);
  });
});

describe("batchKilledAtDeadline", () => {
  const noCode: SpawnOutcome = { err: "", exitCode: undefined, notMeasured: "x", ok: false, out: "", tookMs: 1 };

  it("is the deadline only when the batch has no exit code and the deadline has come", () => {
    expect([
      batchKilledAtDeadline({ deadlineAtMs: 100, nowMs: 100, outcome: noCode }),
      batchKilledAtDeadline({ deadlineAtMs: 100, nowMs: 40, outcome: noCode }),
      batchKilledAtDeadline({ deadlineAtMs: 100, nowMs: 200, outcome: { ...noCode, exitCode: 1 } }),
      batchKilledAtDeadline({ deadlineAtMs: 100, nowMs: 200, outcome: { err: "", ok: true, out: "", tookMs: 1 } }),
    ]).toEqual([true, false, false, false]);
  });
});
