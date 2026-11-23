/**
 * The tick ledger's door: what it lets through, and every shape it refuses.
 *
 * Each refusal below catches a row that would otherwise PARSE and then be silently wrong on the briefing —
 * a source missing so the page reads a quiet fleet, a reading from another tick, an id that makes the
 * projection's conservation receipt uncountable, or stats a row asserted about itself.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { tickRowDefects } from "../../../supervisor/tickRowDefects.js";
import { parseSupervisorTickRow, supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import { parseSupervisorTickLine } from "../../../supervisor/tickStore.js";
import { SUPERVISOR_TICK_SCHEMA_VERSION, TICK_SOURCE_KINDS } from "../../../supervisor/tickTypes.js";

/** Every source, `unavailable` with a diagnostic — the honest shape of a tick that read nothing. */
function allUnavailable(): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/** The owner-turn snapshot every fixture here uses unless it is testing that field. */
const OWNER_TURNS = {
  coverage: {
    earliestIso: "2026-08-10T00:41:38.416Z",
    linksKnown: 2,
    reachesSince: true,
    unreadable: [],
    walked: ["a1"],
  },
  sinceIso: "2026-09-09T12:00:00.000Z",
  status: "read",
  turns: [],
};

/**
 * A row with every field valid, plus whatever the caller overrides.
 *
 * `stats` is computed the one way the schema computes it, so a fixture is never wrong about its own numbers
 * by accident — a test that had to hand-count bytes would break on every prose edit.
 *
 * @param over the fields to replace
 * @returns the candidate row
 */
function rowWith(over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const base = {
    actions: [],
    finalisedIso: "2026-09-10T12:20:00.000Z",
    handoff: "handoff-9226",
    judgements: [],
    ownerTurns: OWNER_TURNS,
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    sources: allUnavailable(),
    startedIso: "2026-09-10T12:00:00.000Z",
    tickId: "tick-1",
    workspace: "workspace:61",
    ...over,
  };
  return {
    ...base,
    stats: supervisorTickStatsOf({
      actions: base.actions,
      judgements: base.judgements,
      ownerTurns: base.ownerTurns,
      sources: base.sources,
    }),
    ...("stats" in over ? { stats: over["stats"] } : {}),
  };
}

/** One judgement, shaped as the closed vocabulary demands. */
const JUDGEMENT = {
  claim: "530's session is landing it itself on a canon fix, so this seat watches rather than lands",
  judgementId: "j1",
  kind: "cross-source-causal-link",
  recordedIso: "2026-09-10T12:15:00.000Z",
  subject: { id: "workspace:13", kind: "session", label: "the E2E row" },
  whyNotDerived: "cross-source-inference",
  witness: { kind: "command", ref: "slopweaver cmux list --json" },
};

describe("tickRowDefects", () => {
  it("finds nothing in a sound row", () => {
    const row = unwrap(parseSupervisorTickRow({ value: rowWith() }));

    expect(tickRowDefects({ row })).toStrictEqual([]);
  });

  it("names a negative interval and the observations it leaves outside, one line each", () => {
    const row = unwrap(parseSupervisorTickRow({ value: rowWith() }));
    const backwards = { ...row, finalisedIso: "2026-09-10T11:00:00.000Z" };

    const defects = tickRowDefects({ row: backwards });

    expect(defects[0]).toBe("finalisedIso 2026-09-10T11:00:00.000Z is before startedIso 2026-09-10T12:00:00.000Z");
    expect(defects.length).toBe(1 + TICK_SOURCE_KINDS.length);
  });
});

