/**
 * The effectful half of the stranded lane — reading each stranded ask's own message back out of Slack so it
 * can be classified exactly like any other recovery candidate.
 *
 * `../../../live/listen/stranded.ts` decides WHICH asks a running visible session may pick up again and
 * why; this reads the one thing that decision cannot carry. A stranded ask's fold knows its identity, its
 * surface and its asker, and not one word of what was asked — 11 of this install's 31 stranded asks never
 * reached `turn brief` at all, so there is no local copy of the question to rebuild a mention from.
 *
 * ## Why it re-reads Slack rather than trusting anything local
 *
 * The brief would have covered 20 of the 31, and a two-source lane was written and rejected: the brief's
 * `question` is TAGS-STRIPPED, so a mention rebuilt from it would fail the `taggedIn` address test the
 * classifier runs, and the fix for that is a second address rule — the exact drift
 * `../../../live/listen/recover.ts` restates its own rules to prevent. One targeted thread read per
 * stranded ask puts every candidate through the SAME `classifyCandidate` a scanned one goes through, so
 * `wrong-place`, `deliberately-ignored`, `already-answered` and the address test all still decide it, and
 * this file holds no policy of its own.
 *
 * The read is bounded by construction: one thread per stranded ask, and an ask is stranded-and-unspent only
 * once ever, so a pass that finds nothing new makes no calls at all.
 *
 * ## A read that fails does NOT spend the ask
 *
 * Every refusal here leaves the fold untouched, so the next pass tries again. That is the opposite of the
 * spend rule for a survivor, and deliberately: the bound the owner asked for is one re-DISPATCH, and a
 * thread this pass could not read is not a re-dispatch that happened.
 */
import { existsSync } from "node:fs";

import { realWorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { isRecord } from "../../../lib/parsers.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import {
  candidateFromMessage,
  classifyCandidate,
  type RecoveryVerdict,
  threadEvidence,
} from "../../../live/listen/recover.js";
import type { ClassificationContext } from "../../../live/listen/recoverForegroundMessages.js";
import {
  type BuilderSighting,
  liveBuilderHolds,
  type StrandedAsk,
  strandedRedispatches,
  strandedSinceIso,
  strandNeedsBuilderSighting,
} from "../../../live/listen/stranded.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { dispatchRecordPath, readDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { reviewPostureOf } from "../../../live/turn/reviewPosture.js";

/** One stranded ask that survived classification, with the strand it is being picked up out of. */
interface StrandedSurvivor {
  readonly stranded: StrandedAsk;
  readonly verdict: RecoveryVerdict;
}

/** One stranded ask this pass did not pick up, and why — reported, never silently dropped. */
interface StrandedRefusal {
  readonly stranded: StrandedAsk;
  readonly reason: string;
}

/** What one pass over the stranded lane found. */
export interface StrandedScan {
  readonly survivors: readonly StrandedSurvivor[];
  readonly refused: readonly StrandedRefusal[];
  /**
   * Every ask this pass left alone because its review record is still open — reported, never silently
   * dropped, and never labelled a refusal: nothing about it was refused and nothing was spent.
   */
  readonly reviewOpen: readonly AskIdentity[];
  /**
   * Every ask this pass left alone because the worker that posted its plan is still building in its own
   * workspace — reported for the same reason as `reviewOpen`, and equally nothing was spent.
   */
  readonly builderRunning: readonly AskIdentity[];
}

/** What cmux shows of one stranded ask's recorded worker — injected so the scan stays testable. */
export type SightBuilder = (args: { readonly ask: AskIdentity }) => Promise<BuilderSighting>;

/**
 * The real {@link SightBuilder}: the ask's dispatch record names the worker workspace, and the same
 * liveness check the dispatch sweep's phantom reading uses says whether a session still holds it. A record
 * file that exists but will not parse reads `unknown`, never `unrecorded` — a schema bump must hold a live
 * builder, not release a second one beside it.
 *
 * @param home the resolved state home the dispatch records live under
 * @returns the sighting seam
 */
export function realBuilderSighting({ home }: { home: string }): SightBuilder {
  const checkLiveness = realWorkspaceLivenessCheck();
  return async ({ ask }) => {
    const record = readDispatchRecord({ askIdentity: ask, home });
    if (record === undefined) {
      return existsSync(dispatchRecordPath({ askIdentity: ask, home })) ? "unknown" : "unrecorded";
    }
    const liveness = await checkLiveness({ workspaceId: record.session.workspaceId });
    if (liveness.kind === "phantom") {
      return "gone";
    }
    return liveness.kind;
  };
}

/**
 * The raw message with exactly this `ts`, out of a thread's own messages.
 *
 * Exact-`ts` rather than "the root" or "the last one": two asks can share a thread, and picking either by
 * position is the same conflation `../../../live/listen/recover.ts` refuses to make anywhere else.
 *
 * @param messageTs the addressing message's own `ts`
 * @param rawMessages the thread's messages, as Slack returned them
 * @returns the message, or `undefined` when the thread no longer carries it
 */
function messageWithTs({
  messageTs,
  rawMessages,
}: {
  messageTs: string;
  rawMessages: readonly unknown[];
}): unknown | undefined {
  return rawMessages.find((message) => isRecord(message) && message["ts"] === messageTs);
}

