/*
 * The ONE fact that only `answerMention` can witness: the review verdict it already holds reaches the
 * supersession seam it builds, and not merely the answer poster beside it.
 *
 * `wiring.test.ts` drives `liveSupersession` directly and the replay lane drives `runTurn` directly, so
 * both construct the seam themselves — neither can see `poster.ts` handing it the wrong verdict. Measured:
 * replacing `liveSupersession({ home, transport, verdict })` with
 * `liveSupersession({ home, transport, verdict: undefined })` at that one call site survived all 131 tests
 * across this feature's unit paths and the replay lane, leaving a correction that posts its replacement and
 * silently refuses on UNREVIEWED with the superseded answer still standing in the thread.
 *
 * So this drives the REAL `answerMention` over a plain recording transport and a real `mkdtempSync` home,
 * and asserts the predecessor is actually removed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ANSWER_QUALITY_OVERRIDE } from "../../../../../admit/answerQualityGate.js";
import type { ReviewVerdict } from "../../../../../admit/reviewVerdict.js";
import { whitelistJudgement } from "../../../../../admit/withhold.js";
import type {
  DeleteMessageOutcome,
  PostedMessage,
  SlackWriteTransport,
  UploadReadiness,
} from "../../../../../corpus/slack/writeTransport.js";
import { ok } from "../../../../../lib/result.js";
import type { Mention } from "../../../../../live/listen/mention.js";
import { appendTurnCompletionEvent } from "../../../../../live/turn/completionStore.js";
import { answerDigestOf, answerMention } from "../../../../../live/turn/poster.js";
import type { TurnProvenance, TurnQuery } from "../../../../../live/turn/run.js";
import type { SupersessionResult } from "../../../../../live/turn/supersession/journal.js";
import { readSupersessionLog } from "../../../../../live/turn/supersession/store.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import type { SlackCardChrome, TurnChrome } from "../../../../../outbound/slack/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { workspaceShapeRefusals } from "../../../../slackWorkspaceShapeFake.js";

const CHANNEL = "D_OWNER";
const THREAD = "1790048427.171609";
/** The answer an earlier turn of this same install posted into this thread — the one being superseded. */
const TARGET = "1790054484.916599";
const WORKING = { channel: CHANNEL, ts: "1790056000.000100" };
const REPLACEMENT = { channel: CHANNEL, ts: "1790056001.000200" };
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

const CARD_CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_assistant_answer_v2",
};
const TURN_CHROME: TurnChrome = { ...CARD_CHROME, metadataEventType: "slopweaver_turn_v1" };
const PROVENANCE: TurnProvenance = { modelId: "claude-opus-5" };
const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };

const MENTION: Mention = {
  channel: CHANNEL,
  messageTs: "1790055900.000100",
  surface: "dm",
  text: "that affected-version number is wrong",
  threadTs: THREAD,
  userId: "U_OWNER",
};

/** The correction this turn composes: a real answer form that DECLARES what it replaces. */
const CORRECTION: AnswerFormAnswer = {
  body: [
    {
      runs: [{ text: "The affected-version claim was wrong; here is the checked one.", type: "text" }],
      type: "paragraph",
    },
  ],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "the affected versions" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude-opus-5", skillsLoaded: ["loop-bot"], verbsLoaded: [] },
    result: "scripted",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Correcting the affected-version claim from earlier in this thread.",
  measurements: [],
  supersedes: TARGET,
};

/** The loop's verdict: it read the correction AND warranted the delete it declares. */
const WARRANTED: ReviewVerdict = {
  answerDigest: answerDigestOf({ answer: CORRECTION }),
  authorSession: "worker",
  claims: [{ evidence: "the thread itself", impact: "high", support: "supported", text: "the corrected version" }],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
  supersession: { reason: "the affected-version claim is replaced", targetTs: TARGET, warranted: true },
  voice: { pathsChecked: ["lead", "body"], rulesChecked: 0, violations: [] },
};

/** The target as Slack reports it: this install's own V2 answer, in this thread, never edited. */
const OURS: ReadSlackMessage = {
  botId: SELF.botId,
  fileIds: [],
  metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
  renderer: "slack-assistant-answer-v2",
  threadTs: THREAD,
  ts: TARGET,
  userId: SELF.userId,
};

