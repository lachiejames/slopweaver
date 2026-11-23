/**
 * Whether a Queue card is still the owner's to act on: the done-check, and what they have said since the card was
 * asked — counted only when it is filed to THIS row or filed nowhere, and never "nothing since" when a source could
 * not be read.
 */
import { describe, expect, it } from "vitest";

import { askDoneCommand } from "../../../handover/askDoneCommand.js";
import { currencyRowOf, derivedReplyCheck, doneOf, sourceLine } from "../../../handover/currency.js";
import { saidOf } from "../../../handover/currencySaid.js";
import type { StandingRead } from "../../../handover/currencyStanding.js";
import { HIS_WORDS_MAX } from "../../../handover/hisWords.js";
import type { UnreadableChair } from "../../../supervisor/chain.js";
import type { IntakeReport } from "../../../supervisor/intake.js";
import type { VoiceRelayIntake } from "../../../talk/relayIntake.js";
import {
  ASKED,
  ask,
  callWords,
  intakeOf,
  NO_RELAYS,
  NO_STANDING,
  NO_VOICE,
  READ_FROM,
  relay,
  rowOf,
  SLACK_LINK,
  turn,
} from "./currencyFixture.js";

describe("currencyRowOf — what they have said since", () => {
  it("counts an unfiled turn after the floor, and one filed to this row, and nothing filed elsewhere", () => {
    const row = rowOf({
      intake: intakeOf({
        turns: [
          turn({ at: "2026-10-02T09:59:00.000Z", id: "before" }),
          turn({ at: "2026-10-02T10:05:00.000Z", id: "unfiled" }),
          turn({
            at: "2026-10-02T10:06:00.000Z",
            id: "here",
            witness: { kind: "answered", witness: "ask:mirror-evidence-files" },
          }),
          turn({ at: "2026-10-02T10:07:00.000Z", id: "elsewhere", witness: { kind: "row", witness: "another-row" } }),
          turn({
            at: "2026-10-02T10:08:00.000Z",
            id: "nothing",
            witness: { kind: "no-ask", witness: "mirror-evidence-files" },
          }),
        ],
      }),
    });

    expect(row.since).toEqual({
      gaps: [],
      standing: [],
      words: [
        { atIso: "2026-10-02T10:05:00.000Z", filed: "unfiled", pointer: "transcript:chair#unfiled", source: "chair" },
        { atIso: "2026-10-02T10:06:00.000Z", filed: "here", pointer: "transcript:chair#here", source: "chair" },
      ],
    });
    expect(row.key).toBe("ask:mirror-evidence-files");
    expect(row.floorIso).toBe(ASKED);
  });

  // A question restored in the same words after the owner ruled ranked first as
  // unanswered.
  it("carries the ruling the owner gave before the same question was asked again, leaving the asking and floor where they are", () => {
    const row = rowOf({
      intake: intakeOf({ turns: [] }),
      over: {
        sameQuestionRuling: { anchor: "talk:ruled", decidedIso: "2026-10-01T15:00:00.000Z", words: "Ship it." },
      },
    });
    const plain = rowOf({ intake: intakeOf({ turns: [] }) });

    expect([row.sameQuestionRuling, row.askedIso, row.floorIso, row.since.words]).toEqual([
      { atIso: "2026-10-01T15:00:00.000Z", pointer: "talk:ruled" },
      ASKED,
      ASKED,
      [],
    ]);
    expect("sameQuestionRuling" in plain).toBe(false);
  });

  it("measures from the re-confirmation when it is later than the ask", () => {
    const row = rowOf({
      intake: intakeOf({ turns: [turn({ at: "2026-10-02T10:05:00.000Z", id: "unfiled" })] }),
      over: { stillRealIso: "2026-10-02T11:00:00.000Z" },
    });

    expect(row.floorIso).toBe("2026-10-02T11:00:00.000Z");
    expect(row.since).toEqual({ gaps: [], standing: [], words: [] });
  });

  it("counts call words the chair has not read, and a relay to this row that never reached it", () => {
    const row = rowOf({
      intake: intakeOf({ turns: [] }),
      relays: {
        kind: "read",
        relays: [
          relay({ anchor: "talk:a", at: "2026-10-02T10:10:00.000Z", slug: "mirror-evidence-files" }),
          relay({ anchor: "talk:b", at: "2026-10-02T10:11:00.000Z", slug: "another-row" }),
        ],
      },
      voice: callWords({ words: [{ atIso: "2026-10-02T10:20:00.000Z", pointer: "talk-call:c#1", text: "said" }] }),
    });

    expect(row.since.words).toEqual([
      { atIso: "2026-10-02T10:10:00.000Z", filed: "here", pointer: "talk:a", source: "relay" },
      { atIso: "2026-10-02T10:20:00.000Z", filed: "unfiled", pointer: "talk-call:c#1", source: "voice" },
    ]);
  });

  it("names every source it could not read as a gap, never as nothing since", () => {
    const row = rowOf({
      intake: { kind: "unavailable", why: "no supervisor pin" },
      relays: { kind: "unavailable", why: "ledger torn" },
      voice: { kind: "unavailable", why: "call file gone" },
    });

    expect(row.since).toEqual({
      gaps: [
        "your supervisor-chat turns could not be read: no supervisor pin",
        "the voice relays could not be read: ledger torn",
        "the call words could not be read: call file gone",
      ],
      standing: [],
      words: [],
    });
  });

  it("names an unreadable chair session, and a record that does not reach back to the ask", () => {
    const row = rowOf({
      intake: intakeOf({
        reachesSince: false,
        turns: [],
        unreadable: [{ claudeSessionId: "s1", untilIso: undefined, why: "gone" }],
      }),
      over: { askedIso: "2026-10-02T08:00:00.000Z" },
    });

    expect(row.since.gaps).toEqual([
      "one supervisor-chat session would not read: gone",
      "the supervisor chat's record does not reach back to when this reached you",
    ]);
  });

  it("names an unreadable chair only on a card asked before that chair last gave up the pin", () => {
    const unreadable: readonly UnreadableChair[] = [
      { claudeSessionId: "before", untilIso: "2026-10-02T09:00:00.000Z", why: "ended an hour before it was asked" },
      { claudeSessionId: "at", untilIso: ASKED, why: "ended the instant it was asked" },
      { claudeSessionId: "sub-ms", untilIso: "2026-10-02T10:00:00.0005Z", why: "ended half a millisecond after" },
      { claudeSessionId: "after", untilIso: "2026-10-02T11:00:00.000Z", why: "ended an hour after" },
      { claudeSessionId: "open", untilIso: undefined, why: "still holds the pin" },
      { claudeSessionId: "garbled", untilIso: "not an instant", why: "an end that will not parse" },
    ];

    const row = rowOf({ intake: intakeOf({ turns: [], unreadable }) });

    expect(row.since.gaps).toEqual([
      "one supervisor-chat session would not read: ended half a millisecond after",
      "one supervisor-chat session would not read: ended an hour after",
      "one supervisor-chat session would not read: still holds the pin",
      "one supervisor-chat session would not read: an end that will not parse",
    ]);
  });

  it("leaves a card asked after every unreadable chair gave up the pin with no gap at all", () => {
    const row = rowOf({
      intake: intakeOf({
        turns: [],
        unreadable: [
          { claudeSessionId: "s1", untilIso: "2026-10-01T13:00:00.000Z", why: "gone" },
          { claudeSessionId: "s2", untilIso: "2026-10-02T09:59:59.999Z", why: "gone" },
        ],
      }),
    });

    expect(row.since).toEqual({ gaps: [], standing: [], words: [] });
  });

  it("keeps the record-does-not-reach-back gap when the only unreadable chair ended before the card", () => {
    const row = rowOf({
      intake: intakeOf({
        reachesSince: false,
        turns: [],
        unreadable: [{ claudeSessionId: "s1", untilIso: "2026-10-02T07:00:00.000Z", why: "gone" }],
      }),
      over: { askedIso: "2026-10-02T08:00:00.000Z" },
    });

    expect(row.since.gaps).toEqual(["the supervisor chat's record does not reach back to when this reached you"]);
  });

  it("counts a turn half a millisecond after the floor, never one with only zeros past it", () => {
    const row = rowOf({
      intake: intakeOf({
        turns: [
          turn({ at: "2026-10-02T10:00:00.0000Z", id: "zeros" }),
          turn({ at: "2026-10-02T10:00:00.0005Z", id: "sub-ms" }),
        ],
      }),
    });

    expect(row.since.words).toEqual([
      { atIso: "2026-10-02T10:00:00.0005Z", filed: "unfiled", pointer: "transcript:chair#sub-ms", source: "chair" },
    ]);
  });

  it("counts a relay and a call word half a millisecond after the floor, and names a timeless one as a gap", () => {
    const row = rowOf({
      intake: intakeOf({ turns: [] }),
      relays: {
        kind: "read",
        relays: [
          relay({ anchor: "talk:sub", at: "2026-10-02T10:00:00.0005Z", slug: "mirror-evidence-files" }),
          relay({ anchor: "talk:none", at: "not a time", slug: "mirror-evidence-files" }),
        ],
      },
      voice: callWords({
        words: [
          { atIso: "2026-10-02T10:00:00.0005Z", pointer: "talk-call:c#1", text: "said" },
          { atIso: "not a time", pointer: "talk-call:c#2", text: "said" },
        ],
      }),
    });

    expect(row.since).toEqual({
      gaps: [
        "one voice relay carries no time, so whether it came after this reached you cannot be told",
        "one call word carries no time, so whether it came after this reached you cannot be told",
      ],
      standing: [],
      words: [
        { atIso: "2026-10-02T10:00:00.0005Z", filed: "here", pointer: "talk:sub", source: "relay" },
        { atIso: "2026-10-02T10:00:00.0005Z", filed: "unfiled", pointer: "talk-call:c#1", source: "voice" },
      ],
    });
  });

  it("names a record starting half a millisecond after the floor as not reaching it", () => {
    const row = rowOf({
      intake: intakeOf({ earliestIso: "2026-10-02T10:00:00.0005Z", reachesSince: false, turns: [] }),
    });

    expect(row.since.gaps).toEqual(["the supervisor chat's record does not reach back to when this reached you"]);
  });

  it("names a card older than the read as a gap, in words with no instant in them", () => {
    const row = rowOf({ intake: intakeOf({ turns: [] }), over: { askedIso: "2026-09-20T00:00:00.000Z" } });

    expect(row.since.gaps).toEqual(["what you said before this check's window opened was not read"]);
  });

  it("says so when the ask records no instant at all", () => {
    const row = rowOf({ intake: intakeOf({ turns: [] }), over: { askedIso: undefined } });

    expect(row.floorIso).toBeUndefined();
    expect(row.since).toEqual({ gaps: ["nothing records when this card reached you"], standing: [], words: [] });
  });

  it("still names every standing read that failed on a card with no floor", () => {
    const standing = { ...NO_STANDING, gaps: [{ why: "your owner profile could not be read: ECONNREFUSED" }] };
    const row = rowOf({ intake: intakeOf({ turns: [] }), over: { askedIso: undefined }, standing });

    expect(row.since.gaps).toEqual([
      "nothing records when this card reached you",
      "your owner profile could not be read: ECONNREFUSED",
    ]);
  });
});

