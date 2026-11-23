/**
 * Build the REAL capture-time reaction/checklist/status transport once — the socket listener and scheduled
 * recovery both call this rather than each hand-rolling their own copy of the same live wiring.
 */

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { whitelistJudgement } from "../../../admit/withhold.js";
import type { SlackWriteTransport, UploadReadiness } from "../../../corpus/slack/writeTransport.js";
import { type Result } from "../../../lib/result.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import type { CapturedChecklistDeps, CaptureReactionDeps } from "../../../live/listen/capture.js";
import type { Mention } from "../../../live/listen/mention.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { lifecycleReactionEmojis } from "../../../live/turn/lifecycleReactions.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../live/turn/poster.js";
import { TURN_STATUS_TEXT, type TurnProvenance } from "../../../live/turn/run.js";
import { assistantStatusArgs } from "../../../outbound/assistant/status.js";
import type { TurnChrome } from "../../../outbound/slack/types.js";
import type { IdentityRosterSnapshot } from "../../../silver/identityRoster.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { supervisorModelLabel } from "../../../supervisor/session.js";
import { captureReactionEmojiFromProfile, chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";

/**
 * Who a card posted BEFORE any worker exists names as its author.
 *
 * Not `../turn/cardGates.ts`'s `cardAuthorLabel`, and the difference is a fact about when each is called
 * rather than a preference: that one reads the ask's current-generation DISPATCH record to name the worker
 * doing the work, and at capture time — and at the moment `../turn/ensureCard.ts` proves a card, which is
 * the gate a dispatch crosses BEFORE its worker is launched — there is no such record to read. So both
 * pre-worker paths say what is actually true: this supervisor, or none yet.
 *
 * @param supervisor the visible supervisor session, when the caller has one to attribute the turn to
 * @returns the provenance to stamp on a pre-worker card
 */
export function preWorkerProvenance({ supervisor }: { supervisor: SupervisorSession | undefined }): TurnProvenance {
  return {
    modelId:
      supervisor === undefined
        ? "awaiting a visible supervisor session"
        : supervisorModelLabel({ session: supervisor }),
    ...(supervisor === undefined ? {} : { supervisor }),
  };
}

/** The capture poster's roster placeholder — see the call site for why it is never read. */
const CAPTURE_HAS_NO_ROSTER: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };

/**
 * The live {@link CapturedChecklistDeps}: a real poster built from the profile's chrome, and a real
 * `assistant.threads.setStatus` call, both on the transport the caller already holds.
 *
 * A supervised caller carries its opaque host identity. Without one, the checklist instead states that it
 * is awaiting a visible session; neither shape invents a model or a shareable session link.
 *
 * Exported because `../turn/liveCardWiring.ts` builds the SAME poster for the card a dispatch stands up when
 * capture's own post never landed — one wiring, so the two paths cannot draw two shapes.
 *
 * @param doorLedger where the poster's door decisions are recorded before they are performed
 * @param home the state home the chrome reads
 * @param log where a failed post or status call is reported
 * @param supervisor the visible supervisor session, when the caller has one to attribute the turn to
 * @param transport the Slack write transport this call posts with
 * @returns the seams `withCapturedChecklist` drives
 */
