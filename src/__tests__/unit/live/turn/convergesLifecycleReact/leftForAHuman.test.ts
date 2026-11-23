/*
 * A tag the bot judged and deliberately left for a person: the plan names its own ending, and the message ends
 * wearing `:for-a-human:` alone, retiring `:ack:` and retired by it.
 */
import { describe, expect, it } from "vitest";

import { triagedAskIndicatorPlan } from "../../../../../cli/commands/turn/triagedIndicators.js";
import type { AskIdentity } from "../../../../../live/ask/identity.js";
import { PENDING_ROUTE_STEPS } from "../../../../../live/turn/answer.js";
import { finaliseIndicators } from "../../../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../../reactingTransportFake.js";
import { ACKNOWLEDGED, CAPTURE, CHROME, PROVENANCE, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

/** The profile-less default for this ending, so a temp home needs no `profile.json`. */
const FOR_A_HUMAN = "for-a-human";

describe("convergesLifecycleReact — judged, left for a person to answer", () => {
  /**
   * The fourth ending, the owner's call: a tag the bot judged and
   * deliberately left for a person. `:ack:` says nothing is owed, which is the opposite of what is true here,
   * so the plan must name its own kind and the message must end wearing `:for-a-human:` alone.
   */
  const LEFT: AskIdentity = { channel: "C_PILOT", messageTs: "1791851522.000100", threadTs: "1791851522.000100" };

  function seamsFor({ reactions }: { reactions: Set<string> }): ReturnType<typeof liveIndicatorSeams> {
    return liveIndicatorSeams({
      askIdentity: LEFT,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing: new Map([[LEFT.messageTs, reactions]]) }),
      turnChrome: CHROME,
      turnId: `triaged-${LEFT.messageTs}`,
    });
  }

  it("plans the left-for-a-human ending, never the triaged one, for a captured ask", () => {
    const plan = triagedAskIndicatorPlan({
      ending: "left-for-a-human",
      entry: {
        capturedIso: "2026-10-13T06:12:02.000Z",
        channel: LEFT.channel,
        lastEvent: { ...LEFT, kind: "captured", surface: "channel", tsIso: "2026-10-13T06:12:02.000Z", userId: "U_DR" },
        messageTs: LEFT.messageTs,
        state: "captured",
        surface: "channel",
        threadTs: LEFT.threadTs,
        userId: "U_DR",
      },
      messageTs: LEFT.messageTs,
      reason: "a lockout is IT's to answer",
    });

    expect(plan).toEqual({
      kind: "settle",
      state: {
        kind: "left-for-a-human",
        readerReason: "a lockout is IT's to answer",
        reason: "a lockout is IT's to answer",
      },
      steps: PENDING_ROUTE_STEPS,
      turnId: "triaged-1791851522.000100",
    });
  });

  it("converges the standing :eyes: to :for-a-human: alone", async () => {
    const reactions = new Set<string>([CAPTURE]);

    await finaliseIndicators({
      seams: seamsFor({ reactions }),
      state: { kind: "left-for-a-human", readerReason: "a person should answer", reason: "a person should answer" },
    });

    expect([...reactions]).toEqual([FOR_A_HUMAN]);
  });

  it("retires a stale :ack: rather than wearing both, and is retired in turn by :ack:", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const seams = seamsFor({ reactions });

    await seams.settleReaction({ reaction: "acknowledged" });
    await seams.settleReaction({ reaction: "for-a-human" });
    const afterForAHuman = [...reactions];
    await seams.settleReaction({ reaction: "acknowledged" });

    expect(afterForAHuman).toEqual([FOR_A_HUMAN]);
    expect([...reactions]).toEqual([ACKNOWLEDGED]);
  });
});