describe("parseSupervisorTickRow", () => {
  it("accepts a row whose every source is unavailable, because that is an honest tick", () => {
    const row = unwrap(parseSupervisorTickRow({ value: rowWith() }));

    expect(row.tickId).toBe("tick-1");
    expect(row.sources.capacity.status).toBe("unavailable");
    expect(row.stats.judgementCount).toBe(0);
  });

  it("refuses a row that leaves a source out, naming it", () => {
    const sources = allUnavailable();
    delete sources["gauge"];
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    expect(errors.some((line) => line.includes("gauge"))).toBe(true);
  });

  it("refuses an observation taken outside the tick's own interval", () => {
    const sources = allUnavailable();
    sources["capacity"] = {
      diagnostic: "not read",
      observedAtIso: "2026-09-10T09:00:00.000Z",
      status: "unavailable",
      witness: { command: "slopweaver machine capacity --json", exitCode: null },
    };
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    expect(errors.some((line) => line.includes("sources.capacity.observedAtIso"))).toBe(true);
  });

  it("refuses a finalisation that precedes the tick's start", () => {
    const errors = unwrapErr(
      parseSupervisorTickRow({
        value: rowWith({ finalisedIso: "2026-09-10T11:00:00.000Z", startedIso: "2026-09-10T12:00:00.000Z" }),
      }),
    );

    expect(errors.some((line) => line.includes("is before startedIso"))).toBe(true);
  });

  it("refuses two judgements sharing an id", () => {
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ judgements: [JUDGEMENT, JUDGEMENT] }) }));

    expect(errors.some((line) => line.includes("share judgementId j1"))).toBe(true);
  });

  it("refuses a row whose stats disagree with its own contents", () => {
    const errors = unwrapErr(
      parseSupervisorTickRow({
        value: rowWith({ stats: { judgementCount: 9, judgementUtf8Bytes: 1, structuredUtf8Bytes: 1 } }),
      }),
    );

    expect(errors.some((line) => line.includes("stats disagree with the row"))).toBe(true);
  });

  it("accepts a hold-rationale naming a row AND a ceiling, the pair the idle-capacity gate reads", () => {
    const judgement = {
      ...JUDGEMENT,
      kind: "hold-rationale",
      relatedSubjects: [{ id: "claude:plan-two", kind: "ceiling", label: "week at 36%, reserved for the Fable seat" }],
      subject: { id: "the-doc", kind: "handover", label: "the doc" },
    };
    const row = unwrap(parseSupervisorTickRow({ value: rowWith({ judgements: [judgement] }) }));

    expect(row.judgements[0]!.relatedSubjects).toStrictEqual([
      { id: "claude:plan-two", kind: "ceiling", label: "week at 36%, reserved for the Fable seat" },
    ]);
  });

  it("refuses a related subject of a kind nobody declared", () => {
    const judgement = { ...JUDGEMENT, relatedSubjects: [{ id: "x", kind: "planet", label: "x" }] };
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ judgements: [judgement] }) }));

    expect(errors.some((line) => line.includes("relatedSubjects"))).toBe(true);
  });

  it("counts judgement bytes apart from the rest, so regrowth is measurable", () => {
    const row = unwrap(parseSupervisorTickRow({ value: rowWith({ judgements: [JUDGEMENT] }) }));

    expect(row.stats.judgementCount).toBe(1);
    expect(row.stats.judgementUtf8Bytes).toBe(Buffer.byteLength(JSON.stringify([JUDGEMENT]), "utf8"));
    expect(row.stats.structuredUtf8Bytes).toBeGreaterThan(0);
  });

  it("refuses a partial observation that names no gap", () => {
    const sources = allUnavailable();
    sources["capacity"] = {
      facts: {
        dispatchBackoffSeconds: 0,
        dispatchCovering: 0,
        dispatchOpen: 0,
        dispatchSubject: "",
        hold: false,
        holdSubjects: [],
        load1: 12.15,
        segmentsPct: 12,
        swapfileCount: 5,
        topForeignGb: 8,
        topForeignLabel: "com.apple.Virtualization.VirtualMachine",
      },
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "partial",
      witness: { command: "slopweaver machine capacity --json", exitCode: 0 },
    };
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    expect(errors.length).toBeGreaterThan(0);
  });

  it("refuses a schema version it does not know, rather than reading the fields anyway", () => {
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ schemaVersion: 99 }) }));

    expect(errors.some((line) => line.startsWith("schemaVersion"))).toBe(true);
  });

  it("refuses a key nobody declared", () => {
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ narrative: "the old authored prose" }) }));

    expect(errors.length).toBeGreaterThan(0);
  });
});

/** A capacity reading as rows before the dispatch readings were journalled: no dispatch readings at all. */
const PRE_DISPATCH_CAPACITY = {
  hold: false,
  holdSubjects: [],
  load1: 12.15,
  segmentsPct: 12,
  swapfileCount: 5,
  topForeignGb: 8,
  topForeignLabel: "com.apple.Virtualization.VirtualMachine",
};

/**
 * Every source unavailable except the two whose facts grew a required key after the ledger already held rows.
 *
 * @param capacity the capacity facts to read
 * @param friction the friction facts to read
 * @returns the sources object
 */
