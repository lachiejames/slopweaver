import { describe, expect, it } from "vitest";

import { sentenceCount, wordCount } from "../../../briefing/text.js";
import { type ChainCoverage } from "../../../supervisor/chain.js";
import { EMPTY_INBOUND } from "../../../supervisor/inbound.js";
import {
  buildIntakeMark,
  INTAKE_GRACE_MS,
  type IntakeMark,
  intakeClause,
  type OwnerTurn,
  parseIntakeMarkJournal,
  parseIntakeMarkLine,
  registerCommandFor,
  rowWitnesses,
  witnessTurns,
} from "../../../supervisor/intake.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";
import { chairWakeLine } from "../../../talk/chairWake.js";

const SESSION = "a0000013-0000-4000-8000-000000000014";
const NOW = "2026-09-02T17:00:00.000Z";

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

describe("intake marks", () => {
  it("round-trips a mark through the journal", () => {
    const built = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "  they said brief me  ",
    });

    expect("mark" in built).toBe(true);
    const written = (built as { readonly mark: IntakeMark }).mark;
    expect(written.witness).toBe("they said brief me");
    expect(parseIntakeMarkJournal({ text: `${JSON.stringify(written)}\n\nnot json\n` })).toEqual([written]);
  });

  it("reads a hand-written spelling of a turn back in the form the writer stores, and leaves a non-pointer as written", () => {
    const relay = "talk:a0000046-0000-4000-8000-000000000049";
    const lines = [
      { byClaudeSessionId: SESSION, kind: "answered", markedAtIso: NOW, pointer: relay.toUpperCase(), witness: " w " },
      { byClaudeSessionId: SESSION, kind: "answered", markedAtIso: NOW, pointer: "not-a-pointer", witness: "w" },
    ];

    expect(
      parseIntakeMarkJournal({ text: lines.map((line) => JSON.stringify(line)).join("\n") }).map((m) => [
        m.pointer,
        m.witness,
      ]),
    ).toEqual([
      [relay, "w"],
      ["not-a-pointer", "w"],
    ]);
  });

  it("refuses a pointer that is not a turn pointer, and a witness that says nothing", () => {
    const badPointer = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "card",
      markedAtIso: NOW,
      pointer: "https://github.com/o/r/pull/1",
      witness: "x",
    });
    const blank = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "card",
      markedAtIso: NOW,
      pointer: `transcript:${SESSION}#${U1}`,
      witness: "   ",
    });

    expect("refusal" in badPointer).toBe(true);
    expect((badPointer as { readonly refusal: string }).refusal).toContain("not a turn pointer");
    expect("refusal" in blank).toBe(true);
    expect((blank as { readonly refusal: string }).refusal).toContain("--witness is required");
  });

  it("marks a voice relay by its talk: anchor, lower-cased — the pointer the sweep names an undelivered one by", () => {
    const built = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "answered",
      markedAtIso: NOW,
      pointer: " TALK:A0000017-0000-4000-8000-000000000020 ",
      witness: "talk-a00000170000",
    });

    expect((built as { readonly mark: IntakeMark }).mark.pointer).toBe("talk:a0000017-0000-4000-8000-000000000020");
  });

  it("refuses a talk: pointer whose turn id is not a v4 uuid", () => {
    const built = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "answered",
      markedAtIso: NOW,
      pointer: "talk:not-a-turn",
      witness: "x",
    });

    expect((built as { readonly refusal: string }).refusal).toBe(
      "talk:not-a-turn is not a turn pointer — the form is transcript:<sessionId>#<turnUuid>, talk:<turnId> or talk-call:<callId>#<segmentId>",
    );
  });

  it("marks a stretch of the owner's call speech by its talk-call: pointer — what talk unread prints, relayed or not", () => {
    const built = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: ` talk-call:${"a0000035-0000-4000-8000-000000000038".toUpperCase()}#segment_0_163 `,
      witness: "small talk, no steer",
    });

    expect((built as { readonly mark: IntakeMark }).mark.pointer).toBe(
      "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
    );
  });

  it("refuses a talk-call: pointer with no segment", () => {
    const built = buildIntakeMark({
      byClaudeSessionId: SESSION,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: "talk-call:a0000035-0000-4000-8000-000000000038#",
      witness: "x",
    });

    expect((built as { readonly refusal: string }).refusal).toContain("is not a turn pointer");
  });

  it("drops a line whose kind is not one this ledger knows, rather than reading it as something", () => {
    const line = JSON.stringify({ ...mark({ pointer: `transcript:${SESSION}#${U1}` }), kind: "done" });

    expect(parseIntakeMarkLine({ line })).toBeUndefined();
    expect(parseIntakeMarkLine({ line: "" })).toBeUndefined();
    expect(parseIntakeMarkLine({ line: "[]" })).toBeUndefined();
  });
});

