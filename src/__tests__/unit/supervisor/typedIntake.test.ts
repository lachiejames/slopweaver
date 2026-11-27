import { describe, expect, it } from "vitest";

import { EMPTY_INBOUND } from "../../../supervisor/inbound.js";
import {
  type IntakeMark,
  type IntakeReport,
  intakeClause,
  type RowAnchors,
  witnessTurns,
} from "../../../supervisor/intake.js";
import {
  coveredEvents,
  newlyObserved,
  parseTypedIntakeLine,
  pendingTypedTurns,
  type TypedIntakeEvent,
  typedDiscoveryFloor,
  typedRegisterCommandFor,
  witnessTypedTurns,
} from "../../../supervisor/typedIntake.js";
import { typedIntakeSentence } from "../../../supervisor/typedIntakeSentence.js";
import type { TypedOwnerTurnCandidate } from "../../../talk/typedOwnerIntake.js";

const POINTER = "talk-call:a0000035-0000-4000-8000-0000000000a1#typed-owner-aaaa";
const OTHER = "talk-call:a0000035-0000-4000-8000-0000000000a1#typed-owner-bbbb";
const TURN_ID = "c0ffee00-0000-4000-8000-000000000001";
const RELAY_SLUG = "talk-c0ffee000000";
const TURN_AT = "2026-11-27T01:00:00.000Z";
const LATER = "2026-11-27T02:00:00.000Z";

/** One pending turn, with the relay anchors given. */
function candidate({ relayAnchors = [] }: { relayAnchors?: readonly string[] } = {}): TypedOwnerTurnCandidate {
  return { pointer: POINTER, relayAnchors, timestamp: TURN_AT };
}

/** A board row with the pointer-bearing fields given. */
function row({
  slug,
  anchor,
  settlementWitness,
}: {
  slug: string;
  anchor?: string;
  settlementWitness?: string;
}): RowAnchors {
  return { anchor, settlementWitness, slug };
}

/** One judgement of one pending turn. */
function judge({
  turn = candidate(),
  rows = [],
  marks = [],
  nowIso = LATER,
}: {
  turn?: TypedOwnerTurnCandidate;
  rows?: readonly RowAnchors[];
  marks?: readonly IntakeMark[];
  nowIso?: string;
}) {
  return witnessTypedTurns({ discoveredFromIso: TURN_AT, marks, nowIso, rows, turns: [turn], unreadable: [] });
}

describe("witnessTypedTurns — the chair's four cases", () => {
  it("is witnessed by a row anchored at the turn's talk-call pointer", () => {
    const finding = judge({ rows: [row({ anchor: POINTER, slug: "fix-the-button" })] });
    expect(finding.turns.map((item) => item.witness)).toEqual([{ kind: "row", witness: "fix-the-button" }]);
    expect(finding.unwitnessed).toEqual([]);
    expect(finding.witnessed).toBe(1);
  });

  it("is witnessed by the relay row registered off the stretch, and only when that row's anchor mints its slug", () => {
    const turn = candidate({ relayAnchors: [`talk:${TURN_ID}`] });
    const witnessed = judge({ rows: [row({ anchor: `talk:${TURN_ID}`, slug: RELAY_SLUG })], turn });
    const squatted = judge({ rows: [row({ anchor: "talk:not-a-uuid", slug: RELAY_SLUG })], turn });
    expect(witnessed.turns.map((item) => item.witness)).toEqual([{ kind: "row", witness: RELAY_SLUG }]);
    expect(squatted.unwitnessed).toEqual([{ pointer: POINTER, timestamp: TURN_AT }]);
  });

  it("is not witnessed by another relay's row that shares its twelve-character slug", () => {
    const sibling = "c0ffee00-0000-4aaa-8aaa-aaaaaaaaaaaa";
    expect(RELAY_SLUG).toBe(`talk-${sibling.replaceAll("-", "").slice(0, 12)}`);
    const turn = candidate({ relayAnchors: [`talk:${TURN_ID}`] });
    const finding = judge({ rows: [row({ anchor: `talk:${sibling}`, slug: RELAY_SLUG })], turn });
    expect(finding.unwitnessed).toEqual([{ pointer: POINTER, timestamp: TURN_AT }]);
  });

  it("is witnessed by an intake mark naming a row slug, without the turn's words anywhere", () => {
    const mark: IntakeMark = {
      byClaudeSessionId: "synthetic-session",
      kind: "answered",
      markedAtIso: LATER,
      pointer: POINTER,
      witness: "fix-the-button",
    };
    const finding = judge({ marks: [mark] });
    expect(finding.turns.map((item) => item.witness)).toEqual([{ kind: "answered", witness: "fix-the-button" }]);
    expect(finding.unwitnessed).toEqual([]);
  });

  it("fires the clause when none of the three covers it, by count and never by quote", () => {
    const finding = judge({ rows: [row({ anchor: OTHER, slug: "another-turn" })] });
    expect(finding.unwitnessed).toEqual([{ pointer: POINTER, timestamp: TURN_AT }]);
    expect(typedIntakeSentence({ report: { finding, kind: "read" } })).toBe(
      "1 typed console turn(s) have no row or card.",
    );
    expect(typedRegisterCommandFor({ turn: finding.unwitnessed[0]! })).toBe(
      `slopweaver handover register --ask "Private console turn" --anchor ${POINTER}`,
    );
  });
});

