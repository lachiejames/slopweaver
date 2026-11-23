/**
 * The Slack-READING half of dropped-tag recovery — the effectful shell around `./recover.ts`'s pure core.
 *
 * `recover.ts` decides whether one candidate is recoverable and never touches the network; everything here
 * is the other side of that line: which channels to scan, which threads inside them are worth a second
 * read, how a raw history row becomes a candidate, and how one unreadable channel is reported without
 * sinking the whole sweep. The split is `.claude/rules/area-live.md`'s own pure-core/effectful-shell rule,
 * and it is why the classifier's cases are plain calls with no Slack in sight.
 *
 * **Two reads, not one.** A channel's own history carries top-level messages only, so a tag posted as a
 * THREAD REPLY is invisible to it. `recoveryThreadHints` picks the roots worth opening from the history
 * rows themselves (`reply_count`, `latest_reply`), and `candidatesFromTargetThreads` reads each one with
 * `includeAllMetadata: true` — which is what puts a V2 answer's `askIdentity` and a bot card's own
 * `metadata.event_type` in front of the classifier at all.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type IgnoredAsk, isIgnoredAsk } from "../ask/ignore.js";
import { type IgnoredConversation, isIgnoredConversation } from "../ask/ignoredConversation.js";
import { type AskLifecycle, askLifecycleKey, type TerminalAskLifecycleEvent } from "../ask/lifecycle.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "../slack/pagination.js";
import {
  type CandidateSurface,
  candidateFromMessage,
  type RecoveryCandidate,
  type RecoveryReport,
  recoveryReport,
  threadEvidence,
  UNREAD_THREAD,
} from "./recover.js";
import { type ManualRecoveryReadError, ManualRecoveryReadErrors } from "./recoverScanErrors.js";
import { permanentExclusion, type RecoveryChannelExclusion, type RecoveryCoverageFailure } from "./recoverShared.js";
import { recoveryThreadHints } from "./recoverThreads.js";

/** Which surface a channel id names. `D…` is a DM; everything else is treated as a channel. */
function surfaceOf({ channel }: { channel: string }): CandidateSurface {
  return channel.startsWith("D") ? "dm" : "channel";
}

/**
 * One conversation a manual pass will READ, and where its identity came from.
 *
 * The two arms exist because breadth and reply eligibility are different questions and only one of them is
 * `--channels`. An `explicit` target is an id the operator typed, and all this scan knows about it is that
 * id — so its surface stays the `surfaceOf` prefix guess, exactly as it always was. A `discovered` target
 * came from the bot token's own `conversations.list` walk, which carries real `isIm`/`isMpim` metadata, so
 * its surface is DERIVED rather than guessed.
 *
 * Neither arm says anything about where the bot may REPLY: that is `allowedChannels`, and a discovered
 * conversation outside it is classified `wrong-place` by `recoveryReport` exactly as it should be.
 */
export type RecoveryScanTarget =
  | { readonly kind: "explicit"; readonly id: string }
  | { readonly kind: "discovered"; readonly channel: SlackChannelRef };

/** The conversation id one scan target names, whichever arm it is. */
function targetId({ target }: { target: RecoveryScanTarget }): string {
  return target.kind === "explicit" ? target.id : target.channel.id;
}

/** One target's surface — guessed from the id when the operator typed it, derived when Slack supplied it. */
function targetSurface({ target }: { target: RecoveryScanTarget }): Result<CandidateSurface> {
  if (target.kind === "explicit") {
    return ok(surfaceOf({ channel: target.id }));
  }
  return candidateSurfaceFromChannel({ channel: target.channel });
}

/**
 * The requested targets by id, first occurrence winning. A repeated id is one channel: reading it twice
 * would double its cost and inflate both coverage counts while proving nothing extra. `Map` preserves
 * first-seen order, so the diagnostics stay in the caller's own order.
 *
 * This is what makes `--discover-channels` safe as a WIDENING rather than a replacement: the verb hands
 * over discovery UNION the typed `--channels` ids, and an id on both is scanned once, as the DISCOVERED
 * target, whose Slack metadata resolves its surface where a bare id can only be assumed to be a channel.
 *
 * @returns the requested targets by id, in first-seen order
 */
export function distinctTargets({
  channels,
}: {
  channels: readonly RecoveryScanTarget[];
}): ReadonlyMap<string, RecoveryScanTarget> {
  const requested = new Map<string, RecoveryScanTarget>();
  for (const target of channels) {
    const id = targetId({ target });
    if (!requested.has(id)) {
      requested.set(id, target);
    }
  }
  return requested;
}

