/**
 * `slopweaver listen recover --scheduled` — the scheduled sibling of the manual recover verb, on the durable
 * five-minute cadence `recoverSchedule.ts` computes.
 *
 * Discovery is scoped to the BOT's own `conversations.list` membership (every DM and group DM it is a
 * participant in, every private channel — a class Slack lists only to a token that is IN it — plus every
 * public channel it has actually joined; see `recoverSweep.ts#actionableChannels`), never an
 * all-workspace crawl. That is not a narrower approximation of "every dropped tag": a channel the bot was
 * never invited to is not a channel anyone expects it to answer in, and a DM is a conversation the bot is
 * inherently part of regardless of who started it — a user-token-backed "all-visible" crawl actually could
 * NOT see those DMs at all (a user token only sees conversations that specific human is a member of), so
 * bot-token-scoped discovery is the more correct design as well as the fast one. Measured against the real
 * workspace this bot runs in: 542 discovered conversations, only 81 actionable — the other 461 were public
 * channels merely listable via `channels:read`, never joined, never readable, and a large part of why the
 * first (all-visible) design measured a 34-plus-minute sweep against this same workspace.
 *
 * A survivor from a COMPLETE scan gets the exact same treatment a live socket tag does — responder
 * admission, then the shared `capturedMentionHandler` chain (ignore-check, burst-queue check, captured
 * lifecycle, reaction, checklist/status, checklist-posted lifecycle) — via the shared `liveCapture.ts`
 * builder, so this path never drifts from the socket listener's own UX. What this module owns beyond that:
 * complete (within the actionable set) channel discovery, the durable watermark, and racing the next due
 * sweep against a recipe's own next-firing deadline the same way `listen --emit --json --deadline-ms`
 * already does. That is the ONE-SHOT listener, not `--follow`: a deadline race exists to hand control back
 * so the caller can recompute the next deadline, and a stream that never ends has nothing to hand back —
 * which is why `core.ts`'s `validateDeadlineMode` refuses `--follow` outright. `listenDeadlineOffenders`
 * (`src/canon/listenDeadline.ts`) is what keeps this sentence and that validator from drifting apart again.
 *
 * A PARTIAL scan captures nothing at all, even from channels that individually completed: a candidate this
 * pass could not confirm complete for the whole workspace is one a retried sweep may reach again before the
 * watermark ever advances past it, and posting a second checklist for the same ask is not idempotent the way
 * the reaction is.
 *
 * ## The one-time V1 → V2 migration
 *
 * A missing or V1 state means recovery has no thread-checkpoint inventory yet, so the first sweep after this
 * feature ships (or a fresh install's first-ever sweep) BOOTSTRAPS from the normal three-day `--since`
 * window rather than continuing from a V1 watermark's own narrow five-minute-cadence cursor — the one-time
 * pass that discovers existing recent roots and replies. It also optionally seeds additional checkpoint KEYS
 * (never cursor VALUES — see `recoverThreads.ts`'s own header) from corpus ingestion's already-known thread
 * set. A COMPLETE migration sweep writes V2; a PARTIAL one writes V1/missing back unchanged so the next
 * scheduled invocation retries the identical bootstrap rather than falsely declaring the inventory
 * established.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { capturedMentionHandler } from "../../../live/listen/capture.js";
import type { RecoverySweepStateError } from "../../../live/listen/errors.js";
import { type EmittedMention, emittedMention } from "../../../live/listen/handoff.js";
import type { RecoveryVerdict } from "../../../live/listen/recover.js";
import { nextRecoveryDue, type RecoverySweepState, recoveryWindow } from "../../../live/listen/recoverSchedule.js";
import { readRecoverySweepState } from "../../../live/listen/recoverScheduleStore.js";
import { admitResponder, type ResponderWhitelist } from "../../../live/listen/whitelist.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { ownerUserIdFromProfile } from "../slack/wiring.js";
import { liveCaptureDeps } from "./liveCapture.js";
import { responderRefusalHandler } from "./responderRefusal.js";
import { classifyWorkspace } from "./scheduledClassify.js";
import { finishSweep, log, type ScheduledRecoverOutput } from "./scheduledFinish.js";
import { isMigrating, startingCheckpoints } from "./scheduledRecoverState.js";
import type { ScheduledIncidentDetect } from "./scheduledScan.js";
import { waitUntilDueOrDeadline } from "./scheduledWait.js";
import { pickUpStrandedAsks } from "./strandedPickup.js";
import { realBuilderSighting, scanStrandedAsks } from "./strandedSurvivors.js";

/**
 * Feed every recoverable verdict through responder admission, then — for an admitted identity — the shared
 * capture-time UX, collecting the resulting handoff shape. A refused identity takes the same fixed
 * refusal/door path the socket listener uses; neither path is attempted for a verdict with no `mention`
 * (there is none once `exclusions` is non-empty, which `recoveryReport` already guarantees).
 *
 * @param doorLedger where a refused identity's door decisions are recorded
 * @param home the state home every capture effect reads/writes under
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist reads the responder whitelist, once per address, as the socket listener does — a
 *   snapshot taken before the due wait would still admit a responder removed during it
 * @param supervisor the visible supervisor session, when the caller has one to attribute the turn to
 * @param transport the Slack write transport every capture effect and refusal reply posts with
 * @param verdicts the classifier's recoverable verdicts to feed through
 * @returns every survivor that was admitted and captured, in the handoff shape
 */
