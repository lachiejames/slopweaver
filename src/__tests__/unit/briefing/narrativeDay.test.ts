/**
 * One recorded day as one briefing section: which notes appear, in what order, what each says above the fold,
 * and which atoms the section reports it rendered.
 *
 * Every fixture is a fully typed tick row; nothing is cast, so a field the projection reads cannot be missing
 * from the fixture without the compiler saying so.
 */
import { describe, expect, it } from "vitest";

import type { NarrativeAtomRef, PlacedLanding, PlacedTurn } from "../../../briefing/narrative.js";
import {
  count,
  type DayInput,
  landingContent,
  type PlacedAction,
  type PlacedJudgement,
  projectDay,
  say,
} from "../../../briefing/narrativeDay.js";
import { narrativeSourceLines } from "../../../briefing/narrativeSources.js";
import { textOfContent } from "../../../outbound/briefing/vocabulary.js";
import {
  type FleetLanding,
  type OwnerTurnSnapshot,
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorOwnerTurn,
  type SupervisorTickRow,
  type SupervisorTickSources,
} from "../../../supervisor/tickTypes.js";

const OBSERVED = "2026-09-15T00:59:00.000Z";

/** One source the fixture did not read. */
function quiet({ kind }: { kind: string }): {
  readonly diagnostic: string;
  readonly observedAtIso: string;
  readonly status: "unavailable";
  readonly witness: { readonly command: string; readonly exitCode: null };
} {
  return {
    diagnostic: `${kind} was not read by this fixture`,
    observedAtIso: OBSERVED,
    status: "unavailable",
    witness: { command: `slopweaver ${kind}`, exitCode: null },
  };
}

/** All twelve sources, none read. */
const SOURCES: SupervisorTickSources = {
  capacity: quiet({ kind: "capacity" }),
  closeDone: quiet({ kind: "closeDone" }),
  depth: quiet({ kind: "depth" }),
  friction: quiet({ kind: "friction" }),
  gauge: quiet({ kind: "gauge" }),
  github: quiet({ kind: "github" }),
  landings: quiet({ kind: "landings" }),
  listener: quiet({ kind: "listener" }),
  recipeDue: quiet({ kind: "recipeDue" }),
  reconcile: quiet({ kind: "reconcile" }),
  velocity: quiet({ kind: "velocity" }),
  watch: quiet({ kind: "watch" }),
};

/** One finalised tick row carrying the given owner-turn read. */
function row({
  tickId,
  finalisedIso,
  ownerTurns,
}: {
  tickId: string;
  finalisedIso: string;
  ownerTurns: OwnerTurnSnapshot;
}): SupervisorTickRow {
  return {
    actions: [],
    finalisedIso,
    handoff: "handoff-9260",
    judgements: [],
    ownerTurns,
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    sources: SOURCES,
    startedIso: OBSERVED,
    stats: { judgementCount: 0, judgementUtf8Bytes: 0, structuredUtf8Bytes: 0 },
    tickId,
    workspace: "workspace:61",
  };
}

const COVERAGE = { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] } as const;

/** One turn of the owner's, with or without a recorded instant and transcript position. */
function turn({
  text,
  instantIso,
  line,
}: {
  text: string;
  instantIso: string | null;
  line: number | null;
}): SupervisorOwnerTurn {
  return {
    inGrace: false,
    instantIso,
    lockIn: null,
    lockInLink: "none",
    pointer: "transcript:session-a#uuid-1",
    sessionId: "session-a",
    source: "transcript",
    text,
    transcriptLineNumber: line,
    turnUuid: "uuid-1",
    witness: null,
  };
}

const PR_LANDING: FleetLanding = {
  kind: "pull-request",
  landedAtIso: "2026-09-15T03:00:00.000Z",
  landingId: "l-1",
  mergeCommitSha: "abc1234",
  number: 12,
  repo: "acme/slopweaver",
  title: "fix the gate",
  url: "https://github.com/acme/slopweaver/pull/12",
};

const HANDOVER_LANDING: FleetLanding = {
  kind: "handover",
  label: "the canon sweep",
  landedAtIso: "2026-09-15T04:00:00.000Z",
  landingId: "l-2",
  slug: "canon-sweep",
  witness: "def5678",
};

const MINIMAL_TICK = row({
  finalisedIso: "2026-09-15T01:00:00.000Z",
  ownerTurns: { diagnostic: "no supervisor pin", sinceIso: null, status: "unavailable", turns: [] },
  tickId: "t1",
});

