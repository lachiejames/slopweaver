/**
 * What the owner's words answered, pure: which voice turn is "the question", how a relay's words are found in its call, and how
 * each triage verdict reads — every case the three surfaces print.
 */
import { describe, expect, it } from "vitest";

import {
  answerContextRequestOf,
  answeredVoiceTurn,
  compactVerdictClause,
  quotedVoice,
  type TriageVerdictRead,
  triageVerdictClause,
  triageVerdictOf,
  verdictLeadsWithHold,
  voiceForCallAnchor,
  voiceForRelay,
} from "../../../talk/answerContext.js";
import { type CallEntry, type CallSegment, OWNER_SPEAKER } from "../../../talk/callRecord.js";
import { callSegmentAnchor } from "../../../talk/cardUtterance.js";

const CALL = "a0000044-0000-4000-8000-000000000047";
const TURN = "a0000025-0000-4000-8000-000000000028";

const segment = ({
  beganIso,
  id,
  text,
  who,
}: {
  beganIso: string;
  id: string;
  text: string;
  who: CallSegment["who"];
}): CallSegment => ({ atIso: beganIso, beganIso, final: true, id, open: undefined, text, who });

const relayLine = ({ atIso, turnId }: { atIso: string; turnId: string }): CallEntry => ({
  about: "",
  atIso,
  detail: "running talk relay",
  heard: "",
  kind: "relay",
  outcome: "sending",
  say: "",
  turnId,
});

/** A call's turns: the voice's two-sentence question, the owner's yes, and the voice's ack begun after the owner's words. */
const SEGMENTS: readonly CallSegment[] = [
  segment({ beganIso: "2026-10-13T23:38:10.000Z", id: "v0", text: "Earlier card.", who: "voice" }),
  segment({
    beganIso: "2026-10-13T23:38:26.835Z",
    id: "v1",
    text: " Needs more info. Next: a proposed post. Needs more info here too?",
    who: "voice",
  }),
  segment({ beganIso: "2026-10-13T23:38:45.095Z", id: "h1", text: " Yes, of course", who: OWNER_SPEAKER }),
  segment({ beganIso: "2026-10-13T23:38:47.624Z", id: "v2", text: " Yep, on it.", who: "voice" }),
];

describe("answeredVoiceTurn", () => {
  it("is the voice segment begun last strictly before the owner's, taken whole — never the ack begun after", () => {
    expect(answeredVoiceTurn({ callId: CALL, ownerSegmentId: "h1", segments: SEGMENTS })).toStrictEqual({
      beganIso: "2026-10-13T23:38:26.835Z",
      pointer: `talk-call:${CALL}#v1`,
      text: "Needs more info. Next: a proposed post. Needs more info here too?",
    });
  });

  it("excludes a voice segment begun at the same instant as the owner's", () => {
    const tied = [...SEGMENTS, segment({ beganIso: "2026-10-13T23:38:45.095Z", id: "v9", text: "tie", who: "voice" })];
    expect(answeredVoiceTurn({ callId: CALL, ownerSegmentId: "h1", segments: tied })!.pointer).toBe(
      `talk-call:${CALL}#v1`,
    );
  });

  it("is undefined when no voice segment began before the owner's, or the id is not a segment of the owner's", () => {
    expect(answeredVoiceTurn({ callId: CALL, ownerSegmentId: "h1", segments: SEGMENTS.slice(2) })).toBe(undefined);
    expect(answeredVoiceTurn({ callId: CALL, ownerSegmentId: "v1", segments: SEGMENTS })).toBe(undefined);
  });
});

describe("voiceForCallAnchor", () => {
  it("matches the anchor as talk transcript mints it, hashed form included", () => {
    const odd = segment({ beganIso: "2026-10-13T23:38:45.095Z", id: "seg:1%odd", text: "yes", who: OWNER_SPEAKER });
    const segments = [SEGMENTS[1]!, odd];
    const anchor = callSegmentAnchor({ callId: CALL, segmentId: odd.id });
    expect(anchor.startsWith(`call:${CALL}#~`)).toBe(true);
    expect(voiceForCallAnchor({ anchor, callId: CALL, segments })).toStrictEqual({
      kind: "found",
      turn: {
        beganIso: "2026-10-13T23:38:26.835Z",
        pointer: `talk-call:${CALL}#v1`,
        text: "Needs more info. Next: a proposed post. Needs more info here too?",
      },
    });
  });

  it("says which anchor named no segment of the owner's", () => {
    expect(voiceForCallAnchor({ anchor: `call:${CALL}#nope`, callId: CALL, segments: SEGMENTS })).toStrictEqual({
      kind: "not-found",
      why: `call ${CALL} holds no segment of the owner's that call:${CALL}#nope names`,
    });
  });

  it("says the voice said nothing before the owner's words", () => {
    const anchor = callSegmentAnchor({ callId: CALL, segmentId: "h1" });
    expect(voiceForCallAnchor({ anchor, callId: CALL, segments: SEGMENTS.slice(2) })).toStrictEqual({
      kind: "not-found",
      why: `the voice said nothing in call ${CALL} before the owner's words began`,
    });
  });
});

