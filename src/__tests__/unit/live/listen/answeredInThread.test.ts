/**
 * The weaker half of "did we already answer" — thread rows reduced to marks, and the interval test over
 * them. Pure, so every case is a plain call with no Slack in sight.
 *
 * register-class: an-answer-posted-off-the-answer-lane-is-invisible-to-every-answered-test
 *
 * The incident these hold down is the module's own header: an answer posted through the bot-CARD lane
 * rather than `turn answer` carries no `askIdentity` and writes no `answered` row, so a recovery pass
 * re-answered the owner's own DM thread 34 hours later. The three cases that matter most are the two traps
 * the exclusion must not re-open — a card-shaped row this install did not author, and two asks sharing one
 * thread — and the stranded lane, whose checklist and failure notice must stay invisible to it.
 */
import { describe, expect, it } from "vitest";

import {
  answeredInThread,
  type ThreadMark,
  threadExclusions,
  threadMarks,
} from "../../../../live/listen/answeredInThread.js";

const BOT = "U_BOT";
const CARD_EVENT_TYPE = "acme_bot_card_v1";
/** The incident ask's own `ts` — `D0SYN000001/1789829999.819679`. */
const ASKED_AT = "1789829999.819679";

const mark = ({
  eventType = undefined,
  self = true,
  subtype = false,
  text = "",
  ts,
  userId = "B_SELF",
}: {
  eventType?: string | undefined;
  self?: boolean;
  subtype?: boolean;
  text?: string;
  ts: string;
  userId?: string;
}): ThreadMark => ({
  hasSubtype: subtype,
  metadataEventType: eventType,
  selfAuthoredReason: self ? "confirmed-match" : undefined,
  text,
  ts,
  userId,
});

const verdict = ({ marks }: { marks: readonly ThreadMark[] }): string | undefined =>
  answeredInThread({ botUserId: BOT, cardEventType: CARD_EVENT_TYPE, marks, messageTs: ASKED_AT });

/** The later tag that closes an ask's interval — a second ask in the same thread. */
const NEXT_ASK = mark({
  self: false,
  text: `<@${BOT}> and what about prod`,
  ts: "1789830500.000100",
  userId: "U_ASKER",
});