function historicalSources({
  capacity,
  friction,
}: {
  capacity: Readonly<Record<string, unknown>>;
  friction: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const witness = { command: "slopweaver machine capacity --json", exitCode: 0 };
  return {
    ...allUnavailable(),
    capacity: { facts: capacity, observedAtIso: "2026-09-10T12:10:00.000Z", status: "read", witness },
    friction: { facts: friction, observedAtIso: "2026-09-10T12:10:00.000Z", status: "read", witness },
  };
}

describe("a row journalled before a reading existed", () => {
  it("reads a row from before the dispatch and capacity readings were journalled, leaving the readings it never took absent", () => {
    const sources = historicalSources({
      capacity: PRE_DISPATCH_CAPACITY,
      friction: { hasGap: false, newestReport: "2026-09-03" },
    });
    const row = unwrap(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    // `toStrictEqual` tells a missing key from one present as `undefined`, so nothing was invented on read.
    expect(row.sources.capacity).toStrictEqual(sources["capacity"]);
    expect(row.sources.friction).toStrictEqual(sources["friction"]);
  });

  it("refuses a row carrying some dispatch readings but not all, naming the ones it carries", () => {
    const sources = historicalSources({
      capacity: { ...PRE_DISPATCH_CAPACITY, dispatchOpen: 1, dispatchSubject: "load" },
      friction: { hasGap: false, isStale: false, newestReport: null },
    });
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    expect(errors.some((line) => line.includes("carries only dispatchOpen, dispatchSubject"))).toBe(true);
  });

  it("still refuses a capacity key nobody declared", () => {
    const sources = historicalSources({
      capacity: { ...PRE_DISPATCH_CAPACITY, dispatchPending: 2 },
      friction: { hasGap: false, isStale: false, newestReport: null },
    });
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWith({ sources }) }));

    expect(errors.some((line) => line.includes("dispatchPending"))).toBe(true);
  });
});

describe("an owner turn's lockInLink, across the rename", () => {
  /** One owner turn, valid in every field but the one under test. */
  const turnWith = ({ lockInLink }: { lockInLink: string }): Record<string, unknown> => ({
    inGrace: false,
    instantIso: "2026-09-10T12:05:00.000Z",
    lockIn: null,
    lockInLink,
    pointer: "transcript:a1#t1",
    sessionId: "a1",
    source: "supervisor",
    text: "land the bumps",
    transcriptLineNumber: 12,
    turnUuid: "t1",
    witness: null,
  });

  const rowWithTurn = ({ lockInLink }: { lockInLink: string }): Record<string, unknown> =>
    rowWith({ ownerTurns: { ...OWNER_TURNS, turns: [turnWith({ lockInLink })] } });

  it("REFUSES the spelling this arm carried on disk before the rename, naming the field rather than the row", () => {
    const errors = unwrapErr(parseSupervisorTickRow({ value: rowWithTurn({ lockInLink: "legacy-unlinked" }) }));

    expect(errors.some((line) => line.startsWith("ownerTurns.turns.0.lockInLink"))).toBe(true);
  });

  it("would not be rescued by a read-side rewrite, because the row's own byte count is recomputed after it", () => {
    // The witness for the follow-up named in `tickSchema.ts`: `stats.structuredUtf8Bytes` is measured over
    // the PARSED row, so a row whose numbers were written under a 15-byte spelling disagrees with itself
    // once a 23-byte one is substituted. Mapping the old value to the new one trades one refusal for
    // another rather than reading the row.
    const written = rowWithTurn({ lockInLink: "legacy-unlinked" });
    const rewritten = rowWithTurn({ lockInLink: "recorded-before-pointer" });
    const statsOf = (row: Record<string, unknown>): number =>
      supervisorTickStatsOf({
        actions: row["actions"],
        judgements: row["judgements"],
        ownerTurns: row["ownerTurns"],
        sources: row["sources"],
      }).structuredUtf8Bytes;

    expect(statsOf(rewritten) - statsOf(written)).toBe(8);
  });

  it("passes the current spelling through unchanged", () => {
    const row = unwrap(parseSupervisorTickRow({ value: rowWithTurn({ lockInLink: "linked" }) }));

    expect(row.ownerTurns.turns[0]!.lockInLink).toBe("linked");
  });
});

describe("parseSupervisorTickLine", () => {
  it("reads a row back out of its own line", () => {
    const line = JSON.stringify(rowWith());
    const row = unwrap(parseSupervisorTickLine({ line }));

    expect(row.tickId).toBe("tick-1");
  });

  it("refuses a line that is not JSON, naming it as unreadable", () => {
    const error = unwrapErr(parseSupervisorTickLine({ line: "{not json" }));

    expect(error.code).toBe("TICK_LINE_UNREADABLE");
    expect(supervisorCoreErrorLines({ error })[0]!).toContain("not readable JSON");
  });
});