/** The door's own override channel, named once so the cleanup below cannot drift from what a case sets. */
const DOOR_OVERRIDE_VAR = "SLOPWEAVER_DOOR_OVERRIDE";

const homes: string[] = [];
afterEach(() => {
  delete process.env[DOOR_OVERRIDE_VAR];
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home whose completion log already records this install posting the target, in this thread. */
function homeRecordingTheTarget(): string {
  const home = mkdtempSync(join(tmpdir(), "slop-poster-wiring-"));
  homes.push(home);
  appendTurnCompletionEvent({
    event: {
      completion: {
        askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", threadTs: THREAD },
        primary: { answerTs: TARGET, kind: "answered" },
        provenance: PROVENANCE,
        secondaryFailures: [],
        turnId: "turn-1790049846181",
        workingTs: "1790054400.000100",
      },
      kind: "turn-completed",
      tsIso: "2026-09-22T05:21:30.000Z",
    },
    home,
  });
  return home;
}

/** What this turn sent and what it removed, in the order it did each. */
interface TurnLog {
  /** Every answer posted — the falsifiable half of "posted but deleted nothing". */
  readonly answers: PostedMessage[];
  readonly once: PostedMessage[];
  readonly best: PostedMessage[];
}

/**
 * The whole turn's transport, over a turn log. Every method the turn does not use throws, so a path that
 * reaches for a different verb fails loudly rather than passing by coincidence.
 */
function fakeTransport({ log }: { log: TurnLog }): SlackWriteTransport {
  const unused =
    ({ method }: { method: string }) =>
    async (): Promise<never> => {
      throw new Error(`${method} is not part of a correction turn`);
    };
  return {
    ...workspaceShapeRefusals({ path: "a correction turn" }),
    addReaction: async () => true,
    appendStream: unused({ method: "appendStream" }),
    attachAssistantMedia: unused({ method: "attachAssistantMedia" }),
    attachMedia: unused({ method: "attachMedia" }),
    attachRecipeResponseMedia: unused({ method: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "direct-message" as const }),
    deleteMessage: async ({ posted }) => {
      log.best.push(posted);
      return true;
    },
    deleteMessageOnce: async ({ posted }): Promise<DeleteMessageOutcome> => {
      log.once.push(posted);
      return { kind: "gone" };
    },
    postAssistantMessage: async () => {
      log.answers.push(REPLACEMENT);
      return REPLACEMENT;
    },
    postCard: unused({ method: "postCard" }),
    postDripMessage: unused({ method: "postDripMessage" }),
    postNoFold: unused({ method: "postNoFold" }),
    postPoll: unused({ method: "postPoll" }),
    postRecipeResponse: unused({ method: "postRecipeResponse" }),
    postTurn: async () => WORKING,
    readBackFileCount: unused({ method: "readBackFileCount" }),
    readMessage: async ({ posted }) => (posted.ts === OURS.ts ? OURS : undefined),
    readReactions: async () => [],
    removeReaction: async () => true,
    setAssistantStatus: async () => ok(undefined),
    setThreadTitle: async () => ok(undefined),
    startStream: unused({ method: "startStream" }),
    stopStream: unused({ method: "stopStream" }),
    updateCard: unused({ method: "updateCard" }),
    correctMessage: unused({ method: "correctMessage" }),
    updateDripMessage: unused({ method: "updateDripMessage" }),
    updateTurn: async () => undefined,
    uploadPrivately: unused({ method: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => SELF,
  };
}

/** The already-composed correction, handed straight back — the shape `postAnswer` builds in production. */
const query: TurnQuery = async ({ onPhase }) => {
  await onPhase({ detail: "composing the correction" });
  return { answer: CORRECTION, completionDetail: "scripted for the supersession proof" };
};

/** One whole correction turn through the REAL `answerMention`, against a home recording the target. */
async function correctionTurn({
  log,
  verdict = WARRANTED,
}: {
  log: TurnLog;
  verdict?: ReviewVerdict;
}): Promise<{ readonly home: string }> {
  const home = homeRecordingTheTarget();
  await answerMention({
    chrome: CARD_CHROME,
    documents: [],
    doorLedger: memoryDoorLedger().port,
    home,
    identityRoster: { records: [], retiredFile: undefined, revision: null },
    judge: whitelistJudgement({ openOverride: false, whitelist: { identities: [MENTION.userId], kind: "list" } }),
    mention: MENTION,
    mentions: { groups: new Map(), people: new Map() },
    provenance: PROVENANCE,
    query,
    readiness: READY,
    tier: "inline",
    transport: fakeTransport({ log }),
    turnChrome: TURN_CHROME,
    turnId: () => "turn-1790055912004",
    uploads: [],
    verdict,
  });
  return { home };
}

/**
 * The journal's single settled row, narrowed so a case can assert its code rather than grep its JSON.
 *
 * The `kind` assertion is part of the narrowing on purpose: a refused supersession writes NO intent row —
 * `run.ts` journals the intent only once eligibility has passed — so a case that reached the delete and came
 * back refused would show two rows here and fail before the code is ever read.
 */
function settledRow({ home }: { home: string }): SupersessionResult {
  const events = readSupersessionLog({ home }).events;
  expect(events.map((event) => event.kind)).toEqual(["supersession-settled"]);
  return events.flatMap((event) => (event.kind === "supersession-settled" ? [event] : []))[0]!;
}

describe("answerMention hands the verdict it holds to the supersession it builds", () => {
  it("deletes the superseded answer through the turn's own wiring, never only the answer poster's", async () => {
    const log: TurnLog = { answers: [], best: [], once: [] };
    const { home } = await correctionTurn({ log });

    expect(log.answers).toEqual([REPLACEMENT]);
    // `deleteMessageOnce` is the supersession's own verb — the checklist cleanup uses `deleteMessage`, so
    // this cannot pass on the turn tidying up after itself.
    expect(log.once).toEqual([{ channel: CHANNEL, ts: TARGET }]);
    const events = readSupersessionLog({ home }).events;
    expect(events.map((event) => event.kind)).toEqual(["supersession-intended", "supersession-settled"]);
    expect(JSON.stringify(events[1])).toContain("deleted");
  });
});

/*
 * Waiving the SEND is not waiving the DELETE.
 *
 * `answer.quality:v1` waives the outbound door's own findings about a verdict — including the two below,
 * which it raises as `warn`s, because "I have looked at it, send it" must stay representable. MEASURED:
 * with that token set, a verdict
 * bound to sixty-four zeroes and a verdict whose reviewer was its own author EACH still called
 * `deleteMessageOnce` on `1790054484.916599` and journalled `outcome: "deleted"`. An override on a
 * recoverable act had silently released an irreversible one, which is why `./eligibility.ts` re-checks both
 * properties at the deletion boundary rather than inheriting the send gate's answer.
 *
 * Both cases assert what the turn DID as well as what it did not: the correction posts either way, so a
 * `log.once` that is empty because the whole turn fell over would fail on `log.answers` first.
 */
describe("answerMention under the answer-quality override — posts, and still refuses the delete", () => {
  it("refuses on STALE_WARRANT when the warrant is bound to an answer that never went out", async () => {
    process.env[DOOR_OVERRIDE_VAR] = ANSWER_QUALITY_OVERRIDE;
    const abandoned = `sha256:${"0".repeat(64)}`;
    const log: TurnLog = { answers: [], best: [], once: [] };
    const { home } = await correctionTurn({ log, verdict: { ...WARRANTED, answerDigest: abandoned } });

    expect(log.answers).toEqual([REPLACEMENT]);
    expect(log.once).toEqual([]);
    const settled = settledRow({ home });
    expect(settled.outcome).toBe("refused");
    expect(settled.code).toBe("STALE_WARRANT");
    expect(settled.detail).toContain(abandoned);
  });

  it("refuses on SELF_REVIEWED when the session that composed the correction also warranted the delete", async () => {
    process.env[DOOR_OVERRIDE_VAR] = ANSWER_QUALITY_OVERRIDE;
    const log: TurnLog = { answers: [], best: [], once: [] };
    const itself: ReviewVerdict = { ...WARRANTED, reviewerSession: WARRANTED.authorSession };
    const { home } = await correctionTurn({ log, verdict: itself });

    expect(log.answers).toEqual([REPLACEMENT]);
    expect(log.once).toEqual([]);
    const settled = settledRow({ home });
    expect(settled.outcome).toBe("refused");
    expect(settled.code).toBe("SELF_REVIEWED");
    expect(settled.detail).toContain("worker");
  });
});