async function captureSurvivors({
  doorLedger,
  home,
  responderHatchOpen,
  responderWhitelist,
  supervisor,
  transport,
  verdicts,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
  verdicts: readonly RecoveryVerdict[];
}): Promise<readonly EmittedMention[]> {
  const { checklist, reaction } = liveCaptureDeps({ doorLedger, home, log, supervisor, transport });
  const refuseResponder = responderRefusalHandler({
    deps: {
      doorLedger,
      home,
      log,
      ownerUserId: () => ownerUserIdFromProfile({ home }),
      postReply: (args) => transport.postDripMessage(args),
      responderWhitelist,
      sendGates: DEFAULT_GATES,
    },
  });
  const recovered: EmittedMention[] = [];
  const handler = capturedMentionHandler({
    checklist,
    lifecycle: { home, log },
    reaction,
    sink: async (mention) => {
      recovered.push(emittedMention({ mention }));
    },
  });
  for (const verdict of verdicts) {
    const mention = verdict.mention;
    if (mention === undefined) {
      continue;
    }
    const decision = admitResponder({
      openOverride: responderHatchOpen(),
      userId: mention.userId,
      whitelist: responderWhitelist(),
    });
    if (!decision.admitted) {
      await refuseResponder({ mention, why: decision.why });
      continue;
    }
    await handler(mention);
  }
  return recovered;
}

/**
 * Discover every visible conversation, scan the window, classify, capture survivors, persist, print.
 *
 * @param api the Slack read seam
 * @param botUserId the bot's own Slack USER id
 * @param channels the channels the bot may answer in — reply eligibility, never scan breadth
 * @param doorLedger where every door decision this sweep makes is recorded before it is performed
 * @param home the Slopweaver home
 * @param incidents the live-incident seam, handed every discovered channel
 * @param now the clock, epoch milliseconds
 * @param previous the durable sweep state before this cycle, or `undefined`
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist reads the responder whitelist, once per address, as the socket listener does — a
 *   snapshot taken before the due wait would still admit a responder removed during it
 * @param sinceIso the bootstrap `--since` cutoff
 * @param supervisor the visible supervisor session, when the caller has one to attribute a captured turn to
 * @param transport the Slack write transport every capture effect and refusal reply posts with
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the process exit code
 */
// max-lines-exempt: one cohesive sweep shell over 13 named-object-params fields, one line per field
async function sweepNow({
  api,
  botUserId,
  channels,
  doorLedger,
  home,
  incidents,
  now,
  previous,
  responderHatchOpen,
  responderWhitelist,
  sinceIso,
  supervisor,
  transport,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies" | "listChannels">;
  botUserId: string;
  channels: readonly string[];
  doorLedger: DoorLedgerPort;
  home: string;
  incidents: ScheduledIncidentDetect;
  now: number;
  previous: RecoverySweepState | undefined;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  sinceIso: string;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
  selfBotId: string | undefined;
}): Promise<number> {
  const migrating = isMigrating({ state: previous });
  const window = recoveryWindow({
    bootstrapSinceIso: sinceIso,
    completedThroughTs: migrating ? undefined : previous?.completedThroughTs,
    nowMs: now,
  });
  if (window.isErr()) {
    logger.error({ msg: window.error.message });
    return EXIT_ERROR;
  }
  const threadCheckpoints = startingCheckpoints({ home, migrating, previous, window: window.value });
  const { classification, report, scan } = await classifyWorkspace({
    api,
    botUserId,
    channels,
    home,
    incidents,
    nowMs: now,
    selfBotId,
    threadCheckpoints,
    window: window.value,
  });
  // The stranded lane reads its OWN threads by exact identity, so it neither depends on the workspace scan's
  // completeness nor is invalidated by it — an ask this install already knows about does not stop being
  // stranded because a channel it is not in refused a page. See `./strandedSurvivors.ts`.
  const nowIso = new Date(now).toISOString();
  const strandedVerdicts = await pickUpStrandedAsks({
    doorLedger,
    home,
    log,
    nowIso,
    postReply: (args) => transport.postDripMessage(args),
    scan: await scanStrandedAsks({
      api,
      classification,
      home,
      nowIso,
      selfBotId,
      sightBuilder: realBuilderSighting({ home }),
    }),
    sendGates: DEFAULT_GATES,
  });
  // A partial scan captures nothing FROM THE SCAN — see this module's own header for why even a channel that
  // individually completed must not be captured when the WHOLE workspace scan did not.
  const recovered = await captureSurvivors({
    doorLedger,
    home,
    responderHatchOpen,
    responderWhitelist,
    supervisor,
    transport,
    verdicts: scan.complete ? [...report.recoverable, ...strandedVerdicts] : strandedVerdicts,
  });
  // Incident detection already ran inside the scan, on the whole discovery: it writes a board row, never a reply,
  // so none of the partial-capture reasoning above applies to it.
  return finishSweep({
    home,
    incidents: scan.incidents,
    migrating,
    nowMs: now,
    previous,
    recovered,
    report,
    scan,
    strandedCaptured: strandedVerdicts.length,
    window: window.value,
  });
}

