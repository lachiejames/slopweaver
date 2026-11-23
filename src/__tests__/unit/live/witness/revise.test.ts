/**
 * Revising a posted witness: the planner's refusals and its journal-derived target, the fold admitting one revision
 * and no other, and the orchestrator's ORDER — lock, read, correct, append, release — with nothing journalled when
 * the correction did not land, and nothing sent to Slack on a planning refusal.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { WitnessJournalErrors } from "../../../../live/witness/errors.js";
import { foldWitnessJournal, parseWitnessJournalLine } from "../../../../live/witness/journal.js";
import {
  planWitnessRevision,
  reviseWitness,
  type WitnessReviseDeps,
  type WitnessReviseRequest,
} from "../../../../live/witness/revise.js";
import { WitnessReviseErrors } from "../../../../live/witness/reviseErrors.js";
import {
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessOutcome,
  type WitnessRevisedEvent,
  witnessIdOf,
} from "../../../../live/witness/types.js";

const NOW = "2026-10-18T00:40:00.000Z";
const KEY: WitnessKey = { channel: "C0SYN000003", messageTs: "1792279381.542099", threadTs: "1792279096.435249" };
const ID = witnessIdOf({ key: KEY });
const POSTED_TS = "1792279444.176319";
const BECAUSE = "https://example.slack.com/archives/C0SYN000003/p1792280115016069?thread_ts=1792280014.634479";
const REQUEST: WitnessReviseRequest = {
  because: ` ${BECAUSE} `,
  correction: " she does resolve in the AU staff lookup. ",
  dryRun: false,
  witnessId: ID,
  wrong: "is NZ staff",
};

/** A terminal row for the witness. */
function settled({ outcome, postedTs }: { outcome: WitnessOutcome; postedTs?: string }): WitnessJournalEvent {
  return {
    ...KEY,
    kind: "settled",
    outcome,
    ...(postedTs === undefined ? {} : { postedTs }),
    schemaVersion: 1,
    tsIso: "2026-10-17T23:24:10.000Z",
    witnessId: ID,
  };
}

/** The live worker row for the witness. */
const DISPATCHED: WitnessJournalEvent = {
  ...KEY,
  host: "claude-code",
  kind: "dispatched",
  model: "sonnet",
  schemaVersion: 1,
  surfaceId: "s-1",
  surfaceRef: "surface:1",
  text: "her nz-staff member sign-in",
  tsIso: "2026-10-17T23:23:10.000Z",
  witnessId: ID,
  workspaceId: "w-1",
  workspaceRef: "workspace:1",
};

const POSTED = settled({ outcome: "posted", postedTs: POSTED_TS });

/** The row a revision of the posted witness writes. */
const REVISED: WitnessRevisedEvent = {
  ...KEY,
  because: BECAUSE,
  correction: "she does resolve in the AU staff lookup.",
  kind: "revised",
  postedTs: POSTED_TS,
  schemaVersion: 1,
  tsIso: NOW,
  witnessId: ID,
  wrong: "is NZ staff",
};

/** Plan over a journal. */
function plan({ events }: { events: readonly WitnessJournalEvent[] }): ReturnType<typeof planWitnessRevision> {
  return planWitnessRevision({ events, nowIso: NOW, request: REQUEST });
}

describe("planWitnessRevision", () => {
  it("takes the channel and posted ts from the journal, trimming the authored lines but never --wrong", () => {
    expect(unwrap(plan({ events: [DISPATCHED, POSTED] }))).toEqual(REVISED);
  });

  it("refuses an unknown witness", () => {
    expect(unwrapErr(plan({ events: [] })).code).toBe("WITNESS_UNKNOWN");
  });

  it("refuses a live witness, naming it live", () => {
    expect(unwrapErr(plan({ events: [DISPATCHED] }))).toEqual(
      WitnessReviseErrors.notPosted({ outcome: "live", witnessId: ID }),
    );
  });

  it("refuses a witness that ended silent", () => {
    expect(unwrapErr(plan({ events: [DISPATCHED, settled({ outcome: "nothing-material" })] }))).toEqual(
      WitnessReviseErrors.notPosted({ outcome: "nothing-material", witnessId: ID }),
    );
  });

  it("refuses a posted terminal with no posted ts", () => {
    expect(unwrapErr(plan({ events: [DISPATCHED, settled({ outcome: "posted" })] })).code).toBe("POSTED_TS_MISSING");
  });

  it("refuses a second revision", () => {
    expect(unwrapErr(plan({ events: [DISPATCHED, POSTED, REVISED] })).code).toBe("ALREADY_REVISED");
  });

  it.each([
    ["written before the posted terminal", [DISPATCHED, REVISED, POSTED]],
    ["naming another posted ts", [DISPATCHED, POSTED, { ...REVISED, postedTs: "1792279999.000001" }]],
  ] as const)("refuses when the journal holds a revised row the fold set aside, %s", (_label, events) => {
    expect([foldWitnessJournal({ events }).get(ID)!.revised, unwrapErr(plan({ events })).code]).toEqual([
      undefined,
      "ALREADY_REVISED",
    ]);
  });
});

