import { describe, expect, it } from "vitest";

import { type ChainCoverage } from "../../../supervisor/chain.js";
import {
  INTAKE_GRACE_MS,
  type IntakeMark,
  type OwnerTurn,
  registerCommandFor,
  rowWitnesses,
  witnessTurns,
} from "../../../supervisor/intake.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";
import { chairWakeLine } from "../../../talk/chairWake.js";

const SESSION = "a0000013-0000-4000-8000-000000000014";
const NOW = "2026-09-02T17:00:00.000Z";
/** A Codex thread, and a rollout pointer at one of its owner turns. */
const THREAD = "a0000013-0000-4000-8000-0000000000c1";
const ROLLOUT_POINTER = `codex-rollout:${THREAD}#rollout-2026-09-02T09-00-00-${THREAD}.jsonl@120`;

/** A turn typed `minutesAgo` minutes before {@link NOW}. */
const turn = ({
  uuid,
  minutesAgo,
  text = "do the thing",
}: {
  uuid: string;
  minutesAgo: number;
  text?: string;
}): OwnerTurn => ({
  lineNumber: 1,
  pointer: `transcript:${SESSION}#${uuid}`,
  sessionId: SESSION,
  source: "typed",
  text,
  timestamp: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(),
  turnUuid: uuid,
});

/** One session walked, reaching the whole window — the shape every `witnessTurns` case here stands on. */
const COVERED: ChainCoverage = {
  earliestIso: "2026-09-02T09:00:00.000Z",
  linksKnown: 1,
  reachesSince: true,
  unreadable: [],
  walked: [SESSION],
};

/** The one leg those cases read from. */
const LEGS = [{ fromIso: COVERED.earliestIso, sessionId: SESSION, turns: 1 }];

const U1 = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";
const U2 = "5863a44b-2326-4b7e-bb5c-52f47acb42a9";
const U3 = "6abc179e-8ed6-40b7-9465-cb6c69c929f6";

const mark = (over: Partial<IntakeMark> & { pointer: string }): IntakeMark => ({
  byClaudeSessionId: SESSION,
  kind: "card",
  markedAtIso: NOW,
  witness: "Merge #403 tonight?",
  ...over,
});

describe("rowWitnesses", () => {
  it("lets a board row anchored at a Codex rollout turn witness that turn", () => {
    const witnesses = rowWitnesses({
      rows: [{ anchor: ROLLOUT_POINTER, settlementWitness: undefined, slug: "a-row" }],
    });

    expect([...witnesses]).toEqual([[ROLLOUT_POINTER, { kind: "row", witness: "a-row" }]]);
  });

  it("reads a row's anchor as a row witness and a settlement pointer as a settlement witness", () => {
    const witnesses = rowWitnesses({
      rows: [
        { anchor: `transcript:${SESSION}#${U1}`, settlementWitness: undefined, slug: "the-ask" },
        {
          anchor: "https://example.slack.com/archives/C1/p1788220579306599",
          settlementWitness: `transcript:${SESSION}#${U2}`,
          slug: "answered-ask",
        },
      ],
    });

    expect(witnesses.get(`transcript:${SESSION}#${U1}`)).toEqual({ kind: "row", witness: "the-ask" });
    expect(witnesses.get(`transcript:${SESSION}#${U2}`)).toEqual({ kind: "settlement", witness: "answered-ask" });
    expect(witnesses.size).toBe(2);
  });
});