describe("currencyRowOf — a card of any kind, by its exact key", () => {
  const HAND = {
    ask: undefined,
    fact: { atIso: "2026-10-02T12:00:00.000Z", by: "the hand register still holding it", kind: "confirmed" as const },
    floorIso: ASKED,
    key: "hand:try-now-page",
    row: "unblocked-row",
  };
  const handRow = ({
    intake,
    relays = NO_RELAYS,
    standing = NO_STANDING,
  }: {
    intake: IntakeReport;
    relays?: VoiceRelayIntake;
    standing?: StandingRead;
  }) =>
    currencyRowOf({
      card: HAND,
      done: undefined,
      intake,
      readFromIso: READ_FROM,
      relays,
      standing,
      voice: NO_VOICE,
    });

  it("counts a ruling filed to the row a hand step unblocks, never one filed to another row", () => {
    const ruling = { atIso: "2026-10-02T10:30:00.000Z", source: "ruling", text: "ship it" } as const;
    const row = handRow({
      intake: intakeOf({ turns: [] }),
      standing: {
        ...NO_STANDING,
        entries: [
          { ...ruling, pointer: "ruling:unblocked-row#a", row: "unblocked-row" },
          { ...ruling, pointer: "ruling:another-row#b", row: "another-row" },
        ],
      },
    });

    expect(row.since.standing).toEqual([
      { atIso: "2026-10-02T10:30:00.000Z", filed: "here", pointer: "ruling:unblocked-row#a", source: "ruling" },
    ]);
  });

  it("counts a word filed to the card's exact key after its floor, never one at the floor or to a bare id", () => {
    const row = handRow({
      intake: intakeOf({
        turns: [
          turn({ at: ASKED, id: "at-floor", witness: { kind: "answered", witness: "hand:try-now-page" } }),
          turn({ at: "2026-10-02T10:01:00.000Z", id: "here", witness: { kind: "row", witness: "hand:try-now-page" } }),
          turn({ at: "2026-10-02T10:02:00.000Z", id: "bare", witness: { kind: "row", witness: "try-now-page" } }),
        ],
      }),
    });

    expect(row).toEqual({
      fact: HAND.fact,
      floorIso: ASKED,
      key: "hand:try-now-page",
      since: {
        gaps: [],
        standing: [],
        words: [
          { atIso: "2026-10-02T10:01:00.000Z", filed: "here", pointer: "transcript:chair#here", source: "chair" },
        ],
      },
    });
  });

  it("files a relay by the card they were looking at, and a relay naming no card only to the ask it registered into", () => {
    const relays: VoiceRelayIntake = {
      kind: "read",
      relays: [
        relay({ about: "hand:try-now-page", anchor: "talk:on-card", at: "2026-10-02T10:10:00.000Z", slug: "some-row" }),
        relay({ anchor: "talk:no-card", at: "2026-10-02T10:11:00.000Z", slug: "try-now-page" }),
        relay({
          about: "ask:other",
          anchor: "talk:other",
          at: "2026-10-02T10:12:00.000Z",
          slug: "mirror-evidence-files",
        }),
      ],
    };

    expect(handRow({ intake: intakeOf({ turns: [] }), relays }).since.words.map((word) => word.pointer)).toEqual([
      "talk:on-card",
    ]);
    expect(rowOf({ intake: intakeOf({ turns: [] }), relays }).since.words).toEqual([]);
  });

  it("counts a chair word and a card-less relay filed to the row the hand step unblocks", () => {
    const row = handRow({
      intake: intakeOf({
        turns: [
          turn({ at: "2026-10-02T10:01:00.000Z", id: "row", witness: { kind: "row", witness: "unblocked-row" } }),
        ],
      }),
      relays: {
        kind: "read",
        relays: [relay({ anchor: "talk:row", at: "2026-10-02T10:02:00.000Z", slug: "unblocked-row" })],
      },
    });

    expect(row.since.words).toEqual([
      { atIso: "2026-10-02T10:01:00.000Z", filed: "here", pointer: "transcript:chair#row", source: "chair" },
      { atIso: "2026-10-02T10:02:00.000Z", filed: "here", pointer: "talk:row", source: "relay" },
    ]);
  });
});

