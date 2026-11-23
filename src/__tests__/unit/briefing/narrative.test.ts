/**
 * The tick-ledger projection: which section each recorded thing lands in, and the proof none was dropped.
 *
 * The conservation cases matter more than the happy path. This projection is the only thing standing between
 * a recorded turn of the owner's and a page that quietly does not carry it, so what is asserted here is that a lost
 * atom FAILS rather than renders — and, for the one class a projection is allowed to collapse, that the
 * omission names the atom a reader meets instead.
 */
import { describe, expect, it } from "vitest";

import {
  checkNarrativeConservation,
  narrativeReceiptLines,
  projectSupervisorNarrative,
  type SupervisorNarrativeReceipt,
} from "../../../briefing/narrative.js";
import { narrativeErrorLines } from "../../../briefing/narrativeErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { textOfContent } from "../../../outbound/briefing/vocabulary.js";
import type { SupervisorTickWindow } from "../../../supervisor/tickStore.js";
import {
  type FleetLanding,
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorJudgement,
  type SupervisorOwnerTurn,
  type SupervisorTickAction,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";

/** Every source `unavailable`, which is the quietest row a fixture can carry. */
function allUnavailable({ observedAtIso }: { observedAtIso: string }): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: `${kind} was not read by this fixture`,
      observedAtIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/** One recorded turn of the owner's, at a known transcript position. */
function turn({
  text,
  line,
  session = "session-a",
  instantIso = "2026-09-15T01:00:00.000Z",
}: {
  text: string;
  line: number | null;
  session?: string;
  instantIso?: string;
}): SupervisorOwnerTurn {
  return {
    inGrace: false,
    instantIso,
    lockIn: null,
    lockInLink: "none",
    pointer: `transcript:${session}#${String(line)}`,
    sessionId: session,
    source: "transcript",
    text,
    transcriptLineNumber: line,
    turnUuid: `uuid-${session}-${String(line)}`,
    witness: null,
  };
}

/** One landed pull request. */
function landing({
  id,
  number,
  title = "a thing that landed",
}: {
  id: string;
  number: number;
  title?: string;
}): FleetLanding {
  return {
    kind: "pull-request",
    landedAtIso: `2026-09-15T0${String(number)}:00:00.000Z`,
    landingId: id,
    mergeCommitSha: `sha-${id}`,
    number,
    repo: "acme/slopweaver",
    title,
    url: `https://github.com/acme/slopweaver/pull/${String(number)}`,
  };
}

/** One recorded act. */
function action({ id, kind = "merge" }: { id: string; kind?: string }): SupervisorTickAction {
  return {
    actionId: id,
    kind: kind as SupervisorTickAction["kind"],
    outcome: "completed",
    recordedIso: "2026-09-15T02:00:00.000Z",
    subject: { id: "acme/slopweaver#1", kind: "pull-request", label: "the one that landed" },
    witness: { kind: "command", ref: "slopweaver github merge" },
  };
}

/** One recorded call. */
function judgement({ id, claim }: { id: string; claim: string }): SupervisorJudgement {
  return {
    claim,
    judgementId: id,
    kind: "cross-source-causal-link",
    recordedIso: "2026-09-15T02:05:00.000Z",
    subject: { id: "workspace:61", kind: "session", label: "the supervisor's own chat" },
    whyNotDerived: "cross-source-inference",
    witness: { kind: "ledger", ref: "supervisor-ticks.jsonl" },
  };
}

/** One row, with whatever the case under test needs on it. */
function row({
  tickId,
  finalisedIso,
  turns = [],
  landings,
  actions = [],
  judgements = [],
}: {
  tickId: string;
  finalisedIso: string;
  turns?: readonly SupervisorOwnerTurn[];
  landings?: readonly FleetLanding[] | undefined;
  actions?: readonly SupervisorTickAction[];
  judgements?: readonly SupervisorJudgement[];
}): SupervisorTickRow {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const sources = allUnavailable({ observedAtIso: startedIso });
  if (landings !== undefined) {
    sources["landings"] = {
      facts: { landings },
      observedAtIso: startedIso,
      status: "read",
      witness: { command: "slopweaver github landings", exitCode: 0 },
    };
  }
  return {
    actions,
    finalisedIso,
    handoff: "handoff-9260",
    judgements,
    ownerTurns: {
      coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read",
      turns,
    },
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    sources,
    startedIso,
    stats: { judgementCount: judgements.length, judgementUtf8Bytes: 0, structuredUtf8Bytes: 0 },
    tickId,
    workspace: "workspace:61",
  } as unknown as SupervisorTickRow;
}

/** A window over the given rows, all on one Melbourne day unless the caller splits them. */
function windowOf({
  currentDay,
  priorDays = [],
  ticksInLedger,
  olderDaysOmitted = 0,
}: {
  currentDay: readonly SupervisorTickRow[];
  priorDays?: readonly { readonly dayKey: string; readonly ticks: readonly SupervisorTickRow[] }[];
  ticksInLedger?: number;
  olderDaysOmitted?: number;
}): SupervisorTickWindow {
  const rows = currentDay.length + priorDays.reduce((total, day) => total + day.ticks.length, 0);
  // A window whose caller named no ledger total holds exactly what it retained, which is the ordinary case.
  let inLedger = rows;
  if (ticksInLedger !== undefined) {
    inLedger = ticksInLedger;
  }
  return {
    currentDay,
    newest: currentDay[currentDay.length - 1]!,
    olderDaysOmitted,
    priorDays,
    ticksInLedger: inLedger,
  };
}

/** Every note's headline as plain text, across one whole section. */
function headlines({ notes }: { notes: readonly { readonly headline: readonly unknown[] }[] }): readonly string[] {
  return notes.map((note) => textOfContent({ content: note.headline as never }));
}

/** Every plain-text run of one section, folds included — what a reader who opened everything would see. */
function sectionText({ section }: { section: { readonly notes: readonly unknown[] } }): string {
  return JSON.stringify(section);
}

describe("projecting the tick ledger into the briefing's narrative", () => {
  it("puts the newest pass's landings in `recent`, oldest first, and nothing else", () => {
    const window = windowOf({
      currentDay: [
        row({
          actions: [action({ id: "act-1" })],
          finalisedIso: "2026-09-15T03:00:00.000Z",
          landings: [landing({ id: "l-2", number: 2 }), landing({ id: "l-1", number: 1 })],
          tickId: "t-1",
          turns: [turn({ line: 5, text: "ship it" })],
        }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.recent.length).toBe(2);
    expect(textOfContent({ content: projected.recent[0]!.headline })).toBe(
      "acme/slopweaver#1 a thing that landed landed 2026-09-15T01:00:00.000Z, merge sha-l-1",
    );
    expect(textOfContent({ content: projected.recent[1]!.headline })).toBe(
      "acme/slopweaver#2 a thing that landed landed 2026-09-15T02:00:00.000Z, merge sha-l-2",
    );
  });

  it("renders a landing's own address as a link rather than as a bare reference", () => {
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T03:00:00.000Z", landings: [landing({ id: "l-1", number: 7 })], tickId: "t-1" }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.recent[0]!.headline[0]).toEqual({
      kind: "link",
      text: "acme/slopweaver#7 a thing that landed",
      url: "https://github.com/acme/slopweaver/pull/7",
    });
  });

  it("refuses a newest pass carrying more landings than the section can count", () => {
    const window = windowOf({
      currentDay: [
        row({
          finalisedIso: "2026-09-15T03:00:00.000Z",
          landings: [1, 2, 3, 4, 5, 6].map((number) => landing({ id: `l-${String(number)}`, number })),
          tickId: "t-1",
        }),
      ],
    });

    const refusal = narrativeErrorLines({ error: unwrapErr(projectSupervisorNarrative({ window })) });

    expect(refusal[0]).toContain("saw 6 landings and the page shows at most 5");
  });

  it("shows no landing at all when the newest read of that source failed, and says so", () => {
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", landings: [landing({ id: "l-1", number: 1 })], tickId: "t-1" }),
        row({ finalisedIso: "2026-09-15T03:00:00.000Z", tickId: "t-2" }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.recent).toEqual([]);
    expect(sectionText({ section: projected.earlierToday })).toContain("landings was not read by this fixture");
  });

  it("rolls a whole day into at most five notes, whatever the pass count", () => {
    // Twenty-minute passes from midnight UTC, so all seventy-two land inside one Melbourne day — which is what a
    // real window always holds, since the store groups rows BY `localDayKey` before this ever sees them.
    const ticks = Array.from({ length: 72 }, (_unused, index) =>
      row({
        actions: [action({ id: `act-${String(index)}` })],
        finalisedIso: new Date(Date.parse("2026-09-15T00:00:00.000Z") + index * 10 * 60_000).toISOString(),
        judgements: [
          judgement({ claim: "the pool ran out because the scan started too many", id: `j-${String(index)}` }),
        ],
        tickId: `t-${String(index)}`,
        turns: [turn({ line: index, text: `turn ${String(index)}` })],
      }),
    );
    const window = windowOf({ currentDay: ticks });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.earlierToday.notes.length).toBe(4);
    expect(projected.earlierToday.summary).toContain("72 recorded pass(es)");
  });

  it("refuses a window whose rows do not fall on the day it files them under", () => {
    // Melbourne is ten hours ahead, so the end of the UTC day is already the next day there. A window claiming both rows as one
    // day is incoherent, and the atoms of the second would land in no rollup at all — so the conservation
    // check refuses rather than the page quietly not carrying them.
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1", turns: [turn({ line: 1, text: "morning" })] }),
        row({ finalisedIso: "2026-09-15T15:00:00.000Z", tickId: "t-2", turns: [turn({ line: 2, text: "evening" })] }),
      ],
    });

    const refusal = narrativeErrorLines({ error: unwrapErr(projectSupervisorNarrative({ window })) });

    expect(refusal).toContain(
      "t-1/ownerTurns.turns/0 is in the window and was neither rendered nor omitted — the page would not carry it.",
    );
  });

  it("marks every note holding recorded text as the quoted lane, and no other", () => {
    const window = windowOf({
      currentDay: [
        row({
          actions: [action({ id: "act-1" })],
          finalisedIso: "2026-09-15T03:00:00.000Z",
          judgements: [judgement({ claim: "a call nobody measured", id: "j-1" })],
          landings: [landing({ id: "l-1", number: 1 })],
          tickId: "t-1",
          turns: [turn({ line: 5, text: "ship it" })],
        }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.earlierToday.notes.map((note) => note.lane)).toEqual(["quoted", "quoted", "quoted", "quoted"]);
    expect(projected.recent.map((note) => note.lane)).toEqual([undefined]);
  });

  it("carries the owner's words through byte for byte, punctuation and all", () => {
    const exact = "leave <this> & that exactly as I typed it…";
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T03:00:00.000Z", tickId: "t-1", turns: [turn({ line: 5, text: exact })] }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(sectionText({ section: projected.earlierToday })).toContain(JSON.stringify(exact).slice(1, -1));
  });

  it("shows one turn once when two passes observed the same transcript line, and says how many it folded", () => {
    const same = turn({ line: 5, text: "ship it" });
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1", turns: [same] }),
        row({ finalisedIso: "2026-09-15T02:00:00.000Z", tickId: "t-2", turns: [same] }),
        row({ finalisedIso: "2026-09-15T03:00:00.000Z", tickId: "t-3", turns: [same] }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.receipt.omitted.length).toBe(2);
    expect(projected.receipt.omitted[0]!.reason).toBe("repeat-owner-turn");
    expect(projected.receipt.omitted[0]!.representedBy).toBe("t-1/ownerTurns.turns/0");
    expect(headlines({ notes: [projected.earlierToday.notes[1]!] })[0]).toContain(
      "1 thing(s) you said, 2 repeat observation(s) not shown again",
    );
  });

  it("renders every occurrence when a turn carries no transcript position to identify it by", () => {
    const anonymous = turn({ line: null, text: "said something" });
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1", turns: [anonymous] }),
        row({ finalisedIso: "2026-09-15T02:00:00.000Z", tickId: "t-2", turns: [anonymous] }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.receipt.omitted).toEqual([]);
    expect(projected.receipt.rendered.filter((ref) => ref.kind === "owner-turn").length).toBe(2);
  });

  it("refuses when one transcript position was recorded twice saying two different things", () => {
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1", turns: [turn({ line: 5, text: "ship it" })] }),
        row({
          finalisedIso: "2026-09-15T02:00:00.000Z",
          tickId: "t-2",
          turns: [turn({ line: 5, text: "do not ship it" })],
        }),
      ],
    });

    const refusal = narrativeErrorLines({ error: unwrapErr(projectSupervisorNarrative({ window })) });

    // The framing sentence is line one and every conflicting identity follows it, so the whole refusal is
    // what carries the pair of atoms — a reader has to be sent to both, not told one disagrees with something.
    expect(refusal[0]).toContain("the ledger disagrees with itself");
    expect(refusal.join(" ")).toContain("was recorded twice with different contents");
    expect(refusal.join(" ")).toContain("t-1/ownerTurns.turns/0");
    expect(refusal.join(" ")).toContain("t-2/ownerTurns.turns/0");
  });

  it("never folds two acts together, even when they are identical", () => {
    const window = windowOf({
      currentDay: [
        row({ actions: [action({ id: "act-1" })], finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1" }),
        row({ actions: [action({ id: "act-1" })], finalisedIso: "2026-09-15T02:00:00.000Z", tickId: "t-2" }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.receipt.rendered.filter((ref) => ref.kind === "action").length).toBe(2);
    expect(projected.receipt.omitted).toEqual([]);
  });

  it("labels every call as one, so a reader can tell it from a measurement", () => {
    const window = windowOf({
      currentDay: [
        row({
          finalisedIso: "2026-09-15T01:00:00.000Z",
          judgements: [judgement({ claim: "the pool exhausted because of the restart", id: "j-1" })],
          tickId: "t-1",
        }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(sectionText({ section: projected.earlierToday })).toContain("Judgement — ");
    expect(sectionText({ section: projected.earlierToday })).toContain("the pool exhausted because of the restart");
    expect(sectionText({ section: projected.earlierToday })).toContain("cross-source-inference");
  });

  it("renders prior days newest first and discloses what the window did not read", () => {
    const window = windowOf({
      currentDay: [row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-now" })],
      olderDaysOmitted: 9,
      priorDays: [
        { dayKey: "2026-09-14", ticks: [row({ finalisedIso: "2026-09-14T01:00:00.000Z", tickId: "t-14" })] },
        { dayKey: "2026-09-13", ticks: [row({ finalisedIso: "2026-09-13T01:00:00.000Z", tickId: "t-13" })] },
      ],
      ticksInLedger: 400,
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.history.map((section) => section.summary.slice(0, 10))).toEqual(["2026-09-14", "2026-09-13"]);
    expect(projected.history[1]!.summary).toContain("showing 3 of 400 recorded pass(es)");
    expect(projected.history[1]!.summary).toContain("9 older day(s) are not on this page");
    expect(projected.history[0]!.summary).not.toContain("older day(s)");
  });

  it("reports what it projected and what it left outside the window", () => {
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", tickId: "t-1", turns: [turn({ line: 1, text: "hi" })] }),
      ],
      olderDaysOmitted: 2,
      ticksInLedger: 50,
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(narrativeReceiptLines({ receipt: projected.receipt })).toEqual([
      "briefing render --ticks: projected 1 of 50 recorded pass(es); 49 older row(s) and 2 older day(s) are outside the window",
      "1 recorded thing(s) accounted for: 1 on the page, 0 repeat observation(s) pointing at one that is",
    ]);
  });
});

describe("the conservation check", () => {
  const window = windowOf({
    currentDay: [
      row({
        actions: [action({ id: "act-1" })],
        finalisedIso: "2026-09-15T01:00:00.000Z",
        tickId: "t-1",
        turns: [turn({ line: 1, text: "hi" })],
      }),
    ],
  });

  /** The receipt the real projection produced, which every case below then damages in one way. */
  function honest(): SupervisorNarrativeReceipt {
    return unwrap(projectSupervisorNarrative({ window })).receipt;
  }

  it("passes the receipt the projection actually produced", () => {
    const checked = unwrap(checkNarrativeConservation({ receipt: honest(), window }));

    expect(checked.rendered.length).toBe(2);
  });

  it("refuses a receipt that rendered nothing for an atom the window holds", () => {
    const receipt = { ...honest(), rendered: [] };

    const refusal = narrativeErrorLines({ error: unwrapErr(checkNarrativeConservation({ receipt, window })) });

    expect(refusal).toContain(
      "t-1/ownerTurns.turns/0 is in the window and was neither rendered nor omitted — the page would not carry it.",
    );
  });

  it("refuses a receipt that accounted for one atom twice", () => {
    const base = honest();
    const receipt = { ...base, rendered: [...base.rendered, base.rendered[0]!] };

    const refusal = narrativeErrorLines({ error: unwrapErr(checkNarrativeConservation({ receipt, window })) });

    expect(refusal).toContain("t-1/ownerTurns.turns/0 was accounted for 2 times; every atom is accounted for once.");
  });

  it("refuses a receipt naming an atom the window does not hold", () => {
    const base = honest();
    const receipt = { ...base, rendered: [...base.rendered, { key: "t-9/actions/4", kind: "action" as const }] };

    const refusal = narrativeErrorLines({ error: unwrapErr(checkNarrativeConservation({ receipt, window })) });

    expect(refusal).toContain("t-9/actions/4 was accounted for but is not in the window at all.");
  });

  it("refuses an omitted act, whatever reason it carries", () => {
    const base = honest();
    const receipt = {
      ...base,
      omitted: [
        {
          reason: "repeat-landing" as const,
          ref: { key: "t-1/actions/0", kind: "action" as const },
          representedBy: "t-1/ownerTurns.turns/0",
        },
      ],
      rendered: base.rendered.filter((ref) => ref.kind !== "action"),
    };

    const refusal = narrativeErrorLines({ error: unwrapErr(checkNarrativeConservation({ receipt, window })) });

    expect(refusal).toContain("t-1/actions/0 is an action and was omitted; those are never omitted.");
  });

  it("refuses an omission pointing at an atom that is not on the page", () => {
    const base = honest();
    const receipt = {
      ...base,
      omitted: [
        {
          reason: "repeat-owner-turn" as const,
          ref: { key: "t-1/ownerTurns.turns/0", kind: "owner-turn" as const },
          representedBy: "t-404/ownerTurns.turns/0",
        },
      ],
      rendered: base.rendered.filter((ref) => ref.kind !== "owner-turn"),
    };

    const refusal = narrativeErrorLines({ error: unwrapErr(checkNarrativeConservation({ receipt, window })) });

    expect(refusal).toContain(
      "t-1/ownerTurns.turns/0 says it is represented by t-404/ownerTurns.turns/0, which was not rendered.",
    );
  });
});

describe("the two holes a review pass found", () => {
  it("keeps the NEWEST observation of a landing, so `recent` and the dedup agree about which atom is on the page", () => {
    // Both passes saw the same landing. `recent` renders the NEWEST pass's copy, so that is the one the
    // dedup has to keep — preferring the earliest made `recent` render an atom the receipt called omitted,
    // which is double-accounting and refused the whole page.
    const same = landing({ id: "l-1", number: 1 });
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", landings: [same], tickId: "t-1" }),
        row({ finalisedIso: "2026-09-15T02:00:00.000Z", landings: [same], tickId: "t-2" }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    expect(projected.recent.length).toBe(1);
    expect(projected.receipt.omitted).toEqual([
      {
        reason: "repeat-landing",
        ref: { key: "t-1/sources.landings.facts.landings/0", kind: "landing" },
        representedBy: "t-2/sources.landings.facts.landings/0",
      },
    ]);
    expect(projected.receipt.rendered.filter((ref) => ref.kind === "landing")).toEqual([
      { key: "t-2/sources.landings.facts.landings/0", kind: "landing" },
    ]);
  });

  it("does not show one landing twice when an older pass saw it too", () => {
    const same = landing({ id: "l-1", number: 1 });
    const window = windowOf({
      currentDay: [
        row({ finalisedIso: "2026-09-15T01:00:00.000Z", landings: [same], tickId: "t-1" }),
        row({ finalisedIso: "2026-09-15T02:00:00.000Z", landings: [same], tickId: "t-2" }),
      ],
    });

    const projected = unwrap(projectSupervisorNarrative({ window }));

    // Four notes would mean a landings note beside `recent` carrying the same thing again.
    expect(projected.earlierToday.notes.length).toBe(2);
  });
});