describe("voiceForRelay", () => {
  const RELAY = relayLine({ atIso: "2026-10-13T23:38:49.275Z", turnId: TURN });

  it("finds the owner's stretch by the relay's words, punctuation aside, and answers with the voice turn before it", () => {
    const read = voiceForRelay({
      callId: CALL,
      entries: [RELAY],
      heard: "yes of course",
      segments: SEGMENTS,
      turnId: TURN,
    });
    expect(read).toStrictEqual({
      kind: "found",
      turn: {
        beganIso: "2026-10-13T23:38:26.835Z",
        pointer: `talk-call:${CALL}#v1`,
        text: "Needs more info. Next: a proposed post. Needs more info here too?",
      },
    });
  });

  it("walks back over consecutive segments of the owner's the relay carried, to the first of the stretch", () => {
    const stretch = [
      SEGMENTS[0]!,
      segment({ beganIso: "2026-10-13T23:38:20.000Z", id: "h0", text: "Send the", who: OWNER_SPEAKER }),
      segment({ beganIso: "2026-10-13T23:38:21.000Z", id: "h0b", text: "deck now.", who: OWNER_SPEAKER }),
    ];
    const read = voiceForRelay({
      callId: CALL,
      entries: [RELAY],
      heard: "Send the deck now.",
      segments: stretch,
      turnId: TURN,
    });
    expect(read).toStrictEqual({
      kind: "found",
      turn: { beganIso: "2026-10-13T23:38:10.000Z", pointer: `talk-call:${CALL}#v0`, text: "Earlier card." },
    });
  });

  it("walks back across a voice turn to the first words the relay carried, answering the question before them", () => {
    const across = [
      segment({ beganIso: "2026-10-13T23:38:00.000Z", id: "v1", text: "Approve A?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:10.000Z", id: "h1", text: "yes", who: OWNER_SPEAKER }),
      segment({ beganIso: "2026-10-13T23:38:20.000Z", id: "v2", text: "And reject B?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:30.000Z", id: "h2", text: "actually no", who: OWNER_SPEAKER }),
    ];
    const read = voiceForRelay({
      callId: CALL,
      entries: [RELAY],
      heard: "yes actually no",
      segments: across,
      turnId: TURN,
    });
    expect(read).toStrictEqual({
      kind: "found",
      turn: { beganIso: "2026-10-13T23:38:00.000Z", pointer: `talk-call:${CALL}#v1`, text: "Approve A?" },
    });
  });

  it("never walks back to words of the owner's the relay heard only AFTER the ones already matched", () => {
    const earlier = [
      segment({ beganIso: "2026-10-13T23:38:00.000Z", id: "v1", text: "Approve A?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:10.000Z", id: "h1", text: "no", who: OWNER_SPEAKER }),
      segment({ beganIso: "2026-10-13T23:38:20.000Z", id: "v2", text: "And reject B?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:30.000Z", id: "h2", text: "yes", who: OWNER_SPEAKER }),
    ];
    const read = voiceForRelay({ callId: CALL, entries: [RELAY], heard: "yes no", segments: earlier, turnId: TURN });
    expect(read).toStrictEqual({
      kind: "found",
      turn: { beganIso: "2026-10-13T23:38:20.000Z", pointer: `talk-call:${CALL}#v2`, text: "And reject B?" },
    });
  });

  it("takes the run whose words are exactly what the relay heard, never a later segment that only ends them", () => {
    const suffix = [
      segment({ beganIso: "2026-10-13T23:38:00.000Z", id: "v1", text: "Approve A?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:10.000Z", id: "h1", text: "yes please", who: OWNER_SPEAKER }),
      segment({ beganIso: "2026-10-13T23:38:20.000Z", id: "v2", text: "Approve B?", who: "voice" }),
      segment({ beganIso: "2026-10-13T23:38:30.000Z", id: "h2", text: "please", who: OWNER_SPEAKER }),
    ];
    const read = voiceForRelay({ callId: CALL, entries: [RELAY], heard: "yes please", segments: suffix, turnId: TURN });
    expect(read).toStrictEqual({
      kind: "found",
      turn: { beganIso: "2026-10-13T23:38:00.000Z", pointer: `talk-call:${CALL}#v1`, text: "Approve A?" },
    });
  });

  it("is not found when the call records no relay line for the turn", () => {
    expect(
      voiceForRelay({ callId: CALL, entries: [], heard: "Yes, of course", segments: SEGMENTS, turnId: TURN }),
    ).toStrictEqual({ kind: "not-found", why: `call ${CALL} records no relay line for turn ${TURN}` });
  });

  it("is not found when no segment of the owner's before the relay line carries its words", () => {
    expect(
      voiceForRelay({ callId: CALL, entries: [RELAY], heard: "merge it", segments: SEGMENTS, turnId: TURN }),
    ).toStrictEqual({
      kind: "not-found",
      why: `no owner segment before the relay line in call ${CALL} carries its words`,
    });
  });
});

