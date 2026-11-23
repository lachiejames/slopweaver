/**
 * REPLAY LANE — the correction that replaced its own earlier answer in the acme-bugs thread.
 *
 * The fixture (`fixtures/replay/correction-supersedes-answer-22sep`) is the PREDECESSOR's record set, frozen
 * through its `answered` event: the turn that posted `1790054484.916599` into thread `1790048427.171609`,
 * with the completion row that is this installation's own proof of having posted it. What happened next is
 * the incident — a later turn in that thread replaced the affected-version claim and retracted nothing, so
 * two bot answers stood contradicting each other until the chair ran `slopweaver slack delete` by hand.
 *
 * **Captured predecessor history, constructed correction continuation, and the seam between them is stated
 * rather than blurred.** The correction turn left no `turn-completed` row of its own — the chair typed the
 * delete, so no worker ever ran the lane under test — which means there is nothing about it that could
 * honestly be frozen. Everything ON DISK here is real and measured; the correction turn driven over it is
 * built in this file, and the only thing that makes the replay worth more than a unit test is that the
 * WARRANT it deletes against is checked against the frozen completion log rather than against a fixture the
 * test also wrote.
 *
 * The transport is a plain recording object, as `answerUnderItsOwnFailureCards.test.ts`'s poster is: no
 * Slack token exists in this lane. What it drives is the shipped `liveSupersession` — the real
 * `deleteOwnedMessage` ownership guard, the real completion reader, the real journal under the frozen home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import type { DeleteMessageOutcome, PostedMessage } from "../../../corpus/slack/writeTransport.js";
import { ok, unwrap } from "../../../lib/result.js";
import type { Mention } from "../../../live/listen/mention.js";
import { readTurnCompletionText } from "../../../live/turn/completionStore.js";
import type { TurnCompletion } from "../../../live/turn/envelope.js";
import { answerDigestOf } from "../../../live/turn/poster.js";
import { type PostedRef, runTurn, type TurnPoster } from "../../../live/turn/run.js";
import { answeredPredecessors } from "../../../live/turn/supersession/completionReader.js";
import type {
  SupersessionEvent,
  SupersessionIntent,
  SupersessionResult,
} from "../../../live/turn/supersession/journal.js";
import { readSupersessionLog } from "../../../live/turn/supersession/store.js";
import { liveSupersession } from "../../../live/turn/supersession/wiring.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../outbound/assistant/answerMessage.js";
import type { OwnedDeleteTransport } from "../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../outbound/slack/lifecycleGuards.js";
import { memoryDoorLedger } from "../../doorLedgerFixture.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "correction-supersedes-answer-22sep";

/** The answer the chair deleted by hand, and the thread it stood in — both measured in the live thread. */
const SUPERSEDED_TS = "1790054484.916599";
const THREAD_TS = "1790048427.171609";

/** Where the constructed correction turn puts its own messages — after the frozen answer, as a reply does. */
const WORKING_TS = "1790056000.000100";
const CORRECTION_TS = "1790056012.000200";

/** This installation, as Slack reports it back to the ownership guard. */
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** The superseded answer as Slack still holds it: this bot's own V2 answer, in the thread, never edited. */
const STANDING_ANSWER: ReadSlackMessage = {
  botId: SELF.botId,
  fileIds: [],
  metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
  renderer: "slack-assistant-answer-v2",
  threadTs: THREAD_TS,
  ts: SUPERSEDED_TS,
  userId: SELF.userId,
};

/** The correction itself — it declares what it replaces, and its prose never mentions a deletion. */
const CORRECTION: AnswerFormAnswer = {
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
    reason: "the replay only needs a correction to post",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "It is 4.2.1 that is affected, not 4.2.0.",
  measurements: [],
  supersedes: SUPERSEDED_TS,
};

/**
 * The reviewer's own warrant, the second declaration a delete needs.
 *
 * Its digest is COMPUTED off {@link CORRECTION} rather than written as a constant, because that binding is
 * the property: the delete boundary refuses a verdict issued against any other bytes, so a literal here
 * would be a digest of nothing and the whole replay would refuse on `STALE_WARRANT`.
 */
const WARRANTED: ReviewVerdict = {
  answerDigest: answerDigestOf({ answer: CORRECTION }),
  authorSession: "worker",
  claims: [],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
  supersession: {
    reason: "the affected-version claim is replaced, not added to",
    targetTs: SUPERSEDED_TS,
    warranted: true,
  },
};

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-supersede-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/** Every message the bot has standing in the thread, and every delete the transport was asked for. */
interface Thread {
  readonly deleted: string[];
  readonly standing: Set<string>;
}