/** A day carrying nothing but the one quiet tick, overridden per case. */
function dayOf({ over }: { over: Partial<DayInput> }): DayInput {
  return {
    actions: [],
    dayKey: "2026-09-15",
    inRecent: new Set<string>(),
    judgements: [],
    landings: [],
    ticks: [MINIMAL_TICK],
    tail: undefined,
    turns: [],
    turnsOmittedHere: 0,
    ...over,
  };
}

describe("say and count", () => {
  it("make one text run and print a number as digits", () => {
    expect(say({ text: "hello" })).toEqual({ kind: "text", text: "hello" });
    expect(count({ value: 0 })).toBe("0");
    expect(count({ value: 42 })).toBe("42");
  });
});

describe("landingContent", () => {
  it("renders a pull request as a link, its landing instant and its merge commit", () => {
    expect(landingContent({ landing: PR_LANDING })).toEqual([
      {
        kind: "link",
        text: "acme/slopweaver#12 fix the gate",
        url: "https://github.com/acme/slopweaver/pull/12",
      },
      { kind: "text", text: " landed 2026-09-15T03:00:00.000Z, merge " },
      { kind: "code", text: "abc1234" },
    ]);
  });

  it("renders a handover as its label, slug, instant and witness", () => {
    expect(landingContent({ landing: HANDOVER_LANDING })).toEqual([
      { kind: "text", text: "the canon sweep (canon-sweep) finished 2026-09-15T04:00:00.000Z, witness " },
      { kind: "code", text: "def5678" },
    ]);
  });
});

describe("projectDay — a quiet day", () => {
  it("still carries the sources and owner-words notes, renders no atom, and appends the tail", () => {
    const { section, rendered } = projectDay({ input: dayOf({ over: { tail: "older days were not read" } }) });
    expect(rendered).toEqual([]);
    expect(section.summary).toBe("2026-09-15 — 1 recorded pass(es); older days were not read");
    expect(section.notes.map((note) => textOfContent({ content: note.headline }))).toEqual([
      "0 of 12 sources read, 0 read in part, 12 not read at all, as of 2026-09-15T01:00:00.000Z",
      "0 thing(s) you said, 0 repeat observation(s) not shown again; 0 read, 0 read in part, 1 not read",
    ]);
    expect(section.notes[0]!.detail).toEqual({
      blocks: [
        {
          items: narrativeSourceLines({ sources: SOURCES }).map((line) => line.content),
          kind: "list",
          ordered: false,
        },
      ],
      summary: "every reading, in the order they were taken",
    });
    expect(section.notes[1]!).toEqual({
      detail: {
        blocks: [
          { items: [[{ kind: "text", text: "nothing was recorded from you this day" }]], kind: "list", ordered: false },
          { content: [{ kind: "text", text: "what the reads could not reach: no supervisor pin" }], kind: "para" },
        ],
        summary: "each one, exactly as you typed it",
      },
      headline: [
        {
          kind: "text",
          text: "0 thing(s) you said, 0 repeat observation(s) not shown again; 0 read, 0 read in part, 1 not read",
        },
      ],
      lane: "quoted",
    });
  });
});