describe("witnessTypedTurns — grace, settlement and precedence", () => {
  it("holds an unwitnessed turn younger than grace in grace", () => {
    const finding = judge({ nowIso: "2026-11-27T01:05:00.000Z" });
    expect([finding.inGrace, finding.unwitnessed.length]).toEqual([1, 0]);
  });

  it("is witnessed by a row settled with the turn's pointer", () => {
    const finding = judge({ rows: [row({ settlementWitness: POINTER, slug: "answered-row" })] });
    expect(finding.turns.map((item) => item.witness)).toEqual([{ kind: "settlement", witness: "answered-row" }]);
  });

  it("counts a no-ask mark apart from the witnessed", () => {
    const mark: IntakeMark = {
      byClaudeSessionId: "synthetic-session",
      kind: "no-ask",
      markedAtIso: LATER,
      pointer: POINTER,
      witness: "a thank-you",
    };
    const finding = judge({ marks: [mark] });
    expect([finding.markedNoAsk, finding.witnessed]).toEqual([1, 0]);
  });
});

describe("the ledger: a turn past the window is still owed", () => {
  it("keeps an observed turn pending, whatever the window, until a covered line clears it", () => {
    const observed: TypedIntakeEvent[] = [...newlyObserved({ candidates: [candidate()], events: [] })];
    const aWeekLater = "2026-12-04T01:00:00.000Z";
    const pending = pendingTypedTurns({ events: observed });
    const finding = witnessTypedTurns({
      discoveredFromIso: "2026-12-03T01:00:00.000Z",
      marks: [],
      nowIso: aWeekLater,
      rows: [],
      turns: pending,
      unreadable: [],
    });
    expect(finding.unwitnessed).toEqual([{ pointer: POINTER, timestamp: TURN_AT }]);
    const witnessed = judge({ rows: [row({ anchor: POINTER, slug: "fix-the-button" })] });
    const cleared = [...observed, ...coveredEvents({ finding: witnessed, nowIso: aWeekLater })];
    expect(pendingTypedTurns({ events: cleared })).toEqual([]);
  });

  it("round-trips through the ledger text, a successor chair reading what the last one wrote", () => {
    const events: TypedIntakeEvent[] = [
      { kind: "scanned", throughIso: LATER },
      ...newlyObserved({ candidates: [candidate({ relayAnchors: [`talk:${TURN_ID}`] })], events: [] }),
    ];
    const lines = [...events.map((event) => JSON.stringify(event)), "not json", '{"kind":"observed","pointer":"x"}'];
    expect(lines.map((line) => parseTypedIntakeLine({ line }))).toEqual([...events, undefined, undefined]);
  });

  it("adds an observed line only for a new turn or one whose relay anchors grew", () => {
    const first = newlyObserved({ candidates: [candidate()], events: [] });
    const again = newlyObserved({ candidates: [candidate()], events: first });
    const grew = newlyObserved({ candidates: [candidate({ relayAnchors: [`talk:${TURN_ID}`] })], events: first });
    expect([first.length, again.length, grew.length]).toEqual([1, 0, 1]);
    expect(pendingTypedTurns({ events: [...first, ...grew] })).toEqual([
      { pointer: POINTER, relayAnchors: [`talk:${TURN_ID}`], timestamp: TURN_AT },
    ]);
  });
});

