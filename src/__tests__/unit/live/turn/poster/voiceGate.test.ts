import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { answerDigestOf, liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
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

describe("the voice gate, wired", () => {
  /**
   * The bot's own answer, judged against the operator's exact rules, and — the half that was missing — the
   * PAIN POINT it leaves behind. `PainPointLane` has carried an `as-bot` arm since this lane was
   * parameterised, and nothing on the answer path wrote one: the gate refused the send and forgot what it
   * had seen, so the composing brief only ever learned from prose the operator signed.
   *
   * The rule value is invented. The owner's own rules are private profile state and are never a constant here.
   */
  const BANNED = "leverage";

  /** What the fake transport sees when the door refuses: the answer post is absent, and this names it. */
  const LOG_ON_REFUSAL: readonly string[] = [];

  /** The same answer as `minimalAnswer()` with one banned word in the lead, and a verdict bound to it. */
  function offVoiceAnswer(): AnswerFormAnswer {
    return { ...minimalAnswer(), lead: `You have 3 open PRs to ${BANNED}.` };
  }

  function voicePoster({ log }: { log: Recorded[] }) {
    const transport: SlackWriteTransport = { ...fakeTransport({ log }), postAssistantMessage: async () => POSTED };
    return liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: { ...CLEAN_VERDICT, answerDigest: answerDigestOf({ answer: offVoiceAnswer() }) },
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
  }

  /** The rule only exists through a real profile read at gate-composition time, so this writes one. */
  function writeVoiceProfile(): void {
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackMe: { voice: { exact: [{ kind: "literal", value: BANNED }] } },
        sources: ["github"],
      }),
      "utf8",
    );
  }

  /** Every pain point the run left in the throwaway home, as `<lane>:<fieldPath>`. */
  function painPoints(): readonly string[] {
    const path = join(home, "ledgers", "pain-points.jsonl");
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const row = JSON.parse(line) as { lane: string; fieldPath: string };
        return `${row.lane}:${row.fieldPath}`;
      });
  }

  it("REFUSES the bot's own answer on a rule match, and touches the transport not at all", async () => {
    writeVoiceProfile();
    const log: Recorded[] = [];

    const refusal = await warnRefusal({
      offered: voicePoster({ log }).postAnswer({
        answer: offVoiceAnswer(),
        askIdentity: DM_MENTION,
        documents: [],
        reply: REPLY,
        uploads: [],
      }),
    });

    expect(refusal).toMatch(/lead/u);
    expect(log.map((entry) => entry.method)).toEqual(LOG_ON_REFUSAL);
  });

  it("records the finding on the as-bot lane — the arm nothing on this path used to write", async () => {
    writeVoiceProfile();
    const log: Recorded[] = [];

    await warnRefusal({
      offered: voicePoster({ log }).postAnswer({
        answer: offVoiceAnswer(),
        askIdentity: DM_MENTION,
        documents: [],
        reply: REPLY,
        uploads: [],
      }),
    });

    expect(painPoints()).toEqual(["as-bot:lead"]);
  });

  it("sends the SAME answer with the word removed, and writes no pain point at all", async () => {
    writeVoiceProfile();
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
    expect(existsSync(join(home, "ledgers", "pain-points.jsonl"))).toBe(false);
  });
});
