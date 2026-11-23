/**
 * INTEGRATION test: the `inline` tier's COMPLETE turn, through the REAL production wiring (`answerMention` →
 * `runTurn`), against the REAL Slack Web API, recorded + replayed via a Polly cassette — scenario 1
 * ("inline, through the real host loop") and the mechanical half of the checklist lifecycle proof.
 *
 * Recording this POSTS FOR REAL, into the bot's own DM with the owner — never a live team channel — for the
 * same reason every other file in this directory does.
 *
 * ## What this proves, and what it deliberately does not
 *
 * **Two cases, differing in ONE field.** The first sends; the second supplies a verdict that names a voice
 * violation and asserts the door refuses it WITHOUT ending the turn — no answer, the working checklist still
 * standing, and an `AnswerSendRefusal` rather than a completion. That pair is the end-to-end witness for the
 * incident where a warn-tier refusal finalised the turn
 * `failed`, superseded the dispatch and posted a public failure card for an answer nothing had lost.
 *
 * This drives `answerMention` with the EXACT same wiring `cli/commands/turn/run.ts`'s `postAnswer` uses in
 * production (real `SlackWriteTransport`, real `posterForMention`, real `runTurn`) — never a hand-rolled
 * substitute. It proves: the metadata-bearing working checklist posts and advances through Slack; the real
 * answer REPLACES it (the working message is confirmed gone afterward, never left stuck above the reply); the
 * posted answer's own metadata, read back independently through the SAME `fetchCompleteSlackThread` +
 * `parseAssistantAnswerMetadata` path `recoverSlackAsks`'s already-answered check depends on, names the
 * EXACT ask identity that was dispatched; and `lifecycleEventForCompletion` projects that same completion
 * into an `answered` ask-lifecycle event, which folds to state `answered`.
 *
 * What it does NOT prove: that the OWNER visibly watched the checklist text advance in a real Slack client —
 * that half of scenario 7 is a live-witness claim for the acceptance document, not something a cassette
 * replay can establish on its own.
 *
 * ## Ordered matching, deliberately
 *
 * This test's own read-after-write assertions (checklist gone, answer's metadata present) depend on the
 * SEQUENCE of calls against endpoints several steps of this flow share — the shared lenient cassette config
 * (`order: false`) would let an earlier `conversations.replies`/`chat.postMessage` recording answer a LATER
 * call, which is the exact "green test proving a third of what it claims" trap `slackPoll.test.ts` already
 * named. `requireOrderedMatching` opts this file into `order: true`, same as that file does.
 *
 * Run:
 *   yarn test:integration                                                   # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                   # (re)record — POSTS FOR REAL
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { whitelistJudgement } from "../../admit/withhold.js";
import { liveReadiness } from "../../cli/commands/slack/uploadReadiness.js";
import { makeSlackApi } from "../../corpus/slack/api.js";
import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../corpus/slack/writeGuardPlacement.js";
import { runAssistantCompositeSend } from "../../corpus/slack/writeSend.js";
import type { PostedMessage, SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import { isRecord } from "../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle, readAskLifecycleText } from "../../live/ask/store.js";
import type { Mention } from "../../live/listen/mention.js";
import { parseAssistantAnswerMetadata } from "../../live/slack/messageMetadata.js";
import { fetchCompleteSlackThread } from "../../live/slack/pagination.js";
import { lifecycleEventForCompletion } from "../../live/turn/completionLifecycle.js";
import { answerDigestOf, answerMention } from "../../live/turn/poster.js";
import type { TurnQuery } from "../../live/turn/run.js";
import type { UpdateArtifact } from "../../outbound/artifact/types.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import { renderAssistantMessage } from "../../outbound/assistant/answerMessage.js";
import type { SlackCardChrome, TurnChrome } from "../../outbound/slack/types.js";
import { memoryDoorLedger } from "../doorLedgerFixture.js";
import { admitAll } from "../imageAdmitFake.js";
import { REPEAT_GUARD_OUT_OF_SCOPE } from "../repeatGuardOutOfScope.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Neutral chrome — never a real operator's bot name; this repo is public. */
const CARD_CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_assistant_answer_v2",
};