/**
 * The two refusals that must happen BEFORE any wait or Slack read: an unreadable cadence-state file, or
 * `--since` typed explicitly against a watermark that already exists.
 *
 * @param sinceExplicit whether `--since` was explicitly typed
 * @param stored the cadence state read result
 * @returns the refusal message, or `undefined` when neither applies
 */
function refuseBeforeSweeping({
  sinceExplicit,
  stored,
}: {
  sinceExplicit: boolean;
  stored: Result<RecoverySweepState | undefined, RecoverySweepStateError>;
}): string | undefined {
  if (stored.isErr()) {
    return stored.error.message;
  }
  if (sinceExplicit && stored.value?.completedThroughTs !== undefined) {
    return "--since is bootstrap-only — a durable watermark already exists; omit --since to continue from it";
  }
  return undefined;
}

/**
 * Run one scheduled recovery cycle: wait for the next due sweep (or a racing deadline), then sweep and print
 * exactly one {@link ScheduledRecoverOutput}.
 *
 * @param api the Slack read seam, ALREADY resolved to the bot token — never a fresh client, and never
 *   built here, so a caller decides token resolution before this function is reached
 * @param botUserId the bot's own Slack USER id
 * @param channels the channels the bot may answer in — reply eligibility, never scan breadth
 * @param deadlineMs a recipe deadline to race, epoch milliseconds, or `undefined`
 * @param doorLedger where every door decision the sweep makes is recorded before it is performed
 * @param home the Slopweaver home
 * @param incidents the live-incident seam each sweep hands its discovered channels to
 * @param nowMs the clock — injected so the whole cycle is unit-testable without a real wall-clock wait
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist reads the responder whitelist, once per address, as the socket listener does — a
 *   snapshot taken before the due wait would still admit a responder removed during it
 * @param sinceExplicit whether `--since` was explicitly typed (bootstrap-only; refused once a watermark exists)
 * @param sinceIso the resolved `--since` bootstrap cutoff
 * @param supervisor the visible supervisor session, when the caller has one to attribute a captured turn to
 * @param transport the Slack write transport every capture effect and refusal reply posts with
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known —
 *   threaded all the way to `candidateFromMessage` so a peer bot's tag is recoverable like the live path
 * @returns the process exit code
 */
// max-lines-exempt: one cohesive cycle shell over 14 named-object-params fields, one line per field
export async function runScheduledRecover({
  api,
  botUserId,
  channels,
  deadlineMs,
  doorLedger,
  home,
  incidents,
  nowMs,
  responderHatchOpen,
  responderWhitelist,
  sinceExplicit,
  sinceIso,
  supervisor,
  transport,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies" | "listChannels">;
  botUserId: string;
  channels: readonly string[];
  deadlineMs: number | undefined;
  doorLedger: DoorLedgerPort;
  home: string;
  incidents: ScheduledIncidentDetect;
  nowMs: () => number;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  sinceExplicit: boolean;
  sinceIso: string;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
  selfBotId: string | undefined;
}): Promise<number> {
  const stored = readRecoverySweepState({ home });
  const refusal = refuseBeforeSweeping({ sinceExplicit, stored });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_ERROR;
  }
  const previous = stored.isOk() ? stored.value : undefined;
  const dueAtMs = nextRecoveryDue({ nowMs: nowMs(), state: previous });
  if (dueAtMs > nowMs()) {
    const waited = await waitUntilDueOrDeadline({ deadlineMs, dueAtMs, nowMs });
    if (waited === "clock-wake") {
      // `!`: `waitUntilDueOrDeadline` only ever returns "clock-wake" when `deadlineMs` was defined — that is
      // exactly the branch it took to get here.
      const wake: ScheduledRecoverOutput = { deadlineMs: deadlineMs!, kind: "clock-wake" };
      logger.out({ line: JSON.stringify(wake) });
      return EXIT_OK;
    }
  }
  return sweepNow({
    api,
    botUserId,
    channels,
    doorLedger,
    home,
    incidents,
    now: nowMs(),
    previous,
    responderHatchOpen,
    responderWhitelist,
    selfBotId,
    sinceIso,
    supervisor,
    transport,
  });
}