/**
 * Every unique thread target manual recovery must read in full: every shallow candidate's own thread (the
 * existing exact-answer check needs it) UNION every root — addressed or not — that advertises replies via
 * `reply_count`/`latest_reply`. The second half is the fix: `conversations.history` returns thread ROOTS
 * only, so without it an ordinary reply tagging the bot is structurally invisible to recovery, no matter how
 * carefully the root itself gets classified.
 *
 * An ignored root is exempt ONLY when it advertises no replies at all — ignoring it can never suppress a
 * DISTINCT ask a reply in that same thread might carry, so a root with replies still earns a read even when
 * the root itself is permanently ignored. A conversation-ignored root is exempt on the SAME basis, and for
 * the same reason: the whole channel being suppressed never suppresses a distinct ask a reply carries either.
 *
 * @param hintThreadTs every thread ts, in this channel, a history row advertised replies on
 * @param ignored the permanent ignore registry, already folded
 * @param ignoredConversations the permanent conversation-ignore registry, already folded
 * @param rootCandidates every shallow candidate this channel's history produced
 * @returns the thread timestamps worth a full read
 */
function threadTargets({
  hintThreadTs,
  ignored,
  ignoredConversations,
  rootCandidates,
}: {
  hintThreadTs: ReadonlySet<string>;
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  rootCandidates: readonly RecoveryCandidate[];
}): ReadonlySet<string> {
  const targets = new Set<string>(hintThreadTs);
  for (const candidate of rootCandidates) {
    const exempt =
      isIgnoredAsk({ askIdentity: candidate, ignored }) ||
      isIgnoredConversation({ channel: candidate.channel, ignored: ignoredConversations });
    if (hintThreadTs.has(candidate.threadTs) || !exempt) {
      targets.add(candidate.threadTs);
    }
  }
  return targets;
}

/**
 * Every candidate a full read of each target thread produces — root and replies alike, in target order.
 *
 * @param api the Slack read seam
 * @param channel the channel these threads belong to
 * @param surface this channel's own surface
 * @param targets every thread ts worth a full read
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns every candidate found across the target threads, or the FIRST thread read that failed
 */
async function candidatesFromTargetThreads({
  api,
  channel,
  surface,
  targets,
  selfBotId,
}: {
  api: SlackApi;
  channel: string;
  surface: CandidateSurface;
  targets: ReadonlySet<string>;
  selfBotId: string | undefined;
}): Promise<Result<readonly RecoveryCandidate[], ManualRecoveryReadError>> {
  const candidates: RecoveryCandidate[] = [];
  for (const threadTs of targets) {
    const thread = await fetchCompleteSlackThread({ api, channel, includeAllMetadata: true, threadTs });
    if (thread.isErr()) {
      return err(ManualRecoveryReadErrors.thread({ channel, error: thread.error, messageTs: threadTs }));
    }
    const evidence = threadEvidence({ rawMessages: thread.value.rawMessages, selfBotId });
    for (const message of thread.value.rawMessages) {
      const candidate = candidateFromMessage({ channel, evidence, message, selfBotId, surface });
      if (candidate !== undefined) {
        candidates.push(candidate);
      }
    }
  }
  return ok(candidates);
}

/**
 * Read one channel's recent messages into candidates, paginated to completion over the `--since` window.
 *
 * @param api the Slack read seam
 * @param channel the channel to scan
 * @param ignored the permanent ignore registry, already folded
 * @param ignoredConversations the permanent conversation-ignore registry, already folded
 * @param lifecycles the ask-lifecycle fold, keyed by {@link askLifecycleKey}
 * @param sinceIso the cutoff, ISO-8601
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @param surface this channel's own surface, resolved by the caller from whichever arm named it
 * @returns every candidate found in this channel, or the FIRST read that failed
 */