/** The Slack side: a transport over the thread, so a delete that lands is visible as a message going away. */
function threadTransport({ thread }: { thread: Thread }): OwnedDeleteTransport {
  return {
    deleteMessageOnce: async ({ posted }: { posted: PostedMessage }): Promise<DeleteMessageOutcome> => {
      thread.deleted.push(posted.ts);
      thread.standing.delete(posted.ts);
      return { kind: "gone" };
    },
    readMessage: async ({ posted }: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined> => {
      if (posted.ts !== STANDING_ANSWER.ts || !thread.standing.has(posted.ts)) {
        return undefined;
      }
      return STANDING_ANSWER;
    },
    whoAmI: async (): Promise<SlackSelfIdentity> => SELF,
  };
}

/** The poster the correction turn drives — it adds its own two messages to the same thread. */
function threadPoster({ channel, thread }: { channel: string; thread: Thread }): TurnPoster {
  const remove = async ({ posted }: { posted: PostedRef }): Promise<boolean> => {
    thread.standing.delete(posted.ts);
    return true;
  };
  return {
    advanceWorking: async () => {},
    beginStatus: async () => ok(undefined),
    deleteWorking: remove,
    displayNames: () => ({}),
    endStatus: async () => ok(undefined),
    finalizeWorking: async () => true,
    ownerMention: undefined,
    postAnswer: async () => {
      thread.standing.add(CORRECTION_TS);
      return { kind: "posted", missingMedia: [], ref: { channel, ts: CORRECTION_TS } };
    },
    postNotice: async () => {
      throw new Error("an answered turn posts no notice");
    },
    postWorking: async () => {
      thread.standing.add(WORKING_TS);
      return { channel, ts: WORKING_TS };
    },
    reapEarlierCard: remove,
    setTitle: async () => ok(undefined),
    settleReaction: async () => ok(undefined),
    stopStatusReasserting: () => {},
  };
}

/**
 * Drive the real correction turn over the frozen home, with the given verdict.
 *
 * @param verdict the reviewer's verdict — an absent `supersession` is what an unreviewed correction has
 * @returns the thread after the turn, and the completion the turn recorded
 */
async function runCorrection({ verdict }: { verdict: ReviewVerdict }): Promise<{
  readonly completion: TurnCompletion;
  readonly thread: Thread;
}> {
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  const thread: Thread = { deleted: [], standing: new Set([SUPERSEDED_TS]) };
  const transport = threadTransport({ thread });
  const mention: Mention = {
    channel: manifest.ask.channel,
    messageTs: "1790055900.000100",
    surface: "channel",
    text: "actually it's 4.2.1 that's affected isn't it?",
    threadTs: THREAD_TS,
    userId: manifest.ask.askedBy,
  };
  const completion = unwrap(
    await runTurn({
      complete: async () => {},
      documents: [],
      earlierCards: [],
      hold: async () => ({ id: "q-unused" }),
      mention,
      poster: threadPoster({ channel: manifest.ask.channel, thread }),
      provenance: { modelId: "claude-opus-5" },
      query: async () => ({ answer: CORRECTION, completionDetail: "answered" }),
      supersession: liveSupersession({
        doorLedger: memoryDoorLedger().port,
        home,
        nowIso: () => manifest.replayNowIso,
        transport,
        verdict,
      }),
      turnId: "turn-replay-correction",
      uploads: [],
    }),
  );
  return { completion, thread };
}

/** The intent row, narrowed here so no assertion below carries a branch. */
function intentOf({ rows }: { rows: readonly SupersessionEvent[] }): SupersessionIntent {
  const found = rows.find((row) => row.kind === "supersession-intended");
  if (found === undefined) {
    throw new Error("the journal holds no intent row");
  }
  return found;
}

/** The result row, narrowed for the same reason. */
function resultOf({ rows }: { rows: readonly SupersessionEvent[] }): SupersessionResult {
  const found = rows.find((row) => row.kind === "supersession-settled");
  if (found === undefined) {
    throw new Error("the journal holds no result row");
  }
  return found;
}

describe(`replay: ${SLUG}`, () => {
  it("the frozen completion log is this installation's own proof it posted the superseded answer", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });

    expect(answeredPredecessors({ text: readTurnCompletionText({ home }) })).toEqual([
      {
        answerTs: SUPERSEDED_TS,
        askIdentity: { channel: manifest.ask.channel, messageTs: manifest.ask.messageTs, threadTs: THREAD_TS },
        recordedIso: "2026-09-22T05:21:33.518Z",
        turnId: "turn-1790049846181",
      },
    ]);
  });

  it("the correction posts, and only then does the answer it supersedes come down", async () => {
    const { completion, thread } = await runCorrection({ verdict: WARRANTED });

    // The witness that the input carried what the final assertion calls absent.
    expect(thread.deleted).toEqual([SUPERSEDED_TS]);
    expect(completion.primary).toEqual({ answerTs: CORRECTION_TS, kind: "answered" });
    expect(completion.secondaryFailures).toEqual([]);
    expect([...thread.standing]).toEqual([CORRECTION_TS]);
  });

  it("journals an intent then a result, naming the FROZEN turn whose answer came down", async () => {
    await runCorrection({ verdict: WARRANTED });

    const rows = readSupersessionLog({ home }).events;
    expect(rows.map((row) => row.kind)).toEqual(["supersession-intended", "supersession-settled"]);
    expect(intentOf({ rows })).toEqual({
      answerTs: CORRECTION_TS,
      channel: "CFIXTUREAA",
      kind: "supersession-intended",
      reason: "the affected-version claim is replaced, not added to",
      schemaVersion: 1,
      supersededTurnId: "turn-1790049846181",
      targetTs: SUPERSEDED_TS,
      threadTs: THREAD_TS,
      tsIso: "2026-09-22T05:21:33.519Z",
      turnId: "turn-replay-correction",
    });
    expect(resultOf({ rows }).outcome).toBe("deleted");
  });

  it("an unreviewed correction posts and deletes NOTHING, and says so in the completion", async () => {
    const { supersession, ...unreviewed } = WARRANTED;
    const { completion, thread } = await runCorrection({ verdict: unreviewed });

    expect(supersession!.warranted).toBe(true);
    expect(thread.deleted).toEqual([]);
    expect([...thread.standing].toSorted()).toEqual([SUPERSEDED_TS, CORRECTION_TS].toSorted());
    expect(completion.secondaryFailures).toEqual([
      {
        kind: "supersession",
        reason:
          `the answer this turn superseded in CFIXTUREAA (ts ${SUPERSEDED_TS}) is still standing — ` +
          `UNREVIEWED: no review verdict judges the supersession of ${SUPERSEDED_TS} — an answer may ` +
          "DECLARE what it replaces, but a delete needs a reviewer who looked at both messages and said so",
      },
    ]);
  });
});