describe("foldWitnessJournal over revised rows", () => {
  it("admits the first revision of a posted witness, keeping the terminal and advancing latestIso", () => {
    const record = foldWitnessJournal({ events: [DISPATCHED, POSTED, REVISED] }).get(ID)!;
    expect([record.settled, record.revised, record.latestIso]).toEqual([POSTED, REVISED, NOW]);
  });

  it("keeps the first revision when a second row follows", () => {
    const later = { ...REVISED, correction: "something else.", tsIso: "2026-10-18T01:00:00.000Z" };
    const record = foldWitnessJournal({ events: [DISPATCHED, POSTED, REVISED, later] }).get(ID)!;
    expect([record.revised, record.latestIso]).toEqual([REVISED, NOW]);
  });

  it.each([
    ["before any terminal", [DISPATCHED, REVISED]],
    ["after a silent terminal", [DISPATCHED, settled({ outcome: "nothing-material" }), REVISED]],
    ["naming another posted ts", [DISPATCHED, POSTED, { ...REVISED, postedTs: "1792279999.000001" }]],
  ] as const)("ignores a revision %s", (_label, events) => {
    expect(foldWitnessJournal({ events }).get(ID)!.revised).toBe(undefined);
  });

  it("creates no record for a revision of a witness it never saw", () => {
    expect(foldWitnessJournal({ events: [REVISED] }).size).toBe(0);
  });
});

describe("parseWitnessJournalLine over revised rows", () => {
  it("parses a revised row", () => {
    expect(unwrap(parseWitnessJournalLine({ line: JSON.stringify(REVISED), lineNumber: 1, path: "j" }))).toEqual(
      REVISED,
    );
  });

  it("refuses a revised row whose because is not a Slack permalink", () => {
    const line = JSON.stringify({ ...REVISED, because: "not a link" });
    expect(unwrapErr(parseWitnessJournalLine({ line, lineNumber: 3, path: "j" })).code).toBe("JOURNAL_LINE_MALFORMED");
  });
});

/** Fakes that record every seam call in order. */
function fakes({
  events,
  corrected = ok(undefined),
  appendFails = false,
}: {
  events: readonly WitnessJournalEvent[];
  corrected?: Awaited<ReturnType<WitnessReviseDeps["correct"]>>;
  appendFails?: boolean;
}): { deps: WitnessReviseDeps; calls: string[]; appended: WitnessJournalEvent[]; corrections: unknown[] } {
  const calls: string[] = [];
  const appended: WitnessJournalEvent[] = [];
  const corrections: unknown[] = [];
  const deps: WitnessReviseDeps = {
    append: ({ event }) => {
      calls.push("append");
      if (appendFails) {
        return err(WitnessJournalErrors.writeFailed({ cause: new Error("disk full"), path: "j" }));
      }
      appended.push(event);
      return ok(undefined);
    },
    correct: async (args) => {
      calls.push("correct");
      corrections.push(args);
      await Promise.resolve();
      return corrected;
    },
    lock: () => {
      calls.push("lock");
      return ok({
        release: () => {
          calls.push("release");
        },
      });
    },
    nowIso: () => NOW,
    readJournal: () => {
      calls.push("read");
      return ok(events);
    },
  };
  return { appended, calls, corrections, deps };
}

describe("reviseWitness", () => {
  it("locks, reads, corrects the journalled reply, appends, then releases", async () => {
    const world = fakes({ events: [DISPATCHED, POSTED] });
    const revised = unwrap(await reviseWitness({ deps: world.deps, request: REQUEST }));
    expect([world.calls, world.corrections, world.appended, revised]).toEqual([
      ["lock", "read", "correct", "append", "release"],
      [
        {
          channel: KEY.channel,
          correction: "she does resolve in the AU staff lookup.",
          dryRun: false,
          postedTs: POSTED_TS,
          wrong: "is NZ staff",
        },
      ],
      [REVISED],
      { dryRun: false, event: REVISED },
    ]);
  });

  it("runs the correction as a dry run and journals nothing", async () => {
    const world = fakes({ events: [DISPATCHED, POSTED] });
    const revised = unwrap(await reviseWitness({ deps: world.deps, request: { ...REQUEST, dryRun: true } }));
    expect([world.calls, world.appended, revised.dryRun]).toEqual([["lock", "read", "correct", "release"], [], true]);
  });

  it("never reaches Slack on a planning refusal", async () => {
    const world = fakes({ events: [DISPATCHED, POSTED, REVISED] });
    const refused = unwrapErr(await reviseWitness({ deps: world.deps, request: REQUEST }));
    expect([refused.code, world.calls]).toEqual(["ALREADY_REVISED", ["lock", "read", "release"]]);
  });

  it("never reaches Slack when a revised row was written before the posted terminal", async () => {
    const world = fakes({ events: [DISPATCHED, REVISED, POSTED] });
    const refused = unwrapErr(await reviseWitness({ deps: world.deps, request: REQUEST }));
    expect([refused.code, world.calls]).toEqual(["ALREADY_REVISED", ["lock", "read", "release"]]);
  });

  it("journals nothing when the correction did not land, passing its exit code on", async () => {
    const world = fakes({
      corrected: err(WitnessReviseErrors.correctionNotApplied({ exitCode: 3 })),
      events: [DISPATCHED, POSTED],
    });
    const refused = unwrapErr(await reviseWitness({ deps: world.deps, request: REQUEST }));
    expect([refused, world.calls]).toEqual([
      WitnessReviseErrors.correctionNotApplied({ exitCode: 3 }),
      ["lock", "read", "correct", "release"],
    ]);
  });

  it("names a landed correction it could not journal, and still releases the lock", async () => {
    const world = fakes({ appendFails: true, events: [DISPATCHED, POSTED] });
    const refused = unwrapErr(await reviseWitness({ deps: world.deps, request: REQUEST }));
    expect([refused.code, world.calls.at(-1)]).toEqual(["REVISION_RECORD_FAILED", "release"]);
  });

  it("refuses with the lock held, touching nothing", async () => {
    const world = fakes({ events: [DISPATCHED, POSTED] });
    const deps: WitnessReviseDeps = { ...world.deps, lock: () => err("held by pid 4242") };
    const refused = unwrapErr(await reviseWitness({ deps, request: REQUEST }));
    expect([refused.code, world.calls]).toEqual(["REVISE_LOCKED", []]);
  });
});