const TURN_CHROME: TurnChrome = {
  authorEmoji: CARD_CHROME.authorEmoji,
  authorLabel: CARD_CHROME.authorLabel,
  bannerColor: CARD_CHROME.bannerColor,
  detailLabel: CARD_CHROME.detailLabel,
  metadataEventType: "slopweaver_turn_v1",
};

/** A `verb`-grounded answer — no corpus interplay needed for this proof. */
const ANSWER: AnswerFormAnswer = {
  body: [
    {
      runs: [{ text: "This is a scripted integration answer, not a real judgement.", type: "text" }],
      type: "paragraph",
    },
  ],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "every open pull request" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "integration-test", skillsLoaded: [], verbsLoaded: [] },
    result: "scripted",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Scenario 1 integration proof — inline tier, real Slack.",
  measurements: [],
};

/** The turn query the CLI's own `postAnswer` builds — an already-composed answer, handed straight back. */
function fixedTurnQuery({ answer }: { answer: AnswerFormAnswer }): TurnQuery {
  return async ({ onPhase }) => {
    await onPhase({ detail: "composing the scripted answer" });
    return { answer, completionDetail: "scripted for the integration proof" };
  };
}

function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the turn-inline-completion cassette");
  }
  return token;
}

/** The bot's own DM with the owner. Never a live team channel. */
function targetChannel(): string {
  if (!RECORD) {
    return "D0SYN00REPLAY";
  }
  const channel = process.env["SLOPWEAVER_RECORD_SLACK_DM"];
  if (channel === undefined || channel.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_DM to the bot DM to record into");
  }
  return channel;
}

/** A plain top-level "ask" message, through the UNCHANGED assistant-write path, so the turn has a real thread. */
async function postAsk({ transport }: { transport: SlackWriteTransport }): Promise<PostedMessage> {
  const artifact: UpdateArtifact = {
    citations: [],
    detail: [
      { runs: [{ text: "scripted ask for the inline-completion integration proof", type: "text" }], type: "paragraph" },
    ],
    index: [],
    kind: "update",
    media: [],
    tldr: "inline-completion integration ask",
  };
  const result = await runAssistantCompositeSend({
    admit: admitAll().admit,
    channel: targetChannel(),
    documents: [],
    payload: renderAssistantMessage({
      artifact,
      chrome: CARD_CHROME,
      mentions: { groups: new Map(), people: new Map() },
    }),
    readiness: { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) },
    transport,
    uploads: [],
  });
  return { channel: result.channel, ts: result.ts };
}

/** Whether a posted message's identity is still readable. `thread_not_found` means it was deleted. */
async function readAfterDelete({
  posted,
  transport,
}: {
  posted: PostedMessage;
  transport: SlackWriteTransport;
}): Promise<"gone" | "present"> {
  try {
    return (await transport.readMessage({ posted })) === undefined ? "gone" : "present";
  } catch (error) {
    return error instanceof Error && error.message.includes("thread_not_found") ? "gone" : "present";
  }
}

