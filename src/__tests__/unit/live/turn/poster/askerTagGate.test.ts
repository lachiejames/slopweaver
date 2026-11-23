import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ReplyContext } from "../../../../../admit/withhold.js";
import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { answerDigestOf, liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import type { ResolvedMentions } from "../../../../../outbound/slack/render.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHANNEL_MENTION,
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

describe("the asker-tag gate, wired", () => {
  /**
   * The wiring is the point, exactly as it is for the core-deliverable gate above: this gate reads the
   * ASKER and the SURFACE, and both exist on the send path only as `reply.askedBy`/`reply.surface`. A gate
   * wired from the answer alone would have nobody to compare against and would pass everything, which is
   * how a colleague's question was answered in a card that never mentioned them.
   */
  const CHANNEL_REPLY: ReplyContext = { ...REPLY, channel: "C1", surface: "channel" };

  /** A poster over a transport that records, and accepts the answer post rather than throwing on it. */
  function sendingPoster({ log, mentions }: { log: Recorded[]; mentions: ResolvedMentions }) {
    const transport: SlackWriteTransport = { ...fakeTransport({ log }), postAssistantMessage: async () => POSTED };
    return liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: CHANNEL_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });
  }

  it("REFUSES a channel answer that tags nobody, and touches the transport not at all", async () => {
    const log: Recorded[] = [];

    const refusal = await warnRefusal({
      offered: sendingPoster({ log, mentions: NO_MENTIONS }).postAnswer({
        answer: minimalAnswer(),
        askIdentity: CHANNEL_MENTION,
        documents: [],
        reply: CHANNEL_REPLY,
        uploads: [],
      }),
    });

    expect(refusal).toContain("ANSWER_DOES_NOT_TAG_ASKER");
    expect(log).toEqual([]);
  });

  it("sends once the asker is tagged above the fold — same ask, one added run", async () => {
    const log: Recorded[] = [];
    const tagged: AnswerFormAnswer = {
      ...minimalAnswer(),
      index: [
        [
          { person: "@asker", type: "mention" },
          { text: " — you have 3 open PRs.", type: "text" },
        ],
      ],
    };
    // A new digest needs a new verdict: adding the run changes the answer's own bytes, which is exactly what
    // the reviewer gate binds to. Built through the same helper the shared fixture uses.
    const transport: SlackWriteTransport = { ...fakeTransport({ log }), postAssistantMessage: async () => POSTED };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: CHANNEL_MENTION,
      freshnessNote: undefined,
      verdict: { ...CLEAN_VERDICT, answerDigest: answerDigestOf({ answer: tagged }) },
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: { groups: new Map(), people: new Map([["@asker", "U_ASKER"]]) },
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const outcome = await poster.postAnswer({
      answer: tagged,
      askIdentity: CHANNEL_MENTION,
      documents: [],
      reply: CHANNEL_REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({ kind: "posted", missingMedia: [], ref: { channel: POSTED.channel, ts: POSTED.ts } });
  });

  it("sends the SAME untagged answer in a DM, where Slack already notifies the only other participant", async () => {
    // Proved on the bytes the channel case above refuses, so the difference is demonstrably the surface.
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

  it("sends the SAME untagged answer when profile.json says the asker IS the owner", async () => {
    // The owner arm is only reachable through a real `profile.json` read at gate-composition time, so this
    // writes one: without it every asker is someone other than the owner and the case above already refused.
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackBot: { ownerUserId: "U_ASKER" },
        sources: ["github"],
      }),
      "utf8",
    );
    const log: Recorded[] = [];

    const outcome = await sendingPoster({ log, mentions: NO_MENTIONS }).postAnswer({
      answer: minimalAnswer(),
      askIdentity: CHANNEL_MENTION,
      documents: [],
      reply: CHANNEL_REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({ kind: "posted", missingMedia: [], ref: { channel: POSTED.channel, ts: POSTED.ts } });
  });
});