describe("derivedReplyCheck and doneOf — is it done", () => {
  const command = askDoneCommand({ anchor: SLACK_LINK })!;

  it("reads the anchor live only when the row declares exactly the register's own check", () => {
    expect(derivedReplyCheck({ ask: ask({ anchor: SLACK_LINK, doneWhen: [{ command, kind: "command" }] }) })).toBe(
      SLACK_LINK,
    );
    expect(
      derivedReplyCheck({
        ask: ask({ anchor: SLACK_LINK, doneWhen: [{ command: `${command} ; true`, kind: "command" }] }),
      }),
    ).toBeUndefined();
    expect(derivedReplyCheck({ ask: ask({ anchor: SLACK_LINK, doneWhen: [] }) })).toBeUndefined();
  });

  it("carries the reply's link as the evidence", () => {
    expect(
      doneOf({ ask: ask(), reply: { atIso: ASKED, kind: "replied", permalink: SLACK_LINK, ts: "1785114398.557099" } }),
    ).toEqual({ atIso: ASKED, kind: "replied", permalink: SLACK_LINK });
  });

  it("keeps a check that could not run as could-not-check", () => {
    expect(doneOf({ ask: ask(), reply: { kind: "could-not-check", why: "no token" } })).toEqual({
      kind: "could-not-check",
      why: "no token",
    });
  });

  it("names any other declared check as not run, and an ask with none as the owner's ruling", () => {
    expect(doneOf({ ask: ask({ doneWhen: [{ kind: "path", path: "a.md" }] }), reply: undefined })).toEqual({
      checks: ["path: a.md"],
      kind: "declared-not-run",
    });
    expect(doneOf({ ask: ask(), reply: undefined })).toEqual({ kind: "on-owner-ruling" });
  });
});