describe("answeredInThread", () => {
  it("names the incident's first card, with its `ts`, when one sits in the ask's own interval", () => {
    const why = verdict({
      marks: [
        mark({ eventType: CARD_EVENT_TYPE, text: "the answer", ts: "1789830157.856539" }),
        mark({ eventType: CARD_EVENT_TYPE, text: "the correction", ts: "1789830918.231029" }),
      ],
    });

    expect(why).toContain("already posted a bot card at 1789830157.856539");
  });

  it("is silent on a card posted BEFORE the ask — an earlier answer resolved an earlier question", () => {
    expect(verdict({ marks: [mark({ eventType: CARD_EVENT_TYPE, ts: "1789829000.000100" })] })).toBe(undefined);
  });

  it("is silent on a card-shaped row this install did not author — the as-me trap stays closed", () => {
    const marks = [
      mark({
        eventType: CARD_EVENT_TYPE,
        self: false,
        ts: "1789830157.856539",
        userId: "U0SYN000001",
      }),
    ];

    expect(verdict({ marks })).toBe(undefined);
  });

  it("is silent on the capture checklist and the failure notice — the stranded lane needed no fence", () => {
    const marks = [
      mark({ eventType: "acme_bot_progress_v1", text: "capturing", ts: "1789830100.000100" }),
      mark({ eventType: "slopweaver_assistant_answer_v1", text: "that turn failed", ts: "1789830200.000100" }),
    ];

    expect(verdict({ marks })).toBe(undefined);
  });

  it("is silent on a subtyped row carrying the card type — an edit or a tombstone is not a post", () => {
    expect(verdict({ marks: [mark({ eventType: CARD_EVENT_TYPE, subtype: true, ts: "1789830157.856539" })] })).toBe(
      undefined,
    );
  });

  it("stops at a LATER tag of the bot, so a card answering the NEXT ask is not this ask's", () => {
    const marks = [NEXT_ASK, mark({ eventType: CARD_EVENT_TYPE, text: "prod is fine", ts: "1789830600.000100" })];

    expect(verdict({ marks })).toBe(undefined);
  });

  it("still fires for a card INSIDE that interval, with the same later tag present", () => {
    const marks = [
      mark({ eventType: CARD_EVENT_TYPE, text: "the answer", ts: "1789830157.856539" }),
      NEXT_ASK,
      mark({ eventType: CARD_EVENT_TYPE, text: "prod is fine", ts: "1789830600.000100" }),
    ];

    expect(verdict({ marks })).toContain("already posted a bot card at 1789830157.856539");
  });

  it("does not let the BOT's own later tag close the interval — only a row from somebody else can", () => {
    const marks = [
      mark({
        self: false,
        text: `<@${BOT}> a quote of the tag`,
        ts: "1789830050.000100",
        userId: BOT,
      }),
      mark({ eventType: CARD_EVENT_TYPE, text: "the answer", ts: "1789830157.856539" }),
    ];

    expect(verdict({ marks })).toContain("already posted a bot card at 1789830157.856539");
  });

  it("refuses a card whose authorship was only REFUSED, never CONFIRMED — an unresolved `auth.test`", () => {
    const peerCard: ThreadMark = {
      hasSubtype: false,
      metadataEventType: CARD_EVENT_TYPE,
      selfAuthoredReason: "unknown-self-identity",
      text: "some other install's card",
      ts: "1789830157.856539",
      userId: "B_OTHER0000",
    };

    expect(verdict({ marks: [peerCard] })).toBe(undefined);
  });

  it("carries no evidence at all from an empty thread", () => {
    expect(verdict({ marks: [] })).toBe(undefined);
  });

  /*
   * The residue, pinned so a future fix has to come back here and delete it.
   *
   * `renderSlackCard` stamps `cardEventType` on every card the `slack post`/`reply` lane sends, so this
   * test CANNOT tell an answer from a nudge — and the r1 review pass on this change named exactly that.
   * The witness is falsifiable in the useful direction: the day the card lane appends its own `answered`
   * row and this test keys on that instead, this case reddens and the module header's residue paragraph
   * goes with it.
   */
  it("fires on a NON-answer card too, because the card lane stamps one event type on everything it sends", () => {
    const nudge = mark({
      eventType: CARD_EVENT_TYPE,
      text: "heads up, staging is being redeployed",
      ts: "1789830300.000100",
    });

    expect(verdict({ marks: [nudge] })).toContain("already posted a bot card at 1789830300.000100");
  });
});
describe("threadMarks", () => {
  it("shapes a bot card the same install authored, carrying its metadata event type", () => {
    const marks = threadMarks({
      rawMessages: [
        {
          bot_id: "B0SYN000013",
          metadata: { event_payload: { renderer: "card" }, event_type: "acme_bot_card_v1" },
          text: "the staging pool exhausted because the migration held its connections",
          ts: "1789830157.856539",
        },
      ],
      selfBotId: "B0SYN000013",
    });

    expect(marks).toEqual([
      {
        hasSubtype: false,
        metadataEventType: "acme_bot_card_v1",
        selfAuthoredReason: "confirmed-match",
        text: "the staging pool exhausted because the migration held its connections",
        ts: "1789830157.856539",
        userId: "B0SYN000013",
      },
    ]);
  });

  it("keeps an ordinary human row with no metadata, because the non-evidence rows close the interval", () => {
    const marks = threadMarks({
      rawMessages: [{ text: "<@U_BOT> and what about prod", ts: "1789830900.000100", user: "U_ASKER" }],
      selfBotId: "B0SYN000013",
    });

    expect(marks).toEqual([
      {
        hasSubtype: false,
        metadataEventType: undefined,
        selfAuthoredReason: undefined,
        text: "<@U_BOT> and what about prod",
        ts: "1789830900.000100",
        userId: "U_ASKER",
      },
    ]);
  });

  it("prefers `user` over `bot_id`, and reads a bot delivery's `bot_id` when `user` is absent", () => {
    const marks = threadMarks({
      rawMessages: [
        { bot_id: "B0SYN000001", text: "as me", ts: "1789830200.000100", user: "U0SYN000001" },
        { bot_id: "B0SYN000001", text: "no user field", ts: "1789830300.000100" },
      ],
      selfBotId: "B0SYN000013",
    });

    expect(marks.map((row) => row.userId)).toEqual(["U0SYN000001", "B0SYN000001"]);
    expect(marks.map((row) => row.selfAuthoredReason)).toEqual([undefined, undefined]);
  });

  it("refuses a `bot_id` that is not B-shaped rather than passing the raw string through as an author", () => {
    const marks = threadMarks({
      rawMessages: [{ bot_id: "not-a-bot-id", text: "hm", ts: "1789830400.000100" }],
      selfBotId: "B0SYN000013",
    });

    expect(marks.map((row) => row.userId)).toEqual([undefined]);
  });

  it("records a subtype, and drops a row with no usable `ts` or no object at all", () => {
    const marks = threadMarks({
      rawMessages: [
        { subtype: "channel_join", text: "joined", ts: "1789830500.000100", user: "U_ASKER" },
        { text: "no ts", user: "U_ASKER" },
        { text: "empty ts", ts: "", user: "U_ASKER" },
        "not an object",
        undefined,
      ],
      selfBotId: "B0SYN000013",
    });

    expect(marks.map((row) => row.ts)).toEqual(["1789830500.000100"]);
    expect(marks.map((row) => row.hasSubtype)).toEqual([true]);
  });

  it("reads a text-less row as an empty string, never as a missing field", () => {
    const marks = threadMarks({
      rawMessages: [{ files: [{ id: "F1" }], ts: "1789830600.000100", user: "U_ASKER" }],
      selfBotId: "B0SYN000013",
    });

    expect(marks.map((row) => row.text)).toEqual([""]);
  });
});

describe("threadExclusions — a posted plan is not the final answer", () => {
  const ASK = { channel: "D0SYN000001", messageTs: ASKED_AT, threadTs: ASKED_AT };
  const EXACT = { ...ASK, quality: "exact" as const };

  it("excludes nothing when the thread's one exact answer is the recorded first answer", () => {
    expect(
      threadExclusions({
        ask: { ...ASK, threadAnswers: [EXACT], threadMarks: [] },
        botUserId: BOT,
        cardEventType: CARD_EVENT_TYPE,
        interimAnswers: 1,
      }).exclusions,
    ).toEqual([]);
  });

  it("is the pair: the same thread with no interim count reads as already answered", () => {
    expect(
      threadExclusions({
        ask: { ...ASK, threadAnswers: [EXACT], threadMarks: [] },
        botUserId: BOT,
        cardEventType: CARD_EVENT_TYPE,
      }).exclusions,
    ).toEqual(["already-answered"]);
  });

  it("still excludes a plan followed by its final answer", () => {
    expect(
      threadExclusions({
        ask: { ...ASK, threadAnswers: [EXACT, EXACT], threadMarks: [] },
        botUserId: BOT,
        cardEventType: CARD_EVENT_TYPE,
        interimAnswers: 1,
      }).exclusions,
    ).toEqual(["already-answered"]);
  });
});