describe("typedDiscoveryFloor", () => {
  const now = "2026-11-27T12:00:00.000Z";

  const justScanned: TypedIntakeEvent[] = [{ kind: "scanned", throughIso: now }];

  it("reads from the bootstrap instant while no scan has completed, however late the first read", () => {
    const firstRead = typedDiscoveryFloor({ events: [], nowIso: now, sinceIso: undefined });
    const monthLater = typedDiscoveryFloor({ events: [], nowIso: "2026-12-27T12:00:00.000Z", sinceIso: undefined });
    expect([firstRead, monthLater]).toEqual(["2026-11-20T00:00:00.000Z", "2026-11-20T00:00:00.000Z"]);
  });

  it("reads the sweep window once a scan has just completed", () => {
    expect(typedDiscoveryFloor({ events: justScanned, nowIso: now, sinceIso: undefined })).toBe(
      "2026-11-26T12:00:00.000Z",
    );
  });

  it("reads back to an hour before the last scan when the chair slept past the window", () => {
    const events: TypedIntakeEvent[] = [{ kind: "scanned", throughIso: "2026-11-20T12:00:00.000Z" }];
    expect(typedDiscoveryFloor({ events, nowIso: now, sinceIso: undefined })).toBe("2026-11-20T11:00:00.000Z");
  });

  it("widens to an earlier --since and is never narrowed by a later one", () => {
    expect(typedDiscoveryFloor({ events: justScanned, nowIso: now, sinceIso: "2026-11-25T00:00:00.000Z" })).toBe(
      "2026-11-25T00:00:00.000Z",
    );
    expect(typedDiscoveryFloor({ events: justScanned, nowIso: now, sinceIso: "2026-11-27T11:00:00.000Z" })).toBe(
      "2026-11-26T12:00:00.000Z",
    );
  });
});

describe("typedIntakeSentence", () => {
  it("says nothing for an excluded or absent half, and names an unreadable one", () => {
    expect([
      typedIntakeSentence({ report: undefined }),
      typedIntakeSentence({ report: { kind: "excluded", why: "--session" } }),
      typedIntakeSentence({ report: { kind: "unavailable", why: "ledger unreadable" } }),
    ]).toEqual(["", "", "Typed console turns unread: ledger unreadable."]);
  });

  it("follows the chair half's sentence in the intake clause, and changes nothing when that half is clean", () => {
    const chair = witnessTurns({
      coverage: { earliestIso: TURN_AT, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["s"] },
      legs: [{ fromIso: TURN_AT, sessionId: "s", turns: 0 }],
      marks: [],
      nowIso: LATER,
      rows: [],
      sinceIso: undefined,
      turns: [],
    });
    const base: IntakeReport = { finding: chair, inbound: EMPTY_INBOUND, kind: "read" };
    const owed = judge({});
    const clean = judge({ rows: [row({ anchor: POINTER, slug: "fix-the-button" })] });
    expect(intakeClause({ report: { ...base, typed: { finding: owed, kind: "read" } } })).toBe(
      "Owner turns: 0 read across 1 supervisor session(s), all witnessed. 1 typed console turn(s) have no row or card.",
    );
    expect(intakeClause({ report: { ...base, typed: { finding: clean, kind: "read" } } })).toBe(
      intakeClause({ report: base }),
    );
  });
});
