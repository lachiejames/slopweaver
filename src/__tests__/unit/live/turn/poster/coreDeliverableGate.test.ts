import { describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  POSTED,
  PROVENANCE,
  READY,
  REPLY,
  warnRefusal,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("the core-deliverable gate, wired", () => {
  /**
   * The wiring is the point, not the gate: the gate reads the ASK'S QUESTION, and the only place that
   * question exists on the send path is `reply.question`. A gate wired with the answer alone would have
   * nothing to compare against and would pass everything, which is how a measured answer reached Slack
   * without the link its ask existed for after six clean review rounds.
   */
  it("REFUSES a deploy answer that carries no clickable link, and touches the transport not at all", async () => {
    const log: Recorded[] = [];
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: fakeTransport({ log }),
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const refusal = await warnRefusal({
      offered: poster.postAnswer({
        answer: minimalAnswer(),
        askIdentity: DM_MENTION,
        documents: [],
        reply: { ...REPLY, question: "deploy those two monitors locally and tell me how they look" },
        uploads: [],
      }),
    });

    expect(refusal).toContain("ANSWER_MISSING_DELIVERABLE_DEPLOY_LINK");
    expect(log).toEqual([]);
  });

  it("sends the SAME answer for a question that asked for no artifact class", async () => {
    // The gate is scoped by the question, so an ordinary ask is untouched by it — proved on the same bytes
    // the case above refuses, so the difference is demonstrably the question and nothing else.
    const log: Recorded[] = [];
    const transport: SlackWriteTransport = { ...fakeTransport({ log }), postAssistantMessage: async () => POSTED };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const outcome = await poster.postAnswer({
      answer: minimalAnswer(),
      askIdentity: DM_MENTION,
      documents: [],
      reply: REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({ kind: "posted", missingMedia: [], ref: { channel: POSTED.channel, ts: POSTED.ts } });
  });
});
