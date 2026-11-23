import { describe, expect, it } from "vitest";

import { type ChairTraffic, EMPTY_INBOUND, inboundSentence, judgeInbound } from "../../../supervisor/inbound.js";
import { INTAKE_GRACE_MS, type IntakeMark } from "../../../supervisor/intake.js";
import type { PeerInbound } from "../../../transcripts/peerTraffic.js";

const OLD = "c3fd48ad-3927-4066-9248-0f93947b24c3";
const NEW = "c5291c85-2071-49f6-a80e-845c43a7ff1d";
const OLD_PINNED = "2026-09-12T01:04:40.023Z";
const HANDOVER = "2026-09-12T03:26:57.557Z";
const NOW = "2026-09-12T06:00:00.000Z";
const LOOP = "live-bot-loop-12sep-a-fb";

/** A peer message at `timestamp`, from `senderName`. */
const message = ({
  msgId,
  timestamp,
  senderName = LOOP,
}: {
  msgId: string;
  timestamp: string;
  senderName?: string;
}): PeerInbound => ({
  body: "report",
  delivery: "queued",
  lineNumber: 1,
  msgId,
  senderName,
  timestamp,
  uuid: `u-${msgId}`,
});

/** The chair that held the pin until {@link HANDOVER}, carrying `over`. */
const oldChair = (over: Partial<ChairTraffic> = {}): ChairTraffic => ({
  chairSessionId: OLD,
  fromIso: OLD_PINNED,
  inbound: [],
  results: [],
  sends: [],
  tenures: [{ fromIso: OLD_PINNED, untilIso: HANDOVER }],
  ...over,
});

/** The chair holding the pin now, carrying `over`. */
const newChair = (over: Partial<ChairTraffic> = {}): ChairTraffic => ({
  chairSessionId: NEW,
  fromIso: HANDOVER,
  inbound: [],
  results: [],
  sends: [],
  tenures: [{ fromIso: HANDOVER, untilIso: undefined }],
  ...over,
});

/** A `SendMessage` to `to` at `timestamp`, with a result that reports `success` and delivered `msgId`. */
const sent = ({
  to,
  timestamp,
  success = true,
  msgId = "delivered",
}: {
  to: string;
  timestamp: string;
  success?: boolean;
  msgId?: string;
}): Pick<ChairTraffic, "sends" | "results"> => ({
  results: [{ msgId, success, toolUseId: `t-${to}-${timestamp}` }],
  sends: [{ timestamp, to, toolUseId: `t-${to}-${timestamp}` }],
});

const LATE = message({ msgId: "late", timestamp: "2026-09-12T03:40:05.000Z" });

const judge = ({ chairs, marks = [] }: { chairs: readonly ChairTraffic[]; marks?: readonly IntakeMark[] }) =>
  judgeInbound({ chairs, graceMs: INTAKE_GRACE_MS, marks, nowIso: NOW });

