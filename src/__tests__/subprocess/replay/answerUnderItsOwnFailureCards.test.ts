/**
 * REPLAY LANE — the answer that posted under its own ask's failure cards.
 *
 * The fixture (`fixtures/replay/answer-under-its-own-failure-cards-7sep`) is that ask's record set frozen through
 * its `failed` event: a turn the admit door refused (`ANSWER_VERDICT_STALE`) had posted its working checklist
 * (`1788771372.738209`) and a failure card (`1788771383.199079`), and its completion names both. What happened
 * next is the incident — a later turn on the same ask posted the real answer and retracted neither, so the bot's
 * failure stood directly above the bot's answer for 22 hours until both were deleted by hand.
 *
 * The owner's test is a reader's: looking at the thread, is anything from
 * the bot irrelevant. So this drives the shipped reader over the frozen home and the real `runTurn` over a
 * thread seeded with exactly what that reader saw, and asserts what is left standing — one bot message, the
 * answer. The poster is a plain recording object over that thread, not a mock: no Slack token exists in this
 * lane, and the door-routed delete underneath `reapEarlierCard` is `posterWorking.ts`'s, unit-tested apart.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "../../../lib/result.js";
import type { Mention } from "../../../live/listen/mention.js";
import { earlierCardsForAsk } from "../../../live/turn/earlierCards.js";
import { type PostedRef, runTurn, type TurnPoster } from "../../../live/turn/run.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "answer-under-its-own-failure-cards-7sep";

/** The two cards the refused turn left, as measured in the live thread. */
const MEASURED_CHECKLIST_TS = "1788771372.738209";
const MEASURED_FAILURE_CARD_TS = "1788771383.199079";

/** Where the fake thread puts this turn's own messages — after every frozen card, as the real one did. */
const WORKING_TS = "1788772916.819869";
const ANSWER_TS = "1788772938.886249";

/** A minimal conversation-grounded answer; its content is not what this replay is about. */
const ANSWER: AnswerFormAnswer = {
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
    reason: "the replay only needs an answer to post",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Performance, not the cause.",
  measurements: [],
};

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-reap-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * A thread holding the bot's messages by ts, and a poster that writes into it — posting adds, deleting removes.
 *
 * @param seeded the bot messages already standing when the turn starts
 * @returns the poster and a read of what the bot has standing
 */
function threadPoster({ seeded }: { seeded: readonly PostedRef[] }): {
  readonly poster: TurnPoster;
  readonly standing: () => readonly string[];
} {
  const bot = new Set(seeded.map((card) => card.ts));
  // Slack answers an already-deleted message as gone, which `deleteMessageCall` reports as success.
  const remove = async ({ posted }: { posted: PostedRef }): Promise<boolean> => {
    bot.delete(posted.ts);
    return true;
  };
  const poster: TurnPoster = {
    advanceWorking: async () => {},
    beginStatus: async () => ok(undefined),
    deleteWorking: remove,
    displayNames: () => ({}),
    endStatus: async () => ok(undefined),
    finalizeWorking: async () => true,
    ownerMention: undefined,
    postAnswer: async () => {
      bot.add(ANSWER_TS);
      return { kind: "posted", missingMedia: [], ref: { channel: seeded[0]!.channel, ts: ANSWER_TS } };
    },
    postNotice: async () => {
      throw new Error("an answered turn posts no notice");
    },
    postWorking: async () => {
      bot.add(WORKING_TS);
      return { channel: seeded[0]!.channel, ts: WORKING_TS };
    },
    reapEarlierCard: remove,
    setTitle: async () => ok(undefined),
    settleReaction: async () => ok(undefined),
    stopStatusReasserting: () => {},
  };
  return { poster, standing: () => [...bot].toSorted() };
}

describe(`replay: ${SLUG}`, () => {
  it("the frozen record set names exactly the two cards the refused turn left", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });

    expect(earlierCardsForAsk({ askIdentity: manifest.ask, home })).toEqual([
      { channel: manifest.ask.channel, ts: MEASURED_CHECKLIST_TS },
      { channel: manifest.ask.channel, ts: MEASURED_FAILURE_CARD_TS },
    ]);
  });

  it("once the answer posts, the answer is the only bot message left in the thread", async () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const earlierCards = earlierCardsForAsk({ askIdentity: manifest.ask, home });
    const thread = threadPoster({ seeded: earlierCards });
    const mention: Mention = {
      channel: manifest.ask.channel,
      messageTs: manifest.ask.messageTs,
      surface: "channel",
      text: "is FST_UNDER_PRESSURE the cause or a symptom?",
      threadTs: manifest.ask.threadTs,
      userId: manifest.ask.askedBy,
    };
    // The witness that the input carries what the final assertion calls absent.
    expect(thread.standing()).toEqual([MEASURED_CHECKLIST_TS, MEASURED_FAILURE_CARD_TS]);

    const completion = unwrap(
      await runTurn({
        supersession: async () => ({ outcome: "not-declared" }),
        complete: async () => {},
        documents: [],
        earlierCards,
        hold: async () => ({ id: "q-unused" }),
        mention,
        poster: thread.poster,
        provenance: { modelId: "claude-opus-5" },
        query: async () => ({ answer: ANSWER, completionDetail: "answered" }),
        turnId: "turn-replay",
        uploads: [],
      }),
    );

    expect(completion.primary).toEqual({ answerTs: ANSWER_TS, kind: "answered" });
    expect(completion.secondaryFailures).toEqual([]);
    expect(thread.standing()).toEqual([ANSWER_TS]);
  });
});