async function scanChannelForCandidates({
  api,
  channel,
  ignored,
  ignoredConversations,
  lifecycles,
  sinceIso,
  selfBotId,
  surface,
}: {
  api: SlackApi;
  channel: string;
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  sinceIso: string;
  selfBotId: string | undefined;
  surface: CandidateSurface;
}): Promise<Result<readonly RecoveryCandidate[], ManualRecoveryReadError>> {
  const history = await fetchCompleteSlackHistory({
    api,
    channel,
    latest: "9999999999",
    oldest: String(Math.floor(Date.parse(sinceIso) / 1000)),
  });
  if (history.isErr()) {
    return err(ManualRecoveryReadErrors.history({ channel, error: history.error }));
  }
  const rootCandidates: RecoveryCandidate[] = [];
  for (const message of history.value.rawMessages) {
    const shallow = candidateFromMessage({ channel, evidence: UNREAD_THREAD, message, selfBotId, surface });
    if (shallow !== undefined) {
      rootCandidates.push(shallow);
    }
  }
  const hints = recoveryThreadHints({ channel, rawMessages: history.value.rawMessages });
  const hintThreadTs = new Set(hints.map((hint) => hint.threadTs));
  const targets = threadTargets({ hintThreadTs, ignored, ignoredConversations, rootCandidates });

  // A root outside every target (an ignored root with no replies to discover) needs no read at all — the
  // classification it would reach is identical either way, so this is a cost saving, not a shortcut.
  const untargeted = rootCandidates.filter((candidate) => !targets.has(candidate.threadTs));
  const threadDerived = await candidatesFromTargetThreads({ api, channel, selfBotId, surface, targets });
  if (threadDerived.isErr()) {
    return err(threadDerived.error);
  }

  const candidates: RecoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [...untargeted, ...threadDerived.value]) {
    const key = `${candidate.channel}:${candidate.messageTs}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({ ...candidate, started: lifecycles.get(askLifecycleKey({ askIdentity: candidate }))?.started });
  }
  return ok(candidates);
}

/**
 * What a whole `recoverSlackAsks` pass produced — the classified report AND how much of what it was asked
 * to read it actually read.
 *
 * The two counts are the point. A report alone cannot distinguish "nothing was dropped" from "I could not
 * open the channels you named", and those are opposite answers: the first says stand down, the second says
 * the question is still open. MEASURED — a manual pass over over a hundred channels failed to open
 * most of them and its `--json` document was byte-identical in shape to a clean pass's over the few it read, both exiting 3.
 *
 * The invariant, and it is worth stating because it is what makes the counts readable:
 * `requestedChannels === scannedChannels + failures.length + excludedChannels.length`. It holds because a
 * channel's scan is ATOMIC — it stops at its first failed read and contributes no candidates — so exactly
 * one of the three buckets claims each requested channel.
 */
export interface RecoverSlackAsksResult {
  readonly report: RecoveryReport;
  /** How many DISTINCT channels the caller asked for — a repeated id is one channel, read once. */
  readonly requestedChannels: number;
  /** How many of them were read completely: the history window AND every thread it earned. */
  readonly scannedChannels: number;
  /** A channel that failed for a reason a RETRY may well fix — a rate limit, a network fault, a bad cursor. */
  readonly failures: readonly RecoveryCoverageFailure[];
  /**
   * A channel this token can never read as things stand — it is not a member, or the channel is gone.
   * Separated from {@link RecoverSlackAsksResult.failures} because the operator's next move is different:
   * an invite or a corrected `--channels`, never a re-run. It still counts against completeness HERE, and
   * that is the one place manual mode parts company with the scheduled sweep — see `recoverShared.ts`.
   */
  readonly excludedChannels: readonly RecoveryChannelExclusion[];
}

/**
 * Scan every named channel for dropped tags and classify them — the effectful half of recovery, behind the
 * typed `SlackApi` seam so it is testable with a plain fake rather than a live workspace. One unreadable
 * channel is reported rather than sinking the whole pass — a missing scope on a single channel is common,
 * and the other channels' findings are still true — but it is also COUNTED, so the caller can tell a
 * complete pass from a partial one instead of reading an identical report either way.
 *
 * @param api the Slack read seam
 * @param allowedChannels the WHERE gate — the only channels a survivor may be answered in
 * @param botUserId the bot's own Slack USER id
 * @param cardEventType the operator's `slackBot.cardChrome.metadataEventType` — see `answeredInThread`
 * @param channels the conversations to READ, which is a wider question than where a reply may go
 * @param ignored the permanent ignore registry, already folded
 * @param ignoredConversations the permanent conversation-ignore registry, already folded
 * @param lifecycles the ask-lifecycle fold, keyed by {@link askLifecycleKey}
 * @param terminalByAsk every ask that has ever reached a terminal lifecycle event, keyed by `askLifecycleKey`
 * @param sinceIso the cutoff, ISO-8601
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known —
 *   threaded into `candidateFromMessage` so a peer bot's tag is recoverable exactly like the live path
 * @returns the classified report plus how much of the requested breadth it actually covered
 */
export async function recoverSlackAsks({
  allowedChannels,
  api,
  botUserId,
  cardEventType,
  channels,
  ignored,
  ignoredConversations,
  lifecycles,
  terminalByAsk,
  sinceIso,
  selfBotId,
}: {
  allowedChannels: readonly string[];
  api: SlackApi;
  botUserId: string;
  cardEventType: string;
  channels: readonly RecoveryScanTarget[];
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent>;
  sinceIso: string;
  selfBotId: string | undefined;
}): Promise<RecoverSlackAsksResult> {
  const coverage = await scanEveryChannel({
    api,
    channels,
    ignored,
    ignoredConversations,
    lifecycles,
    selfBotId,
    sinceIso,
  });
  const report = recoveryReport({
    allowedChannels,
    botUserId,
    candidates: coverage.candidates,
    cardEventType,
    ignored,
    ignoredConversations,
    lifecycles,
    since: sinceIso,
    terminalByAsk,
  });
  return {
    excludedChannels: coverage.excludedChannels,
    failures: coverage.failures,
    report,
    requestedChannels: coverage.requestedChannels,
    scannedChannels: coverage.scannedChannels,
  };
}

/**
 * Read every requested channel once, sorting each into exactly one of the three coverage buckets.
 *
 * Separated from {@link recoverSlackAsks} because it is the whole of the coverage accounting: the
 * classification that decides a bucket lives here, and the classification that decides a VERDICT lives in
 * `recoveryReport`. A channel's scan is atomic — it stops at its first failed read — which is what makes the
 * `requested === scanned + failures + excluded` invariant hold.
 *
 * @param channels the requested targets, deduplicated here rather than by the caller
 * @returns the candidates gathered, the two failure buckets, and both counts
 */
async function scanEveryChannel({
  api,
  channels,
  ignored,
  ignoredConversations,
  lifecycles,
  selfBotId,
  sinceIso,
}: {
  api: SlackApi;
  channels: readonly RecoveryScanTarget[];
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  selfBotId: string | undefined;
  sinceIso: string;
}): Promise<{
  candidates: readonly RecoveryCandidate[];
  failures: readonly RecoveryCoverageFailure[];
  excludedChannels: readonly RecoveryChannelExclusion[];
  requestedChannels: number;
  scannedChannels: number;
}> {
  const candidates: RecoveryCandidate[] = [];
  const failures: RecoveryCoverageFailure[] = [];
  const excludedChannels: RecoveryChannelExclusion[] = [];
  const requested = distinctTargets({ channels });
  let scannedChannels = 0;
  for (const [channel, target] of requested) {
    const surface = targetSurface({ target });
    if (surface.isErr()) {
      // Contradictory discovery metadata is not a READ that failed — no history call was ever made — but it
      // still leaves this conversation unread, so it counts against completeness like any other lost channel.
      failures.push({ channel, reason: surface.error.join("; "), stage: "history" });
      continue;
    }
    const scanned = await scanChannelForCandidates({
      api,
      channel,
      ignored,
      ignoredConversations,
      lifecycles,
      selfBotId,
      sinceIso,
      surface: surface.value,
    });
    if (scanned.isOk()) {
      candidates.push(...scanned.value);
      scannedChannels += 1;
      continue;
    }
    const exclusion = permanentExclusion({ channel, error: scanned.error.error });
    if (exclusion !== undefined) {
      excludedChannels.push(exclusion);
      continue;
    }
    failures.push(coverageFailure({ error: scanned.error }));
  }
  return { candidates, excludedChannels, failures, requestedChannels: requested.size, scannedChannels };
}

/**
 * Project one manual read failure onto the coverage vocabulary both halves of recovery report in — the
 * SAME `RecoveryCoverageFailure` the scheduled sweep emits, so an operator reading either learns one shape.
 * Pure.
 *
 * @param error the manual read failure, already known not to be a permanent exclusion
 * @returns the coverage failure, on the stage the read was at
 */
function coverageFailure({ error }: { error: ManualRecoveryReadError }): RecoveryCoverageFailure {
  if (error.code === "THREAD_READ_FAILED") {
    return { channel: error.channel, messageTs: error.messageTs, reason: error.message, stage: "thread" };
  }
  return { channel: error.channel, reason: error.message, stage: "history" };
}

/**
 * Derive a candidate's surface from a discovered channel's own metadata — never an ID prefix. `D…`-looks-
 * like-a-DM is exactly the kind of guess `../listen/mention.ts`'s own `MentionSurface` doc forbids: a channel
 * ref's `isIm`/`isMpim` booleans come straight from `conversations.list`'s real payload, not a naming
 * convention this repo does not control.
 *
 * Wired into every path that HAS that metadata: the scheduled discovery walk (`./recoverSweep.ts`), and the
 * manual pass's `discovered` scan targets. A manual target the operator TYPED carries an id and nothing
 * else, so it stays on the `surfaceOf` id-prefix guess — which is the honest answer when nobody has told
 * you more, and the reason {@link RecoveryScanTarget} keeps the two arms apart instead of flattening them.
 *
 * @param channel the discovered channel a candidate came from
 * @returns the surface, or a refusal when the metadata contradicts itself (both `isIm` and `isMpim` true)
 */
export function candidateSurfaceFromChannel({
  channel,
}: {
  channel: { readonly id: string; readonly isIm?: boolean; readonly isMpim?: boolean };
}): Result<CandidateSurface> {
  if (channel.isIm === true && channel.isMpim === true) {
    return err([`channel ${channel.id} reports both isIm and isMpim — contradictory metadata, refusing to guess`]);
  }
  if (channel.isIm === true) {
    return ok("dm");
  }
  if (channel.isMpim === true) {
    return ok("group");
  }
  return ok("channel");
}