/** Force ORDERED matching for this file — see the module header's "Ordered matching, deliberately". */
function requireOrderedMatching(): void {
  const polly = activePolly();
  if (polly === undefined) {
    return;
  }
  polly.server.any().on("request", (req) => {
    req.configure({ matchRequestsBy: { order: true } });
  });
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

describe("turn inline completion (integration — real Slack via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("answers a real inline ask end to end: checklist opens, the answer replaces it, and exact identity survives to the lifecycle", async () => {
    const token = botToken();
    const inlineHome = mkdtempSync(join(tmpdir(), "slopweaver-turn-inline-integration-"));
    fixtureDirs.push(inlineHome);
    const transport = makeSlackWriteTransport({
      home: inlineHome,
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token,
    });
    const ask = await postAsk({ transport });

    const mention: Mention = {
      channel: ask.channel,
      messageTs: ask.ts,
      surface: "dm",
      text: "what are my open PRs?",
      threadTs: ask.ts,
      userId: "U_OWNER",
    };

    const delivered = await answerMention({
      chrome: CARD_CHROME,
      documents: [],
      doorLedger: memoryDoorLedger().port,
      home: inlineHome,
      identityRoster: { records: [], retiredFile: undefined, revision: null },
      judge: whitelistJudgement({ openOverride: false, whitelist: { identities: [mention.userId], kind: "list" } }),
      mention,
      mentions: { groups: new Map(), people: new Map() },
      provenance: { modelId: "integration-test" },
      query: fixedTurnQuery({ answer: ANSWER }),
      readiness: liveReadiness({ token }),
      tier: "inline",
      transport,
      turnChrome: TURN_CHROME,
      turnId: () => "turn-inline-integration-1",
      uploads: [],
      // A real turn now needs a real verdict: the reviewer gate refuses a send nothing but the author has
      // read. This test failing without one was the wiring proving itself end to end — through the real
      // door, on the real turn path — so it supplies what the loop supplies in production.
      verdict: {
        answerDigest: answerDigestOf({ answer: ANSWER }),
        authorSession: "integration-worker",
        claims: [
          { evidence: "the cassette's own thread", impact: "high", support: "supported", text: "the answer's claim" },
        ],
        outcome: "clean",
        reviewerSession: "integration-reviewer",
        schemaVersion: 1,
        // Same reason as the verdict itself: `answerQualityFindings` raises `ANSWER_VOICE_UNCHECKED` on a
        // verdict that is SILENT about voice, because "checked every rule" and "checked none" otherwise read
        // identically in the record. The two paths named are the two this answer actually renders — its lead
        // and its body — which `answerProse` derives; `index` and the grounding evidence are empty here.
        voice: { pathsChecked: ["lead", "body"], rulesChecked: 0, violations: [] },
      },
    });

    // `unwrap` because a warn-tier door refusal is now an `Err` rather than a completion, and this turn has to
    // reach the thread: an `Err` here throws with the door's own words instead of failing a later field read.
    const completion = unwrap(delivered);

    // Exact identity survives the whole turn: the durable completion names precisely the ask that was answered.
    expect(completion.askIdentity).toEqual({
      channel: mention.channel,
      messageTs: mention.messageTs,
      threadTs: mention.threadTs,
    });
    expect(completion.primary.kind).toBe("answered");
    if (completion.primary.kind !== "answered") {
      throw new Error("unreachable — asserted above");
    }
    const answerTs = completion.primary.answerTs;

    // The working checklist is confirmed GONE — the real answer replaced it, never left stuck above the reply.
    expect(await readAfterDelete({ posted: { channel: ask.channel, ts: completion.workingTs }, transport })).toBe(
      "gone",
    );

    // Read the posted answer BACK, independently, through the same production path `recoverSlackAsks`'s
    // already-answered check depends on — never trusting the completion's own report of what it sent.
    const read = makeSlackApi({ token });
    const thread = await fetchCompleteSlackThread({
      api: read,
      channel: ask.channel,
      includeAllMetadata: true,
      threadTs: ask.ts,
    });
    expect(thread.isOk()).toBe(true);
    if (thread.isErr()) {
      throw new Error("unreachable — asserted above");
    }
    const answered = thread.value.rawMessages
      .map((message) => parseAssistantAnswerMetadata({ value: isRecord(message) ? message["metadata"] : undefined }))
      .find(
        (parsed) =>
          parsed.kind === "v2" &&
          parsed.metadata.askIdentity.quality === "exact" &&
          parsed.metadata.askIdentity.messageTs === mention.messageTs,
      );
    expect(answered).toBeDefined();
    if (answered?.kind !== "v2") {
      throw new Error("unreachable — asserted above");
    }
    expect(answered.metadata.askIdentity).toEqual({
      channel: mention.channel,
      messageTs: mention.messageTs,
      quality: "exact",
      threadTs: mention.threadTs,
    });

    // The SAME completion, projected through this handover's pure lifecycle projection, folds to `answered`.
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-inline-lifecycle-"));
    fixtureDirs.push(home);
    ensureCapturedAskLifecycle({ askIdentity: mention, home, surface: "dm", userId: mention.userId });
    appendAskLifecycleEvent({
      event: lifecycleEventForCompletion({ completion, tsIso: "2026-08-13T00:00:00.000Z" }),
      home,
    });
    const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
    const entry = folded.get(JSON.stringify([mention.channel, mention.messageTs]));
    expect(entry?.state).toBe("answered");
    expect(entry?.lastEvent.kind === "answered" ? entry.lastEvent.answerTs : undefined).toBe(answerTs);
  });

  it("refuses a warn-tier send without ending the turn: no answer, the checklist still standing, no completion", async () => {
    const token = botToken();
    const refusedHome = mkdtempSync(join(tmpdir(), "slopweaver-turn-warn-refusal-integration-"));
    fixtureDirs.push(refusedHome);
    const transport = makeSlackWriteTransport({
      home: refusedHome,
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token,
    });
    const ask = await postAsk({ transport });

    const mention: Mention = {
      channel: ask.channel,
      messageTs: ask.ts,
      surface: "dm",
      text: "what are my open PRs?",
      threadTs: ask.ts,
      userId: "U_OWNER",
    };

    const delivered = await answerMention({
      chrome: CARD_CHROME,
      documents: [],
      doorLedger: memoryDoorLedger().port,
      home: refusedHome,
      identityRoster: { records: [], retiredFile: undefined, revision: null },
      judge: whitelistJudgement({ openOverride: false, whitelist: { identities: [mention.userId], kind: "list" } }),
      mention,
      mentions: { groups: new Map(), people: new Map() },
      provenance: { modelId: "integration-test" },
      query: fixedTurnQuery({ answer: ANSWER }),
      readiness: liveReadiness({ token }),
      tier: "inline",
      transport,
      turnChrome: TURN_CHROME,
      turnId: () => "turn-warn-refusal-integration-1",
      uploads: [],
      // The ONE field that differs from the case above: the reviewer returned `clean` and still named a voice
      // rule the lead breaks. That is `ANSWER_VOICE_BROKEN`, warn-tier, with an override token — the exact
      // shape that cost a turn its dispatch.
      verdict: {
        answerDigest: answerDigestOf({ answer: ANSWER }),
        authorSession: "integration-worker",
        claims: [
          { evidence: "the cassette's own thread", impact: "high", support: "supported", text: "the answer's claim" },
        ],
        outcome: "clean",
        reviewerSession: "integration-reviewer",
        schemaVersion: 1,
        voice: {
          pathsChecked: ["lead", "body"],
          rulesChecked: 26,
          violations: [{ path: "lead", rule: "adjective register" }],
        },
      },
    });

    const refusal = unwrapErr(delivered);
    expect(refusal.code).toBe("ANSWER_SEND_WARN_REFUSED");
    expect(refusal.message).toContain("ANSWER_VOICE_BROKEN");
    expect(refusal.message).toContain("lead breaks adjective register");

    // The working checklist is still STANDING — the opposite of the case above, and the witness that nothing
    // settled this turn. A `failed` ending would have replaced it with a card tagging the owner.
    const thread = await fetchCompleteSlackThread({
      api: makeSlackApi({ token }),
      channel: ask.channel,
      includeAllMetadata: true,
      threadTs: ask.ts,
    });
    const messages = unwrap(thread).rawMessages;
    // The falsifiable half: the turn.s OWN working message IS there, so the read reached the right thread and
    // a `not` below is evidence rather than an empty list.
    const eventTypes = messages.map((message) =>
      isRecord(message) && isRecord(message["metadata"]) ? message["metadata"]["event_type"] : undefined,
    );
    expect(eventTypes).toContain(TURN_CHROME.metadataEventType);

    // And no ANSWER sits beside it — read back through the SAME production path the case above uses to prove
    // one IS there, so the two cases differ in their verdict and in nothing else.
    const answered = messages
      .map((message) => parseAssistantAnswerMetadata({ value: isRecord(message) ? message["metadata"] : undefined }))
      .find(
        (parsed) =>
          parsed.kind === "v2" &&
          parsed.metadata.askIdentity.quality === "exact" &&
          parsed.metadata.askIdentity.messageTs === mention.messageTs,
      );
    expect(answered).toBeUndefined();
  });
});