describe("saidOf — the owner's words, once per pointer a row names", () => {
  it("carries every source's words once, and nothing for a pointer no row names or words that are only whitespace", () => {
    const intake = intakeOf({
      turns: [
        turn({ at: "2026-10-02T10:05:00.000Z", id: "named" }),
        turn({ at: "2026-10-02T09:00:00.000Z", id: "old" }),
      ],
    });
    const voice = callWords({
      words: [
        { atIso: "2026-10-02T10:20:00.000Z", pointer: "talk-call:c#1", text: "  ship\n the bump  " },
        { atIso: "2026-10-02T10:21:00.000Z", pointer: "talk-call:c#2", text: "   " },
      ],
    });
    const relays: VoiceRelayIntake = {
      kind: "read",
      relays: [relay({ anchor: "talk:a", at: "2026-10-02T10:10:00.000Z", slug: "mirror-evidence-files" })],
    };
    // Both cards postdate the chair turn, so both rows name it; the document carries it once.
    const rows = [rowOf({ intake, relays, voice }), rowOf({ intake, over: { slug: "second" }, relays, voice })];

    expect(rows[1]!.since.words.map((word) => word.pointer)).toContain("transcript:chair#named");
    expect(saidOf({ intake, relays, rows, standing: NO_STANDING, voice })).toEqual({
      "talk-call:c#1": { cut: "none", text: "ship the bump" },
      "talk:a": { cut: "none", text: "the words they relayed" },
      "transcript:chair#named": { cut: "none", text: "words" },
    });
  });

  it("marks where each source lost their words: the end of a chair or call turn, the start of a relay", () => {
    const longTurn = turn({ at: "2026-10-02T10:05:00.000Z", id: "long" });
    const tailTurn = turn({ at: "2026-10-02T10:06:00.000Z", id: "tail" });
    const intake = intakeOf({
      turns: [
        { ...longTurn, turn: { ...longTurn.turn, text: "word ".repeat(HIS_WORDS_MAX) } },
        { ...tailTurn, turn: { ...tailTurn.turn, tailCut: true, text: "short" } },
      ],
    });
    const voice = callWords({
      words: [{ atIso: "2026-10-02T10:20:00.000Z", cut: true, pointer: "talk-call:c#1", text: "cut by the call" }],
    });
    const relays: VoiceRelayIntake = {
      kind: "read",
      relays: [
        relay({
          anchor: "talk:a",
          at: "2026-10-02T10:10:00.000Z",
          heard: "the tail they said",
          slug: "mirror-evidence-files",
          truncated: true,
        }),
      ],
    };
    const said = saidOf({ intake, relays, rows: [rowOf({ intake, relays, voice })], standing: NO_STANDING, voice });

    expect(said["transcript:chair#long"]!.cut).toBe("end");
    expect(Array.from(said["transcript:chair#long"]!.text).length).toBeLessThanOrEqual(HIS_WORDS_MAX);
    expect(said["transcript:chair#tail"]).toEqual({ cut: "end", text: "short" });
    expect(said["talk-call:c#1"]).toEqual({ cut: "end", text: "cut by the call" });
    expect(said["talk:a"]).toEqual({ cut: "start", text: "the tail they said" });
  });
});

describe("sourceLine", () => {
  it("prints the read line, or why it could not be read", () => {
    expect(sourceLine({ read: "3 turns read", why: undefined })).toBe("3 turns read");
    expect(sourceLine({ read: "", why: "no pin" })).toBe("could not read: no pin");
  });
});