export function liveCapturedChecklistDeps({
  doorLedger,
  home,
  log,
  supervisor,
  transport,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  log: ListenLog;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
}): CapturedChecklistDeps {
  const chrome = chromeFromProfile({ home });
  const turnChrome = turnChromeFrom({ chrome });
  const provenance = preWorkerProvenance({ supervisor });
  // This poster is built only to post the capture-time WORKING message (`.postWorking` below) — it never
  // answers, so `mentions`/`readiness`/`judge` are unreachable placeholders `.postAnswer` would need and this
  // call site does not; the judgement is still constructed correctly rather than left inert-but-wrong.
  const noReadiness: UploadReadiness = {
    waitForFile: async () => ({ kind: "unreadable", lastError: "this poster never uploads", polls: 0, waitedMs: 0 }),
  };
  const judge = whitelistJudgement({
    openOverride: responderHatchOpenNow({ home }),
    whitelist: loadResponderWhitelist({ home }),
  });
  return {
    log,
    mintTurnId: () => `turn-${String(Date.now())}`,
    postChecklist: ({ mention, steps, task, turnId }) =>
      liveTurnPoster({
        askIdentity: askIdentityOf({ source: mention }),
        // No verdict at CAPTURE time: nothing has been composed yet, so nothing could have been reviewed.
        // The gate refuses on `undefined`, which is what makes "capture posted an answer" impossible rather
        // than merely unlikely — this path acknowledges and queues, it never answers. No freshness note for
        // the same reason: there is no answer yet for the thread to have moved under.
        freshnessNote: undefined,
        verdict: undefined,
        chrome,
        doorLedger,
        home,
        // Unreachable like `mentions`: only `.displayNames` reads it, and capture never renders an answer card,
        // so the listener opens no store connection for a roster it would not use.
        identityRoster: CAPTURE_HAS_NO_ROSTER,
        judge,
        mentions: NO_MENTIONS,
        provenance,
        readiness: noReadiness,
        transport,
        turnChrome,
        turnId,
      }).postWorking({ steps, task }),
    setStatus: ({ mention }) => setCaptureStatus({ mention, supervisor, transport, turnChrome }),
  };
}

/**
 * Set the native thinking indicator for one captured mention, narrowing the assistant transport's structured
 * refusal to the single reason line this seam's contract carries.
 *
 * @param mention the addressed message the indicator hangs off
 * @param supervisor the visible supervisor session, when there is one
 * @param transport the Slack write transport
 * @param turnChrome the bot's rendered identity
 * @returns nothing on success, or the reason the indicator was refused
 */
async function setCaptureStatus({
  mention,
  supervisor,
  transport,
  turnChrome,
}: {
  mention: Mention;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
  turnChrome: TurnChrome;
}): Promise<Result<void, string>> {
  const set = await transport.setAssistantStatus({
    args: assistantStatusArgs({
      channelId: mention.channel,
      iconEmoji: turnChrome.authorEmoji,
      status: supervisor === undefined ? "is waiting for a visible session…" : TURN_STATUS_TEXT,
      threadTs: mention.threadTs,
      username: turnChrome.authorLabel,
    }),
  });
  return set.mapErr(({ reason }) => reason);
}

/**
 * Build the real reaction and checklist/status seams `capturedMentionHandler` needs, on one transport.
 *
 * @param doorLedger where the checklist poster's door decisions are recorded before they are performed
 * @param home the state home the reaction emoji and chrome are configured in
 * @param log where a failed capture effect is reported
 * @param supervisor the visible supervisor session, when the caller has one to attribute the turn to
 * @param transport the Slack write transport both seams post with
 * @returns the checklist and reaction deps, ready for `capturedMentionHandler`
 */
export function liveCaptureDeps({
  doorLedger,
  home,
  log,
  supervisor,
  transport,
}: {
  doorLedger: DoorLedgerPort;
  home: string;
  log: ListenLog;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
}): {
  readonly checklist: CapturedChecklistDeps;
  readonly reaction: CaptureReactionDeps;
} {
  // Read ONCE per wiring rather than per reaction: the capture reaction converges against the whole set, and
  // a profile re-read mid-capture could hand two transitions different sets — which is the "each site knows
  // its own half of the lifecycle" shape this convergence exists to remove.
  const lifecycle = lifecycleReactionEmojis({ home });
  const addReaction = ({ channel, name, ts }: { channel: string; name: string; ts: string }): Promise<boolean> =>
    transport.addReaction({ name, posted: { channel, ts } });
  const removeReaction = ({ channel, name, ts }: { channel: string; name: string; ts: string }): Promise<boolean> =>
    transport.removeReaction({ name, posted: { channel, ts } });
  return {
    checklist: liveCapturedChecklistDeps({ doorLedger, home, log, supervisor, transport }),
    reaction: { addReaction, emoji: captureReactionEmojiFromProfile({ home }), lifecycle, log, removeReaction },
  };
}