/**
 * Classify ONE stranded ask by reading its own thread — a survivor, or the reason it is not one.
 *
 * @param api the Slack read seam
 * @param classification the same context every scanned candidate is classified against
 * @param since the stranded lane's own `too-old` cutoff
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @param stranded the ask being picked up
 * @returns the survivor, or the refusal
 */
async function classifyStranded({
  api,
  classification,
  since,
  selfBotId,
  stranded,
}: {
  api: Pick<SlackApi, "replies">;
  classification: ClassificationContext;
  since: string;
  selfBotId: string | undefined;
  stranded: StrandedAsk;
}): Promise<StrandedSurvivor | StrandedRefusal> {
  const thread = await fetchCompleteSlackThread({
    api,
    channel: stranded.ask.channel,
    includeAllMetadata: true,
    threadTs: stranded.ask.threadTs,
  });
  if (thread.isErr()) {
    return { reason: `could not read its thread — ${thread.error.message}`, stranded };
  }
  const message = messageWithTs({ messageTs: stranded.ask.messageTs, rawMessages: thread.value.rawMessages });
  if (message === undefined) {
    return { reason: "its own message is no longer in the thread", stranded };
  }
  const candidate = candidateFromMessage({
    channel: stranded.ask.channel,
    message,
    selfBotId,
    surface: stranded.surface,
    evidence: threadEvidence({ rawMessages: thread.value.rawMessages, selfBotId }),
  });
  if (candidate === undefined) {
    return { reason: "its message no longer carries the fields a candidate needs", stranded };
  }
  const verdict = classifyCandidate({
    allowedChannels: classification.allowedChannels,
    botUserId: classification.botUserId,
    candidate,
    cardEventType: classification.cardEventType,
    ignored: classification.ignored,
    ignoredConversations: classification.ignoredConversations,
    lifecycles: classification.lifecycles,
    since,
    // The one caller that may exempt an `already-worked` ask, because strandedness is what it just
    // established — see `../../../live/listen/recoverLifecycle.ts#strandedExemption`.
    strandedLane: true,
    terminalByAsk: classification.terminalByAsk,
  });
  return verdict.exclusions.length === 0 ? { stranded, verdict } : { reason: verdict.why.join("; "), stranded };
}

/**
 * Every stranded ask a running visible session should pick up this pass, classified.
 *
 * The review posture is read HERE, one record per folded ask, because the classifier is pure and an
 * omitted posture must never be able to read as "no review" — `../../../live/listen/stranded.ts`'s header
 * carries the turn that minted a second public card over a worker holding an open round. It is the same
 * reader `turn dispatch --sweep` goes through, which is the whole point: two verbs judging one ask from one
 * reader cannot disagree in the same minute the way those two did.
 *
 * A strand whose plan stands is then sighted in cmux before any thread read, and held while its builder's
 * workspace is alive (`../../../live/listen/stranded.ts#liveBuilderHolds`) — a re-dispatch beside a live builder is
 * a second build of the same stack. Only those strands are sighted, so every other pass makes no cmux call.
 *
 * @param api the Slack read seam
 * @param classification the same context every scanned candidate is classified against
 * @param home the resolved state home the review records live under
 * @param nowIso the current instant, injected so a test pins the strand ages and the cutoff
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @param sightBuilder what cmux shows of a strand's recorded worker workspace
 * @returns the survivors to capture, the refusals to report, and every ask held back by an open review or a
 *   builder still running
 */
export async function scanStrandedAsks({
  api,
  classification,
  home,
  nowIso,
  selfBotId,
  sightBuilder,
}: {
  api: Pick<SlackApi, "replies">;
  classification: ClassificationContext;
  home: string;
  nowIso: string;
  selfBotId: string | undefined;
  sightBuilder: SightBuilder;
}): Promise<StrandedScan> {
  const since = strandedSinceIso({ nowIso });
  const scan = strandedRedispatches({
    candidates: [...classification.lifecycles.values()].map((ask) => ({
      ask,
      reviewOpen: reviewPostureOf({
        askIdentity: { channel: ask.channel, messageTs: ask.messageTs, threadTs: ask.threadTs },
        home,
      }).recordOpen,
    })),
    nowIso,
  });
  if (since === undefined || scan.stranded.length === 0) {
    return { builderRunning: [], refused: [], reviewOpen: scan.reviewOpen, survivors: [] };
  }
  const survivors: StrandedSurvivor[] = [];
  const refused: StrandedRefusal[] = [];
  const builderRunning: AskIdentity[] = [];
  for (const one of scan.stranded) {
    if (strandNeedsBuilderSighting({ stranded: one })) {
      const sighting = await sightBuilder({ ask: one.ask });
      if (liveBuilderHolds({ sighting, stranded: one })) {
        builderRunning.push(one.ask);
        continue;
      }
    }
    const outcome = await classifyStranded({ api, classification, selfBotId, since, stranded: one });
    if ("verdict" in outcome) {
      survivors.push(outcome);
    } else {
      refused.push(outcome);
    }
  }
  return { builderRunning, refused, reviewOpen: scan.reviewOpen, survivors };
}
