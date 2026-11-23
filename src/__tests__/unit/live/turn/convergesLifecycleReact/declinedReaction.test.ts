/*
 * A reaction call Slack declined: the settle reports it, stops rather than half-converging, and
 * `finaliseIndicators` carries the reason instead of reporting a settled turn.
 */
import { describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { err } from "../../../../../lib/result.js";
import { PENDING_ROUTE_STEPS } from "../../../../../live/turn/answer.js";
import { finaliseIndicators } from "../../../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../../reactingTransportFake.js";
import { CAPTURE, CHROME, COMPLETION, PROVENANCE, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("convergesLifecycleReact — a declined reaction call is reported, never swallowed", () => {
  /**
   * Found while sweeping a real 19-ask backlog: `settleTagReaction` awaited both transport
   * calls and ignored what they RETURNED, so a `reactions.add` Slack declined resolved as `ok(undefined)` over
   * a message left wearing no lifecycle reaction at all. `removeReaction` already treats `no_reaction` as
   * success, so a `false` from either method means the reaction genuinely did not move.
   */
  function decliningTransport({
    declines,
    standing,
  }: {
    declines: string;
    standing: Map<string, Set<string>>;
  }): SlackWriteTransport {
    const base = reactingTransport({ standing });
    return {
      ...base,
      addReaction: async ({ name, posted }) => (name === declines ? false : base.addReaction({ name, posted })),
      removeReaction: async ({ name, posted }) => (name === declines ? false : base.removeReaction({ name, posted })),
    };
  }

  function seamsOver({ transport }: { transport: SlackWriteTransport }): ReturnType<typeof liveIndicatorSeams> {
    return liveIndicatorSeams({
      askIdentity: { channel: "C_TAGGED", messageTs: "1787540563.699759", threadTs: "1787540563.699759" },
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });
  }

  it("reports the reaction unsettled when Slack declines the ADD", async () => {
    const standing = new Map([["1787540563.699759", new Set<string>([CAPTURE])]]);
    const seams = seamsOver({ transport: decliningTransport({ declines: COMPLETION, standing }) });

    await expect(seams.settleReaction({ reaction: "completion" })).resolves.toEqual(
      err(`slack declined to add the :${COMPLETION}: reaction`),
    );
  });

  it("reports the reaction unsettled when Slack declines a RETIRE, and stops rather than half-converging", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([["1787540563.699759", reactions]]);
    const seams = seamsOver({ transport: decliningTransport({ declines: CAPTURE, standing }) });

    await expect(seams.settleReaction({ reaction: "completion" })).resolves.toEqual(
      err(`slack declined to remove the stale :${CAPTURE}: reaction`),
    );
    expect([...reactions]).toEqual([CAPTURE]);
  });

  it("surfaces that reason through finaliseIndicators rather than reporting a settled turn", async () => {
    const standing = new Map([["1787540563.699759", new Set<string>([CAPTURE])]]);
    const seams = seamsOver({ transport: decliningTransport({ declines: COMPLETION, standing }) });

    const finalisation = await finaliseIndicators({
      seams,
      state: { kind: "answered", readerReason: "posted", reason: "posted" },
    });

    expect(finalisation.failures).toEqual([
      `the tag's reaction was not settled to :completion: — slack declined to add the :${COMPLETION}: reaction`,
    ]);
  });
});
