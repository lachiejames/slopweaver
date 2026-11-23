/**
 * REPLAY LANE — the wrong affected-version claim, corrected IN PLACE rather than deleted or answered with
 * a bare reply.
 *
 * The fixture is `correctionSupersedesAnswer.test.ts`'s: the predecessor's record set frozen through its `answered`
 * event, whose completion row is this installation's own proof of having posted `1790054484.916599` into thread
 * `1790048427.171609`. Its answer's words are redacted in the fixture, so the answer standing in the transport is
 * rendered here by the shipped `renderAssistantAnswer` from a constructed form carrying the incident's claim — the
 * seam stated rather than blurred, as that file states its own.
 *
 * What runs over it is the shipped `slack correct` (`runCorrect`): the real ownership guard, the real door writing
 * its ledger row into the frozen home, and the real read-back. The transport is a recording object with no token,
 * and its delete and post methods throw — a correction that reached either would fail here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCorrectArgs } from "../../../cli/commands/slack/correctArgs.js";
import type { CorrectDeps } from "../../../cli/commands/slack/correctGate.js";
import { runCorrect } from "../../../cli/commands/slack/correctRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { ok, unwrap } from "../../../lib/result.js";
import { readTurnCompletionText } from "../../../live/turn/completionStore.js";
import { answeredPredecessors } from "../../../live/turn/supersession/completionReader.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2, renderAssistantAnswer } from "../../../outbound/assistant/answerMessage.js";
import type { CorrectedMessage } from "../../../outbound/slack/claimCorrection.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../outbound/slack/lifecycleGuards.js";
import { memoryDoorLedger } from "../../doorLedgerFixture.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "correction-supersedes-answer-22sep";
const CHANNEL = "CFIXTUREAA";
const ANSWER_TS = "1790054484.916599";
const THREAD_TS = "1790048427.171609";
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

const CHROME = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

/** The answer that stood, carrying the incident's claim in its lead. */
const WRONG_ANSWER: AnswerFormAnswer = {
  body: [],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "the replay only needs an answer standing",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Only 4.2.0 is affected.",
  measurements: [],
};

/** The answer as Slack stores it once posted: the rendered wrapper, as the read-back returns it. */
function standingAnswer(): ReadSlackMessage {
  const payload = renderAssistantAnswer({
    answer: WRONG_ANSWER,
    askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", quality: "exact", threadTs: THREAD_TS },
    chrome: CHROME,
    mentions: { groups: new Map(), people: new Map() },
  });
  return {
    botId: SELF.botId,
    fileIds: [],
    metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
    renderer: "slack-assistant-answer-v2",
    stored: { attachments: payload.attachments, metadata: payload.metadata, text: payload.text },
    threadTs: THREAD_TS,
    ts: ANSWER_TS,
    userId: SELF.userId,
  };
}

/** Slack, as far as this replay needs it: one standing message that a correction rewrites in place. */
function recordingTransport(): SlackWriteTransport & { readonly writes: CorrectedMessage[] } {
  let current = standingAnswer();
  const writes: CorrectedMessage[] = [];
  const real = {
    correctMessage: async ({ corrected }: { corrected: CorrectedMessage }) => {
      writes.push(corrected);
      current = {
        ...current,
        blocks: corrected.blocks,
        editedTs: "1790060000.000100",
        stored: { attachments: corrected.attachments, metadata: corrected.metadata, text: corrected.text },
      };
    },
    readMessage: async ({ posted }: { posted: PostedMessage }) => (posted.ts === ANSWER_TS ? current : undefined),
    whoAmI: async () => SELF,
    writes,
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`a correction reached transport method \`${String(property)}\`: never a delete or a reply`);
          },
  }) as unknown as SlackWriteTransport & { writes: CorrectedMessage[] };
}

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-correct-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

describe("replay: the affected-version claim, corrected in place", () => {
  it("is this installation's own answer, by the frozen completion row", () => {
    materialiseFixture({ into: home, slug: SLUG });
    expect(answeredPredecessors({ text: readTurnCompletionText({ home }) }).map((row) => row.answerTs)).toEqual([
      ANSWER_TS,
    ]);
  });

  it("strikes the claim where readers saw it, adds the bold Correction line, and deletes nothing", async () => {
    materialiseFixture({ into: home, slug: SLUG });
    const transport = recordingTransport();
    const lines: string[] = [];
    const door = memoryDoorLedger();
    const deps = new Proxy<Partial<CorrectDeps>>(
      {
        botToken: () => "xoxb-replay",
        cardChrome: () => CHROME,
        doorEnv: () => ({}),
        doorLedger: door.port,
        makeTransport: () => transport,
        nowIso: () => "2026-09-22T06:00:00.000Z",
        out: (line) => {
          lines.push(line);
        },
        readDraftLog: () => [],
        voiceRules: () => ok([]),
      },
      {
        get: (target, property) =>
          property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error(`the correction touched dependency \`${String(property)}\``);
              },
      },
    ) as unknown as CorrectDeps;
    const options = unwrap(
      parseCorrectArgs({
        defaultHome: home,
        rest: [
          "--channel",
          CHANNEL,
          "--ts",
          ANSWER_TS,
          "--wrong",
          "4.2.0 is affected",
          "--correction",
          "It is 4.2.1 that is affected, not 4.2.0.",
        ],
      }),
    );

    expect(await runCorrect({ deps, options })).toBe(EXIT_OK);
    expect(transport.writes.length).toBe(1);
    const corrected = transport.writes[0]!;
    expect(corrected.text).toBe("Correction: It is 4.2.1 that is affected, not 4.2.0.");
    expect(corrected.metadata).toEqual(standingAnswer().stored!.metadata);
    expect(lines).toEqual([
      `corrected — channel=${CHANNEL} ts=${ANSWER_TS} struck in ${corrected.struckIn}, read back`,
    ]);
    expect(door.text()).toContain('"action":"verb:slack.correct"');
  });
});