describe("witnessTurns", () => {
  it("calls a turn past the grace window with nothing pointing at it unwitnessed — the measured drop", () => {
    const finding = witnessTurns({
      marks: [],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [turn({ minutesAgo: 100, uuid: U1 })],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
    expect(finding.inGrace).toBe(0);
    expect(finding.witnessed).toBe(0);
    expect(finding.turns[0]!.witness).toBeUndefined();
  });

  it("holds a turn younger than one sweep tick in grace rather than counting it", () => {
    const finding = witnessTurns({
      marks: [],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [turn({ minutesAgo: INTAKE_GRACE_MS / 60_000 - 1, uuid: U1 })],
    });

    expect(finding.unwitnessed).toEqual([]);
    expect(finding.inGrace).toBe(1);
    expect(finding.turns[0]!.inGrace).toBe(true);
  });

  it("never holds a turn with no readable instant in grace", () => {
    const finding = witnessTurns({
      marks: [],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [{ ...turn({ minutesAgo: 0, uuid: U1 }), timestamp: "" }],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
  });

  it("lets a board row outrank a ledger mark for the same turn, and counts no-ask apart from witnessed", () => {
    const finding = witnessTurns({
      marks: [
        mark({ kind: "no-ask", pointer: `transcript:${SESSION}#${U1}`, witness: "brief me" }),
        mark({ kind: "no-ask", pointer: `transcript:${SESSION}#${U2}`, witness: "just a thanks" }),
        mark({ kind: "card", pointer: `transcript:${SESSION}#${U3}` }),
      ],
      nowIso: NOW,
      rows: [{ anchor: `transcript:${SESSION}#${U1}`, settlementWitness: undefined, slug: "the-ask" }],
      coverage: COVERED,
      legs: LEGS,
      sinceIso: "2026-09-02T14:00:00.000Z",
      turns: [
        turn({ minutesAgo: 90, uuid: U1 }),
        turn({ minutesAgo: 80, uuid: U2 }),
        turn({ minutesAgo: 70, uuid: U3 }),
      ],
    });

    expect(finding.turns.map((item) => item.witness)).toEqual([
      { kind: "row", witness: "the-ask" },
      { kind: "no-ask", witness: "just a thanks" },
      { kind: "card", witness: "Merge #403 tonight?" },
    ]);
    expect(finding.unwitnessed).toEqual([]);
    expect(finding.markedNoAsk).toBe(1);
    expect(finding.witnessed).toBe(2);
    expect(finding.sinceIso).toBe("2026-09-02T14:00:00.000Z");
  });

  it("takes the LAST mark for a turn, so a later mark corrects an earlier one", () => {
    const finding = witnessTurns({
      marks: [
        mark({ kind: "no-ask", pointer: `transcript:${SESSION}#${U1}`, witness: "first reading" }),
        mark({ kind: "answered", pointer: `transcript:${SESSION}#${U1}`, witness: "run:trace-16658" }),
      ],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [turn({ minutesAgo: 90, uuid: U1 })],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "answered", witness: "run:trace-16658" });
    expect(finding.markedNoAsk).toBe(0);
  });

  it("never lets one string spread across many turns mask the specific carrier a turn already had — the 183-turn burst", () => {
    const BULK = "loop report from live-bot-loop-21sep-c-a4, acted on at the tick it arrived";
    const bulk = ["a", "b", "c", "d"].map((n) =>
      mark({
        kind: "answered",
        pointer: `transcript:${SESSION}#0a335102-005d-4f3d-a2e3-cbbf3fd794c${n}`,
        witness: BULK,
      }),
    );
    const finding = witnessTurns({
      marks: [
        mark({ kind: "answered", pointer: `transcript:${SESSION}#${U1}`, witness: "291-53 keep it freeform" }),
        mark({ kind: "answered", pointer: `transcript:${SESSION}#${U1}`, witness: BULK }),
        ...bulk,
      ],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [
        turn({ minutesAgo: 90, uuid: U1 }),
        turn({ minutesAgo: 90, uuid: "0a335102-005d-4f3d-a2e3-cbbf3fd794ca" }),
      ],
    });

    expect(finding.turns.map((item) => item.witness)).toEqual([
      { kind: "answered", witness: "291-53 keep it freeform" },
      { kind: "answered", witness: BULK },
    ]);
  });

  it("never lets later free text mask an earlier mark naming a row on the board", () => {
    const finding = witnessTurns({
      marks: [
        mark({ kind: "card", pointer: `transcript:${SESSION}#${U1}`, witness: "the-ask" }),
        mark({ kind: "answered", pointer: `transcript:${SESSION}#${U1}`, witness: "handled at the tick" }),
      ],
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [{ anchor: undefined, settlementWitness: undefined, slug: "the-ask" }],
      sinceIso: undefined,
      turns: [turn({ minutesAgo: 90, uuid: U1 })],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "card", witness: "the-ask" });
  });
});

describe("witnessTurns on a Codex chair's owner turn", () => {
  const TURN_ID = "turn-120";
  /** The Codex chair's turn at {@link ROLLOUT_POINTER}, typed 90 minutes before {@link NOW}. */
  const codexTurn: OwnerTurn = {
    lineNumber: 2,
    pointer: ROLLOUT_POINTER,
    sessionId: `codex:${THREAD}`,
    source: "unknown",
    text: "do the thing",
    timestamp: "2026-09-02T15:30:00.000Z",
    turnUuid: TURN_ID,
  };
  const judge = ({
    marks = [],
    rows = [],
    turns = [codexTurn],
  }: {
    marks?: readonly IntakeMark[];
    rows?: Parameters<typeof witnessTurns>[0]["rows"];
    turns?: readonly OwnerTurn[];
  }): ReturnType<typeof witnessTurns> =>
    witnessTurns({ coverage: COVERED, legs: LEGS, marks, nowIso: NOW, rows, sinceIso: undefined, turns });

  it("witnesses it by a mark its own thread wrote at the rollout pointer", () => {
    const finding = judge({
      marks: [
        mark({
          byClaudeSessionId: "",
          bySession: { host: "codex", id: THREAD },
          kind: "answered",
          pointer: ROLLOUT_POINTER,
          witness: "merged it",
        }),
      ],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "answered", witness: "merged it" });
    expect(finding.witnessed).toBe(1);
    expect(finding.unwitnessed).toEqual([]);
  });

  it("witnesses it by a row that settled at its rollout pointer, ranked over a ledger mark", () => {
    const finding = judge({
      marks: [mark({ kind: "no-ask", pointer: ROLLOUT_POINTER, witness: "just a thanks" })],
      rows: [{ anchor: undefined, settlementWitness: ROLLOUT_POINTER, slug: "settled-ask" }],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "settlement", witness: "settled-ask" });
    expect(finding.markedNoAsk).toBe(0);
    expect(finding.witnessed).toBe(1);
  });

  it("leaves it unwitnessed past grace with nothing at its pointer, and offers to register it there", () => {
    const finding = judge({});

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([TURN_ID]);
    expect(registerCommandFor({ turn: codexTurn })).toBe(
      `slopweaver handover register --ask "do the thing" --anchor ${ROLLOUT_POINTER}`,
    );
  });

  it("never lets a Claude transcript pointer witness a Codex turn carrying the same turn id", () => {
    const finding = judge({
      marks: [mark({ kind: "card", pointer: `transcript:${SESSION}#${U1}` })],
      turns: [{ ...codexTurn, turnUuid: U1 }],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
    expect(finding.witnessed).toBe(0);
  });

  it("reads a row's settlement at a rollout pointer as a settlement witness of that turn", () => {
    const witnesses = rowWitnesses({
      rows: [{ anchor: undefined, settlementWitness: ROLLOUT_POINTER, slug: "settled-ask" }],
    });

    expect(witnesses.get(ROLLOUT_POINTER)).toEqual({ kind: "settlement", witness: "settled-ask" });
    expect(witnesses.size).toBe(1);
  });

  it("names no turn for a rollout pointer missing its offset, or carrying one that is not a number", () => {
    const bare = ROLLOUT_POINTER.slice(0, ROLLOUT_POINTER.lastIndexOf("@"));
    const rowAt = ({ anchor }: { anchor: string }): Parameters<typeof rowWitnesses>[0]["rows"] => [
      { anchor, settlementWitness: undefined, slug: "a-row" },
    ];

    expect(rowWitnesses({ rows: rowAt({ anchor: bare }) }).size).toBe(0);
    expect(rowWitnesses({ rows: rowAt({ anchor: `${bare}@x` }) }).size).toBe(0);
  });
});

describe("witnessTurns on a voice relay's delivery line", () => {
  const RELAY_TURN = "a0000047-0000-4000-8000-000000000050";
  const RELAY_SLUG = "talk-a00000470000";
  const RELAY_ROW = { anchor: `talk:${RELAY_TURN}`, settlementWitness: undefined, slug: RELAY_SLUG };
  const DELIVERY = `[voice relay ${RELAY_SLUG}] they said: "include it as a candidate" — full row ${RELAY_SLUG}; verify with slopweaver talk log.`;

  /** Judge the given turns against the given rows and marks, with nothing else in play. */
  const judge = ({
    turns,
    rows,
    marks = [],
  }: {
    turns: readonly OwnerTurn[];
    rows: Parameters<typeof witnessTurns>[0]["rows"];
    marks?: readonly IntakeMark[];
  }): ReturnType<typeof witnessTurns> =>
    witnessTurns({ coverage: COVERED, legs: LEGS, marks, nowIso: NOW, rows, sinceIso: undefined, turns });

  it("witnesses the line by the relay's own row — the measured double count", () => {
    const finding = judge({ rows: [RELAY_ROW], turns: [turn({ minutesAgo: 90, text: DELIVERY, uuid: U1 })] });

    expect(finding.turns[0]!.witness).toEqual({ kind: "row", witness: RELAY_SLUG });
    expect(finding.unwitnessed).toEqual([]);
    expect(finding.witnessed).toBe(1);
  });

  it("witnesses one delivered inside a paste wrapper", () => {
    const finding = judge({
      rows: [RELAY_ROW],
      turns: [turn({ minutesAgo: 90, text: `<pasted_content id="d0ab"> ${DELIVERY}`, uuid: U1 })],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "row", witness: RELAY_SLUG });
  });

  it("leaves a line whose relay row is not on the board unwitnessed", () => {
    const finding = judge({ rows: [], turns: [turn({ minutesAgo: 90, text: DELIVERY, uuid: U1 })] });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
  });

  it("leaves a turn that only quotes a delivery line mid-text unwitnessed", () => {
    const finding = judge({
      rows: [RELAY_ROW],
      turns: [turn({ minutesAgo: 90, text: `why did this not go out? ${DELIVERY}`, uuid: U1 })],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
  });

  it("leaves a turn of the owner's that opens with the marker but is not a delivery unwitnessed", () => {
    const finding = judge({
      rows: [RELAY_ROW],
      turns: [turn({ minutesAgo: 90, text: `[voice relay ${RELAY_SLUG}] why did this not go out?`, uuid: U1 })],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
  });

  it("refuses a row merely named like the relay whose anchor does not mint that slug", () => {
    const finding = judge({
      rows: [
        { ...RELAY_ROW, anchor: "talk:a0000017-0000-4000-8000-000000000019" },
        { anchor: undefined, settlementWitness: undefined, slug: RELAY_SLUG },
      ],
      turns: [turn({ minutesAgo: 90, text: DELIVERY, uuid: U1 })],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1]);
  });

  it("ranks a row anchored at the turn over the relay row, and the relay row over a ledger mark", () => {
    const finding = judge({
      marks: [
        mark({ kind: "no-ask", pointer: `transcript:${SESSION}#${U1}`, witness: "dup" }),
        mark({ kind: "no-ask", pointer: `transcript:${SESSION}#${U2}`, witness: "dup" }),
      ],
      rows: [RELAY_ROW, { anchor: `transcript:${SESSION}#${U1}`, settlementWitness: undefined, slug: "typed-ask" }],
      turns: [turn({ minutesAgo: 90, text: DELIVERY, uuid: U1 }), turn({ minutesAgo: 80, text: DELIVERY, uuid: U2 })],
    });

    expect(finding.turns.map((item) => item.witness)).toEqual([
      { kind: "row", witness: "typed-ask" },
      { kind: "row", witness: RELAY_SLUG },
    ]);
    expect(finding.markedNoAsk).toBe(0);
  });
});

describe("witnessTurns on a chair wake", () => {
  const CALL = "a0000035-0000-4000-8000-000000000038";

  it("witnesses the exact wake line by its call, and leaves a turn that only opens like one unwitnessed", () => {
    const finding = witnessTurns({
      coverage: COVERED,
      legs: LEGS,
      marks: [],
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [
        turn({ minutesAgo: 90, text: chairWakeLine({ callId: CALL }), uuid: U1 }),
        turn({ minutesAgo: 80, text: `[voice call ${CALL}] merge the stack`, uuid: U2 }),
      ],
    });

    expect(finding.turns.map((item) => item.witness)).toEqual([
      { kind: "wake", witness: `talk-call:${CALL}` },
      undefined,
    ]);
    expect([finding.witnessed, finding.markedNoAsk, finding.unwitnessed.map((item) => item.turnUuid)]).toEqual([
      1,
      0,
      [U2],
    ]);
  });

  const RELAY_SLUG = "talk-a00000470000";
  const RELAY_ROW = {
    anchor: "talk:a0000047-0000-4000-8000-000000000050",
    settlementWitness: undefined,
    slug: RELAY_SLUG,
  };
  const BATCH = chairBatchLine({
    anchors: [
      { kind: "stretch", pointer: `talk-call:${CALL}#s1` },
      { kind: "relay", slug: RELAY_SLUG },
    ],
  });

  it("witnesses a quiet batch by the anchors it lists once every relay it names has its row", () => {
    const finding = witnessTurns({
      coverage: COVERED,
      legs: LEGS,
      marks: [],
      nowIso: NOW,
      rows: [RELAY_ROW],
      sinceIso: undefined,
      turns: [turn({ minutesAgo: 90, text: BATCH, uuid: U1 })],
    });

    expect(finding.turns[0]!.witness).toEqual({ kind: "wake", witness: `talk-call:${CALL}#s1, ${RELAY_SLUG}` });
  });

  it("leaves a quiet batch naming a relay with no row unwitnessed, as an orphaned delivery line is", () => {
    const finding = witnessTurns({
      coverage: COVERED,
      legs: LEGS,
      marks: [],
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [
        turn({ minutesAgo: 90, text: BATCH, uuid: U1 }),
        turn({ minutesAgo: 80, text: `${BATCH} and merge the stack`, uuid: U2 }),
      ],
    });

    expect(finding.unwitnessed.map((item) => item.turnUuid)).toEqual([U1, U2]);
  });
});

describe("registerCommandFor", () => {
  it("anchors the turn and excerpts its first non-blank line, quoted", () => {
    const line = registerCommandFor({
      turn: turn({ minutesAgo: 90, text: '\n\n>2. Should "fleet findings" be asks?\nsecond line', uuid: U1 }),
    });

    expect(line).toBe(
      `slopweaver handover register --ask ">2. Should \\"fleet findings\\" be asks?" --anchor transcript:${SESSION}#${U1}`,
    );
  });

  it("cuts a long first line with an ellipsis rather than pasting a paragraph into a slug", () => {
    const line = registerCommandFor({ turn: turn({ minutesAgo: 90, text: "x".repeat(300), uuid: U1 }) });

    expect(line).toBe(`slopweaver handover register --ask "${"x".repeat(120)}…" --anchor transcript:${SESSION}#${U1}`);
  });
});