describe("triage verdicts", () => {
  const STORED: TriageVerdictRead = {
    kind: "stored",
    ruling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" },
  };

  it("reads an absent field as not recorded, null as none, and a ruling as stored", () => {
    expect(triageVerdictOf({ slug: "talk-x", triageRuling: undefined })).toStrictEqual({
      kind: "not-recorded",
      slug: "talk-x",
    });
    expect(triageVerdictOf({ slug: "talk-x", triageRuling: null })).toStrictEqual({ kind: "none" });
    expect(triageVerdictOf({ slug: "talk-x", triageRuling: { label: undefined, verdict: "send-it" } })).toStrictEqual({
      kind: "stored",
      ruling: { label: undefined, verdict: "send-it" },
    });
  });

  it.each([
    ["a stored needs-more-info", STORED, true],
    ["a stored send-it", { kind: "stored", ruling: { label: undefined, verdict: "send-it" } }, false],
    ["no verdict recorded", { kind: "not-recorded", slug: "talk-x" }, true],
    ["an unreadable verdict", { kind: "unreadable", why: "gone" }, true],
    ["a relay carrying none", { kind: "none" }, false],
    ["no relay", { kind: "not-applicable" }, false],
  ] as const)("leads with the hold for %s: %s", (_label, triage, holds) => {
    expect(verdictLeadsWithHold({ triage })).toBe(holds);
  });

  it("prints the stored verdict's code and its sentence, or its code and defect in a budgeted line", () => {
    expect(triageVerdictClause({ triage: STORED })).toBe(
      "triage verdict needs-more-info: The owner's triage verdict on this card: needs more info — find what is missing " +
        "and put it on the card. What was wrong: it made a claim with no receipt — no link to where the owner can " +
        "see it, no screenshot of it.",
    );
    expect(compactVerdictClause({ triage: STORED })).toBe(
      "triage verdict needs-more-info, what was wrong: no-receipts",
    );
    expect(
      compactVerdictClause({
        triage: { kind: "stored", ruling: { label: "waiting-on-me", verdict: "park-working-session" } },
      }),
    ).toBe("triage verdict park-working-session, label waiting-on-me");
  });
});

describe("quotedVoice", () => {
  it("keeps a short turn whole and turns its double quotes single", () => {
    expect(quotedVoice({ chars: 240, text: ' Say "yes"\n now? ' })).toBe("Say 'yes' now?");
  });

  it("keeps the END of a long turn, where its question sits, in exactly the characters asked", () => {
    const quote = quotedVoice({ chars: 20, text: "a long preamble about the card. Ship it?" });
    expect(quote).toBe("… the card. Ship it?");
    expect(quote.length).toBe(20);
  });

  it("flattens control characters and mends a split surrogate, so no character escapes past its UTF-8 bytes", () => {
    const quote = quotedVoice({ chars: 6, text: "ok\u0001\u0002 🚀🚀 \ud800" });
    expect(quote).toBe("… 🚀 �");
    expect(Buffer.byteLength(JSON.stringify(quote), "utf8")).toBe(14);
  });
});

describe("answerContextRequestOf", () => {
  it("names a relay turn, a call utterance, or neither", () => {
    expect(answerContextRequestOf({ anchor: `talk:${TURN}` })).toStrictEqual({ kind: "relay", turnId: TURN });
    expect(answerContextRequestOf({ anchor: `call:${CALL}#h1` })).toStrictEqual({
      anchor: `call:${CALL}#h1`,
      callId: CALL,
      kind: "call",
    });
    expect(answerContextRequestOf({ anchor: "talk:" })).toStrictEqual({ anchor: "talk:", kind: "other" });
  });
});
