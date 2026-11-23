import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  budgetEvidenceLine,
  budgetWorkerLines,
  clockWarnToAppend,
  effectiveBudgetWarn,
  generationWarns,
  witnessWarnToAppend,
} from "../../../../live/turn/budgetWarn.js";
import type { ProgressLog, ProgressWarnEvent } from "../../../../live/turn/progressLog.js";
import type { ReviewRecord } from "../../../../live/turn/review.js";
import { TurnErrors } from "../../../../live/turn/turnErrors.js";

const ASK = { channel: "C1", messageTs: "1789186868.576709", threadTs: "1789186868.576709" };
/** The replay fixture's own generation: warn mark 05:44:52.099Z. */
const GEN = { leaseExpiresAt: "2026-09-12T06:24:48.249Z", tsIso: "2026-09-12T04:24:59.799Z" };
const BEFORE_MARK = "2026-09-12T05:30:00.000Z";
const PAST_MARK = "2026-09-12T05:50:00.000Z";

const EMPTY: ProgressLog = { stages: [], timeline: [], warns: [], writes: [] };

/** A whole review record, varying only the three fields the evidence line reads. */
const reviewRecord = ({
  carriedUnresolved,
  round,
  spawnedAt,
}: {
  carriedUnresolved: readonly string[];
  round: number;
  spawnedAt: string;
}): ReviewRecord => ({
  ...ASK,
  answerDigest: "sha256:" + "a".repeat(64),
  answerPath: "/tmp/answer.json",
  authorSession: "author workspace workspace:1 (id-workspace:1)",
  carriedUnresolved,
  packetPath: "/tmp/packet.md",
  reviewer: {
    host: "claude-code",
    surfaceId: "id-surface:9",
    surfaceRef: "surface:9",
    workspaceId: "id-workspace:9",
    workspaceRef: "workspace:9",
  },
  reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
  round,
  schemaVersion: 2,
  spawnedAt,
  verdictPath: "/tmp/verdict.json",
});

const clock = ({ tsIso, gen = GEN }: { tsIso: string; gen?: typeof GEN }): ProgressWarnEvent => ({
  dispatchedIso: gen.tsIso,
  kind: "warn",
  leaseExpiresAt: gen.leaseExpiresAt,
  source: "clock",
  tsIso,
});

const witness = ({ tsIso, note }: { tsIso: string; note: string }): ProgressWarnEvent => ({
  dispatchedIso: GEN.tsIso,
  kind: "warn",
  leaseExpiresAt: GEN.leaseExpiresAt,
  note,
  source: "witness",
  tsIso,
});

describe("clockWarnToAppend", () => {
  it("owes nothing before the mark", () => {
    expect(clockWarnToAppend({ dispatched: GEN, log: EMPTY, nowIso: BEFORE_MARK })).toBeUndefined();
  });

  it("owes exactly one clock warn past the mark", () => {
    expect(clockWarnToAppend({ dispatched: GEN, log: EMPTY, nowIso: PAST_MARK })).toEqual(clock({ tsIso: PAST_MARK }));
  });

  it("owes nothing once a clock warn stands", () => {
    const log = { ...EMPTY, warns: [clock({ tsIso: PAST_MARK })] };
    expect(clockWarnToAppend({ dispatched: GEN, log, nowIso: "2026-09-12T06:00:00.000Z" })).toBeUndefined();
  });

  it("owes nothing once a witness raised the warn before the mark", () => {
    const log = { ...EMPTY, warns: [witness({ note: "stages stopped naming anything new", tsIso: BEFORE_MARK })] };
    expect(clockWarnToAppend({ dispatched: GEN, log, nowIso: PAST_MARK })).toBeUndefined();
  });

  it("still owes one when the only warn belongs to the previous generation", () => {
    const earlier = { leaseExpiresAt: "2026-09-12T03:00:00.000Z", tsIso: "2026-09-12T01:00:00.000Z" };
    const log = { ...EMPTY, warns: [clock({ gen: earlier, tsIso: "2026-09-12T02:30:00.000Z" })] };
    expect(clockWarnToAppend({ dispatched: GEN, log, nowIso: PAST_MARK })).toEqual(clock({ tsIso: PAST_MARK }));
  });
});