describe("rowWitnesses", () => {
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

describe("the headline clause", () => {
  const read = ({ unwitnessed, noAsk }: { unwitnessed: number; noAsk: number }): ReturnType<typeof witnessTurns> =>
    witnessTurns({
      marks: Array.from({ length: noAsk }, (_, index) =>
        mark({
          kind: "no-ask",
          pointer: `transcript:${SESSION}#${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
          witness: "x",
        }),
      ),
      coverage: COVERED,
      legs: LEGS,
      nowIso: NOW,
      rows: [],
      sinceIso: undefined,
      turns: [
        ...Array.from({ length: noAsk }, (_, index) =>
          turn({ minutesAgo: 90, uuid: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000` }),
        ),
        ...Array.from({ length: unwitnessed }, (_, index) =>
          turn({ minutesAgo: 90, uuid: `${String(index).padStart(8, "0")}-1111-4000-8000-000000000000` }),
        ),
      ],
    });

  it("counts the unwitnessed turns as its own sentence, never appended to the reconciliation's", () => {
    const report = { finding: read({ noAsk: 0, unwitnessed: 2 }), inbound: EMPTY_INBOUND, kind: "read" } as const;

    expect(intakeClause({ report })).toBe("2 owner turn(s) across 1 supervisor session(s) have no row or card.");
  });

  it("says every turn was witnessed, and how many were dismissed, when nothing is outstanding", () => {
    expect(
      intakeClause({ report: { finding: read({ noAsk: 0, unwitnessed: 0 }), inbound: EMPTY_INBOUND, kind: "read" } }),
    ).toBe("Owner turns: 0 read across 1 supervisor session(s), all witnessed.");
    expect(
      intakeClause({ report: { finding: read({ noAsk: 3, unwitnessed: 0 }), inbound: EMPTY_INBOUND, kind: "read" } }),
    ).toBe("Owner turns: 3 read across 1 supervisor session(s), all witnessed, 3 marked no-ask.");
  });

  it("follows the owner-turn sentence with the open peer messages, only when there are any", () => {
    const open = {
      chairSessionId: SESSION,
      message: {
        body: "report",
        delivery: "queued",
        lineNumber: 1,
        msgId: "m-1",
        senderName: "live-bot-loop-12sep-a-fb",
        timestamp: NOW,
        uuid: U1,
      },
      placement: "after-pin",
      pointer: `transcript:${SESSION}#${U1}`,
    } as const;

    expect(
      intakeClause({
        report: {
          finding: read({ noAsk: 0, unwitnessed: 0 }),
          inbound: { ...EMPTY_INBOUND, carried: [open], read: 1 },
          kind: "read",
        },
      }),
    ).toBe(
      "Owner turns: 0 read across 1 supervisor session(s), all witnessed. 1 message(s) from other sessions landed " +
        "on a chair after it handed over and 0 more got no reply inside a chair's own span; " +
        "`slopweaver supervisor intake` lists them.",
    );
  });

  it("prints WHY when the intake could not be read, never a zero", () => {
    expect(intakeClause({ report: { kind: "unavailable", why: "no supervisor pin is recorded" } })).toBe(
      "Owner turns unread: no supervisor pin is recorded.",
    );
  });

  /**
   * The widest clause the chair half can emit (a typed console count follows as its own sentence): every witnessed, some dismissed, a floor stated, and BOTH coverage gaps
   * disclosed at once. This is the measurement `../../../briefing/caps.ts`'s `ALIGNMENT_MAX_WORDS` cites for
   * why the intake sentence is folded rather than counted against the alignment line.
   */
  it("runs to 44 words across two sentences at its widest, which is why it is folded rather than capped", () => {
    const clause = intakeClause({
      report: {
        finding: {
          ...read({ noAsk: 3, unwitnessed: 0 }),
          coverage: {
            earliestIso: "2026-09-02T09:00:00.000Z",
            linksKnown: 79,
            reachesSince: false,
            unreadable: [{ claudeSessionId: SESSION, untilIso: undefined, why: "no transcript on disk" }],
            walked: [SESSION],
          },
          sinceIso: "2026-08-28T00:00:00.000Z",
        },
        inbound: EMPTY_INBOUND,
        kind: "read",
      },
    });

    expect(clause).toBe(
      "Owner turns: 3 read across 1 supervisor session(s) since 2026-08-28T00:00:00.000Z, all witnessed, " +
        "3 marked no-ask. Chain coverage: 1 session(s) walked, but the chain starts at 2026-09-02T09:00:00.000Z, " +
        "so anything earlier was NOT read, and 1 session(s) could not be walked — " +
        "`slopweaver supervisor chain --rescan`.",
    );
    expect(wordCount({ text: clause })).toBe(44);
    expect(sentenceCount({ text: clause })).toBe(2);
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
