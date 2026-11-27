import { describe, expect, it } from "vitest";

import { sentenceCount, wordCount } from "../../../briefing/text.js";
import { type ChainCoverage } from "../../../supervisor/chain.js";
import { EMPTY_INBOUND } from "../../../supervisor/inbound.js";
import { type IntakeMark, intakeClause, type OwnerTurn, witnessTurns } from "../../../supervisor/intake.js";

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
const LEGS = [{ fromIso: "2026-09-02T09:00:00.000Z", sessionId: SESSION, turns: 1 }];

const U1 = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";

const mark = (over: Partial<IntakeMark> & { pointer: string }): IntakeMark => ({
  byClaudeSessionId: SESSION,
  kind: "card",
  markedAtIso: NOW,
  witness: "Merge #403 tonight?",
  ...over,
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