describe("witnessWarnToAppend", () => {
  it("records one note for the generation the loop judged", () => {
    const recorded = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log: EMPTY,
      note: "  round 1 came back broken on the core deliverable  ",
      nowIso: BEFORE_MARK,
    });
    expect(unwrap(recorded)).toEqual(
      witness({ note: "round 1 came back broken on the core deliverable", tsIso: BEFORE_MARK }),
    );
  });

  it("accepts one note after a clock warn", () => {
    const log = { ...EMPTY, warns: [clock({ tsIso: PAST_MARK })] };
    const recorded = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log,
      note: "circling",
      nowIso: "2026-09-12T06:00:00.000Z",
    });
    expect(recorded.isOk()).toBe(true);
  });

  it("refuses a second note for the same generation", () => {
    const log = { ...EMPTY, warns: [witness({ note: "circling", tsIso: BEFORE_MARK })] };
    const recorded = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log,
      note: "still circling",
      nowIso: PAST_MARK,
    });
    expect(recorded._unsafeUnwrapErr()).toEqual(TurnErrors.warnAlreadyRecorded());
    expect(recorded._unsafeUnwrapErr().message).toBe(
      "this dispatch already carries a witness note — one note is the witness's whole output",
    );
  });

  it("refuses a note aimed at a generation a re-dispatch has replaced", () => {
    const recorded = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: "2026-09-12T01:00:00.000Z",
      log: EMPTY,
      note: "circling",
      nowIso: PAST_MARK,
    });
    expect(recorded._unsafeUnwrapErr().code).toBe("WARN_STALE_DISPATCH");
    expect(recorded._unsafeUnwrapErr().message).toContain(
      "is not this ask's current dispatch (2026-09-12T04:24:59.799Z)",
    );
  });

  it("refuses a multi-line note", () => {
    const recorded = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log: EMPTY,
      note: "one\ntwo",
      nowIso: PAST_MARK,
    });
    expect(recorded._unsafeUnwrapErr()).toEqual(TurnErrors.warnNotOneLine());
    expect(recorded._unsafeUnwrapErr().message).toBe("--warn must be a one-line observation");
  });
});

describe("effectiveBudgetWarn and generationWarns", () => {
  it("prefers the witness's observation over the clock's", () => {
    const note = witness({ note: "circling", tsIso: "2026-09-12T06:00:00.000Z" });
    const log = { ...EMPTY, warns: [clock({ tsIso: PAST_MARK }), note] };
    expect(effectiveBudgetWarn({ dispatched: GEN, log, nowIso: "2026-09-12T06:10:00.000Z" })).toEqual(note);
  });

  it("never sees a warn from its own future", () => {
    const log = { ...EMPTY, warns: [clock({ tsIso: PAST_MARK })] };
    expect(generationWarns({ dispatched: GEN, log, nowIso: BEFORE_MARK })).toEqual([]);
  });
});

describe("budgetEvidenceLine", () => {
  it("names the generation, the clock, this dispatch's stages, its review and the warn", () => {
    const log: ProgressLog = {
      ...EMPTY,
      stages: [
        { kind: "stage", text: "from an earlier dispatch", tsIso: "2026-09-12T01:00:00.000Z" },
        { kind: "stage", text: "thread read", tsIso: "2026-09-12T04:25:59.496Z" },
        { kind: "stage", text: "sending to review", tsIso: "2026-09-12T05:10:47.972Z" },
      ],
      warns: [clock({ tsIso: PAST_MARK })],
      writes: [],
    };
    const review = reviewRecord({ carriedUnresolved: ["a", "b"], round: 2, spawnedAt: "2026-09-12T05:22:00.000Z" });
    expect(budgetEvidenceLine({ askIdentity: ASK, dispatched: GEN, log, nowIso: PAST_MARK, review })).toBe(
      "budget: C1/1789186868.576709 — dispatched 2026-09-12T04:24:59.799Z; 85m of 119m, warn mark " +
        "2026-09-12T05:44:52.099Z passed; 2 stages this dispatch, last 39m ago; review round 2 (2 carried); " +
        "warn: clock 2026-09-12T05:50:00.000Z",
    );
  });

  it("says no review opened in this dispatch rather than counting an earlier one", () => {
    const review = reviewRecord({ carriedUnresolved: [], round: 6, spawnedAt: "2026-09-12T01:30:00.000Z" });
    expect(budgetEvidenceLine({ askIdentity: ASK, dispatched: GEN, log: EMPTY, nowIso: BEFORE_MARK, review })).toBe(
      "budget: C1/1789186868.576709 — dispatched 2026-09-12T04:24:59.799Z; 65m of 119m, warn mark " +
        "2026-09-12T05:44:52.099Z in 14m; 0 stages this dispatch; no review this dispatch; warn: none",
    );
  });
});

describe("budgetWorkerLines", () => {
  it("states the mark and nothing else before any warn", () => {
    expect(budgetWorkerLines({ dispatched: GEN, log: EMPTY, nowIso: BEFORE_MARK })).toEqual([
      "BUDGET: warn mark 2026-09-12T05:44:52.099Z (provisional, two thirds of this dispatch's lease to 2026-09-12T06:24:48.249Z).",
    ]);
  });

  it("reads the witness's note back neutrally, with no instruction to finish", () => {
    const log = { ...EMPTY, warns: [witness({ note: "round 2 carried round 1's three claims", tsIso: BEFORE_MARK })] };
    const lines = budgetWorkerLines({ dispatched: GEN, log, nowIso: PAST_MARK });
    expect(lines[1]).toBe(
      "BUDGET WARN raised 2026-09-12T05:30:00.000Z by the loop's sweep (witness): round 2 carried round 1's three claims. " +
        "An observation for your own plan — how this turn ends stays your call.",
    );
    expect(lines.join(" ")).not.toContain("post the best answer");
  });
});