describe("projectDay — a full day", () => {
  const dated = turn({ instantIso: "2026-09-15T01:30:00.000Z", line: 7, text: "ship the canon fix" });
  const undated = turn({ instantIso: null, line: null, text: "and hold the rest" });
  const turns: readonly PlacedTurn[] = [
    { ref: { key: "t2/turns/0", kind: "owner-turn" }, turn: dated },
    { ref: { key: "t2/turns/1", kind: "owner-turn" }, turn: undated },
  ];
  const landings: readonly PlacedLanding[] = [
    { landing: PR_LANDING, ref: { key: "t2/landings/0", kind: "landing" } },
    { landing: HANDOVER_LANDING, ref: { key: "t2/landings/1", kind: "landing" } },
  ];
  const actions: readonly PlacedAction[] = [
    {
      action: {
        actionId: "a-1",
        detail: "rebased first",
        kind: "enqueued",
        outcome: "completed",
        recordedIso: "2026-09-15T02:00:00.000Z",
        subject: { id: "acme/slopweaver#9", kind: "pull-request", label: "the canon fix" },
        witness: { kind: "command", ref: "slopweaver github enqueue" },
      },
      ref: { key: "t2/actions/0", kind: "action" },
    },
  ];
  const judgements: readonly PlacedJudgement[] = [
    {
      judgement: {
        claim: "the seat stalled on the cap",
        judgementId: "j-1",
        kind: "hold-rationale",
        recordedIso: "2026-09-15T02:05:00.000Z",
        subject: { id: "workspace:61", kind: "session", label: "the supervisor's own chat" },
        whyNotDerived: "risk-call",
        witness: { kind: "ledger", ref: "supervisor-ticks.jsonl" },
      },
      ref: { key: "t2/judgements/0", kind: "judgement" },
    },
  ];
  const ticks = [
    row({
      finalisedIso: "2026-09-15T01:00:00.000Z",
      ownerTurns: {
        coverage: COVERAGE,
        diagnostic: "one link unreadable",
        sinceIso: null,
        status: "partial",
        turns: [],
      },
      tickId: "t1",
    }),
    row({
      finalisedIso: "2026-09-15T05:00:00.000Z",
      ownerTurns: { coverage: COVERAGE, sinceIso: null, status: "read", turns: [dated, undated] },
      tickId: "t2",
    }),
  ];
  const { section, rendered } = projectDay({
    input: dayOf({
      over: {
        actions,
        inRecent: new Set(["t2/landings/1"]),
        judgements,
        landings,
        ticks,
        turns,
        turnsOmittedHere: 3,
      },
    }),
  });

  it("carries all five notes in their fixed order, counting only landings recent does not show", () => {
    expect(section.summary).toBe("2026-09-15 — 2 recorded pass(es)");
    expect(section.notes.map((note) => textOfContent({ content: note.headline }))).toEqual([
      "0 of 12 sources read, 0 read in part, 12 not read at all, as of 2026-09-15T05:00:00.000Z",
      "2 thing(s) you said, 3 repeat observation(s) not shown again; 1 read, 1 read in part, 0 not read",
      "1 other thing(s) landed on this day",
      "1 thing(s) done on this day",
      "1 call(s) made on this day that no reading produced — " +
        "a call is a conclusion drawn across sources rather than something one of them said",
    ]);
  });

  it("reports every rendered atom and leaves out the landing recent already shows", () => {
    const expected: readonly NarrativeAtomRef[] = [
      { key: "t2/turns/0", kind: "owner-turn" },
      { key: "t2/turns/1", kind: "owner-turn" },
      { key: "t2/landings/0", kind: "landing" },
      { key: "t2/actions/0", kind: "action" },
      { key: "t2/judgements/0", kind: "judgement" },
    ];
    expect(rendered).toEqual(expected);
  });

  it("opens each turn with its instant and position, or the phrase for one recorded without them", () => {
    expect(section.notes[1]!.detail!.blocks).toEqual([
      {
        items: [
          [
            { kind: "text", text: "2026-09-15T01:30:00.000Z · session-a · line 7 · via transcript — " },
            { kind: "text", text: "ship the canon fix" },
          ],
          [
            { kind: "text", text: "no instant recorded · session-a · no transcript position · via transcript — " },
            { kind: "text", text: "and hold the rest" },
          ],
        ],
        kind: "list",
        ordered: false,
      },
      { content: [{ kind: "text", text: "what the reads could not reach: one link unreadable" }], kind: "para" },
    ]);
  });

  it("renders the landing, the action with its detail, and the labelled judgement in full", () => {
    expect(section.notes[2]!.detail!.blocks).toEqual([
      { items: [landingContent({ landing: PR_LANDING })], kind: "list", ordered: false },
    ]);
    expect(section.notes[3]!.detail!.blocks).toEqual([
      {
        items: [
          [
            {
              kind: "text",
              text:
                "enqueued on the canon fix (pull-request acme/slopweaver#9) — completed at " +
                "2026-09-15T02:00:00.000Z; rebased first · witness command ",
            },
            { kind: "code", text: "slopweaver github enqueue" },
          ],
        ],
        kind: "list",
        ordered: false,
      },
    ]);
    expect(section.notes[4]!.detail!.blocks).toEqual([
      {
        items: [
          [
            { kind: "strong", text: "Judgement — " },
            {
              kind: "text",
              text:
                "the seat stalled on the cap (hold-rationale on the supervisor's own chat, session workspace:61); " +
                "not measured because risk-call; recorded 2026-09-15T02:05:00.000Z · witness ledger ",
            },
            { kind: "code", text: "supervisor-ticks.jsonl" },
          ],
        ],
        kind: "list",
        ordered: false,
      },
    ]);
  });
});
