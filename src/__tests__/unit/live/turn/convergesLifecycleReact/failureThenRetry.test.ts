/*
 * A failed attempt followed by a successful retry, and the reverse: the message ends wearing the later reaction
 * alone, and a person's own reaction is left standing.
 */
import { describe, expect, it } from "vitest";

import { PENDING_ROUTE_STEPS } from "../../../../../live/turn/answer.js";
import type { TerminalReaction } from "../../../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../../reactingTransportFake.js";
import { CAPTURE, CHROME, COMPLETION, PROVENANCE, STOPPED, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("convergesLifecycleReact — failure, then retry", () => {
  /**
   * Measured, `C_TAGGED` ts `1787540563.699759`: the failed attempt settled the tag to
   * `:warning:` and the successful retry, ten minutes later, added `:white_check_mark:`. The old
   * settle removed only the CAPTURE emoji — already gone — so the owner-visible message ended up claiming
   * the turn had both failed and succeeded.
   */
  async function settleTwice({
    first,
    home,
    second,
    standing,
  }: {
    first: TerminalReaction;
    home: string;
    second: TerminalReaction;
    standing: Map<string, Set<string>>;
  }): Promise<void> {
    const askIdentity = { channel: "C_TAGGED", messageTs: "1787540563.699759", threadTs: "1787540563.699759" };
    const seams = liveIndicatorSeams({
      askIdentity,
      doorLedger: memoryDoorLedger().port,
      home,
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });
    await seams.settleReaction({ reaction: first });
    await seams.settleReaction({ reaction: second });
  }

  it("leaves ONLY the completion reaction when a failed attempt is followed by a successful retry", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([["1787540563.699759", reactions]]);

    await settleTwice({ first: "stopped", home: tempHome(), second: "completion", standing });

    expect([...reactions]).toEqual([COMPLETION]);
  });

  it("leaves ONLY the stopped reaction when a successful turn is followed by a failing re-settle", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([["1787540563.699759", reactions]]);

    await settleTwice({ first: "completion", home: tempHome(), second: "stopped", standing });

    expect([...reactions]).toEqual([STOPPED]);
  });

  it("leaves a HUMAN's own reaction alone — convergence is scoped to the emoji the bot raises", async () => {
    const reactions = new Set<string>([CAPTURE, "tada"]);
    const standing = new Map([["1787540563.699759", reactions]]);

    await settleTwice({ first: "stopped", home: tempHome(), second: "completion", standing });

    expect([...reactions]).toEqual(["tada", COMPLETION]);
  });
});