describe("judgeInbound", () => {
  it("carries a message that landed after the chair handed over and nobody answered", () => {
    const finding = judge({ chairs: [oldChair({ inbound: [LATE] }), newChair()] });

    expect(finding.carried).toEqual([
      { chairSessionId: OLD, message: LATE, placement: "after-pin", pointer: `transcript:${OLD}#u-late` },
    ]);
    expect(finding.unanswered).toEqual([]);
    expect(finding.read).toBe(1);
  });

  it("lists an unanswered message inside the chair's own tenure as unanswered, not carried", () => {
    const inSpan = message({ msgId: "in", timestamp: "2026-09-12T02:33:20.000Z" });

    const finding = judge({ chairs: [oldChair({ inbound: [inSpan] }), newChair()] });

    expect(finding.carried).toEqual([]);
    expect(finding.unanswered.map((item) => item.placement)).toEqual(["in-span"]);
  });

  it("never carries a message on a chair that took the pin BACK, whichever tenure it landed in", () => {
    const retaken = oldChair({
      inbound: [message({ msgId: "back", timestamp: "2026-09-12T04:30:00.000Z" })],
      tenures: [
        { fromIso: OLD_PINNED, untilIso: HANDOVER },
        { fromIso: "2026-09-12T04:00:00.000Z", untilIso: undefined },
      ],
    });

    const finding = judge({
      chairs: [retaken, newChair({ tenures: [{ fromIso: HANDOVER, untilIso: "2026-09-12T04:00:00.000Z" }] })],
    });

    expect(finding.carried).toEqual([]);
    expect(finding.unanswered.map((item) => item.message.msgId)).toEqual(["back"]);
  });

  it("counts a successful reply from ANY chair to the exact sender, at or after the message, as answered", () => {
    const finding = judge({
      chairs: [oldChair({ inbound: [LATE] }), newChair(sent({ timestamp: "2026-09-12T03:45:00.000Z", to: LOOP }))],
    });

    expect(finding.answered).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("does not count a failed send, an earlier send, or a send to a different name as answering it", () => {
    const failed = sent({ success: false, timestamp: "2026-09-12T03:45:00.000Z", to: LOOP });
    const earlier = sent({ timestamp: "2026-09-12T03:00:00.000Z", to: LOOP });
    const otherName = sent({ timestamp: "2026-09-12T03:50:00.000Z", to: "live-bot-loop-12sep-b-86" });

    const finding = judge({
      chairs: [
        oldChair({ inbound: [LATE], ...earlier }),
        newChair({
          results: [...failed.results, ...otherName.results],
          sends: [...failed.sends, ...otherName.sends],
        }),
      ],
    });

    expect(finding.answered).toBe(0);
    expect(finding.carried.length).toBe(1);
  });

  it("counts a message a chair's own successful SendMessage delivered as chain traffic, matched on msg_id", () => {
    const handshake = message({
      msgId: "hs",
      senderName: "fresh-supervisor-handoff-9241-d6",
      timestamp: "2026-09-12T03:30:00.000Z",
    });

    const finding = judge({
      chairs: [
        oldChair({ inbound: [handshake] }),
        newChair(sent({ msgId: "hs", timestamp: "2026-09-12T03:29:59.000Z", to: "fresh-supervisor-handoff-9240-f7" })),
      ],
    });

    expect(finding.chainTraffic).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("does not exclude a message whose msg_id only a result with no matching SendMessage call reported", () => {
    const handshake = message({
      msgId: "hs",
      senderName: "fresh-supervisor-handoff-9241-d6",
      timestamp: "2026-09-12T03:30:00.000Z",
    });

    const finding = judge({
      chairs: [
        oldChair({ inbound: [handshake] }),
        newChair({ results: [{ msgId: "hs", success: true, toolUseId: "other-tool" }] }),
      ],
    });

    expect(finding.chainTraffic).toBe(0);
    expect(finding.carried.length).toBe(1);
  });

  it("clears a message a mark names by the pointer of ANY record of it", () => {
    const direct = { ...LATE, delivery: "direct" as const, uuid: "u-late-direct" };
    const mark: IntakeMark = {
      byClaudeSessionId: NEW,
      kind: "answered",
      markedAtIso: NOW,
      pointer: `transcript:${OLD}#u-late-direct`,
      witness: "acted on it with cmux send",
    };

    const finding = judge({ chairs: [oldChair({ inbound: [LATE, direct] }), newChair()], marks: [mark] });

    expect(finding.read).toBe(1);
    expect(finding.marked).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("honours a mark naming a record of the message that sits BEFORE the floor, when another record is inside it", () => {
    const early = { ...LATE, timestamp: "2026-09-12T03:39:59.000Z", uuid: "u-early" };
    const late = { ...LATE, delivery: "direct" as const, timestamp: "2026-09-12T03:40:01.000Z", uuid: "u-inside" };
    const mark: IntakeMark = {
      byClaudeSessionId: NEW,
      kind: "no-ask",
      markedAtIso: NOW,
      pointer: `transcript:${OLD}#u-early`,
      witness: "a handover note, nothing to answer",
    };

    const finding = judge({
      chairs: [oldChair({ fromIso: "2026-09-12T03:40:00.000Z", inbound: [early, late] }), newChair()],
      marks: [mark],
    });

    expect(finding.read).toBe(1);
    expect(finding.marked).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("times a message by its EARLIEST record, so a later duplicate inside the floor cannot un-answer it", () => {
    const queued = { ...LATE, timestamp: "2026-09-12T03:26:00.000Z", uuid: "u-queued" };
    const direct = { ...LATE, delivery: "direct" as const, timestamp: "2026-09-12T03:28:00.000Z", uuid: "u-direct" };

    const finding = judge({
      chairs: [
        oldChair({
          fromIso: "2026-09-12T03:27:00.000Z",
          inbound: [queued, direct],
          ...sent({ timestamp: "2026-09-12T03:27:00.000Z", to: LOOP }),
        }),
        newChair(),
      ],
    });

    expect(finding.read).toBe(1);
    expect(finding.answered).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("times a message by its earliest record even when a later duplicate comes first in the file", () => {
    const later = { ...LATE, delivery: "direct" as const, timestamp: "2026-09-12T03:30:00.000Z", uuid: "u-later" };
    const earlier = { ...LATE, timestamp: "2026-09-12T03:20:00.000Z", uuid: "u-earlier" };

    const finding = judge({
      chairs: [
        oldChair({ inbound: [later, earlier], ...sent({ timestamp: "2026-09-12T03:25:00.000Z", to: LOOP }) }),
        newChair(),
      ],
    });

    expect(finding.read).toBe(1);
    expect(finding.answered).toBe(1);
    expect(finding.carried).toEqual([]);
  });

  it("joins a call to its result WITHIN one chair, so another chair's success cannot back a failed send", () => {
    const failedHere = {
      results: [{ msgId: "m-other", success: false, toolUseId: "t1" }],
      sends: [{ timestamp: "2026-09-12T03:45:00.000Z", to: LOOP, toolUseId: "t1" }],
    };
    const succeededThere = {
      results: [{ msgId: "m-other", success: true, toolUseId: "t1" }],
      sends: [{ timestamp: "2026-09-12T03:46:00.000Z", to: "someone-else-14", toolUseId: "t1" }],
    };

    const finding = judge({ chairs: [oldChair({ inbound: [LATE], ...failedHere }), newChair(succeededThere)] });

    expect(finding.answered).toBe(0);
    expect(finding.carried.map((item) => item.message.msgId)).toEqual(["late"]);
  });

  it("does not let a send to a ref-disambiguated namesake answer a message from the bare name", () => {
    const toNamesake = sent({ timestamp: "2026-09-12T03:45:00.000Z", to: `${LOOP} [bbbbbb]` });

    const finding = judge({ chairs: [oldChair({ inbound: [LATE] }), newChair(toNamesake)] });

    expect(finding.answered).toBe(0);
    expect(finding.carried.map((item) => item.message.msgId)).toEqual(["late"]);
  });

  it("counts a successful reply whose result named no msg_id, and never treats that blank as chain traffic", () => {
    const noMsgId = {
      results: [{ msgId: "", success: true, toolUseId: "t1" }],
      sends: [{ timestamp: "2026-09-12T03:45:00.000Z", to: LOOP, toolUseId: "t1" }],
    };
    const blankIdMessage = { ...LATE, msgId: "", uuid: "u-blank" };

    const finding = judge({ chairs: [oldChair({ inbound: [LATE, blankIdMessage] }), newChair(noMsgId)] });

    expect(finding.answered).toBe(2);
    expect(finding.chainTraffic).toBe(0);
    expect(finding.carried).toEqual([]);
  });

  it("carries a message whose own instant will not read, and one on a chair with no recorded tenure", () => {
    const undated = { ...LATE, msgId: "undated", timestamp: "", uuid: "u-undated" };
    const unplaceableChair = newChair({
      chairSessionId: "a0000124-0000-4000-8000-000000000137",
      inbound: [message({ msgId: "orphan", timestamp: "2026-09-12T04:00:00.000Z" })],
      tenures: [],
    });

    const finding = judge({ chairs: [oldChair({ inbound: [undated] }), unplaceableChair] });

    expect(finding.carried.map((item) => item.message.msgId).toSorted()).toEqual(["orphan", "undated"]);
    expect(finding.unanswered).toEqual([]);
  });

  it("lets an undated record lead its own dated duplicate, so the message stays unplaceable", () => {
    const undated = { ...LATE, timestamp: "", uuid: "u-undated" };
    const dated = { ...LATE, delivery: "direct" as const, timestamp: "2026-09-12T02:00:00.000Z", uuid: "u-dated" };

    const finding = judge({ chairs: [oldChair({ inbound: [undated, dated] }), newChair()] });

    expect(finding.read).toBe(1);
    expect(finding.carried.map((item) => item.message.uuid)).toEqual(["u-undated"]);
    expect(finding.unanswered).toEqual([]);
  });

  it("holds a message younger than the grace window, and drops one before the chair's floor", () => {
    const young = message({ msgId: "young", timestamp: "2026-09-12T05:50:00.000Z" });
    const beforeFloor = message({ msgId: "boot", timestamp: "2026-09-12T00:56:42.768Z" });

    const finding = judge({ chairs: [oldChair({ inbound: [young, beforeFloor] }), newChair()] });

    expect(finding.inGrace).toBe(1);
    expect(finding.read).toBe(1);
    expect(finding.carried).toEqual([]);
  });
});

describe("inboundSentence", () => {
  it("says nothing when nothing is open", () => {
    expect(inboundSentence({ finding: EMPTY_INBOUND })).toBe("");
  });

  it("counts the carried and the unanswered in one sentence", () => {
    const inSpan = message({ msgId: "in", timestamp: "2026-09-12T02:33:20.000Z" });

    const finding = judge({ chairs: [oldChair({ inbound: [LATE, inSpan] }), newChair()] });

    expect(inboundSentence({ finding })).toBe(
      "1 message(s) from other sessions landed on a chair after it handed over and 1 more got no reply inside a " +
        "chair's own span; `slopweaver supervisor intake` lists them.",
    );
  });
});
