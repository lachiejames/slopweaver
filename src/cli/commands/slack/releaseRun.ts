/**
 * `slack post|reply --as me|bot --draft <id> --approve <digest>` — the release of one parked draft, around the
 * ordinary send of the identity it was recorded as: the as-me drip, or for a `--as bot` row the bot card lane in
 * `./releaseBotRun.ts`. The identity typed must be the row's, and an as-me row that is a finding at the top level of
 * a channel is re-recorded as the bot's post rather than released (`./releaseRow.ts`'s `releaseIdentityRefusal`).
 * A thread row releases only by `reply` and a top-level row only by `post`
 * (`releasePlacementRefusal`, beside it), because a thread reply released by `post` lands in the channel.
 *
 * The console's queue card and `slack draft show` both print that command as the way to send a draft they have
 * read (`site/lib/postCard.ts`'s `postCard`). Before this module the verb had no such flag and answered
 * `unknown flag: --draft` — measured releasing a draft on their word, when the chair had to
 * rebuild the form from the stored payload by hand and open the untagged-bump hatch for a DM.
 *
 * ## What their approval binds, checked twice
 *
 * The digest they approved binds the destination, the identity and the exact posted bytes
 * (`../../../outbound/slack/draftRegister.ts`'s `parkedDraftDigest`). So a release refuses, before anything
 * posts, when `--approve` is not the row's digest, and again when the words RE-PREPARED now — through every
 * live gate the ordinary send runs — digest to anything else. A row recorded under another identity, a
 * mention that now resolves to someone else, a form that renders differently: each is drift, and drift is a
 * refusal rather than a send they never read.
 *
 * ## Attachments are the recorded bytes, verified once and never reopened
 *
 * A row carrying `media` names each attachment by SHA-256 in the private store
 * (`../../../admit/slackDraftMediaStore.ts`). The release reads every blob ONCE, before anything is prepared,
 * and refuses on a missing or changed one; the send is then handed exactly those verified bytes through a
 * `readMedia` seam that serves nothing else, so no path is opened between the check and the upload. The
 * recomputed digest binds the entries too, so an approval given before the media existed cannot release it.
 *
 * ## A conversation that moved since the draft read it
 *
 * The owner's approval does not age. What can stop a release is the conversation it lands
 * in having been changed by a person since the draft's own read, which `./releaseFreshnessGate.ts` re-reads after
 * the digest checks and before anything posts. The refusal names the exact change set and three remedies; sending
 * as is takes `--thread-moved-cleared` with that set, journalled on the released event, and a message the re-read
 * found no longer needed closes on `--thanks-instead` ({@link releaseAsThanks}).
 *
 * {@link runSlackDraftRelease} is the order; every decision before it is a function of its inputs plus the
 * three reads it names. Everything once the row resolves — re-preparation, the drift check, thanks, the record —
 * is `./releaseSend.ts`'s, and the send itself is `./asMeSend.ts`'s, shared with a fresh send.
 */
import type { VerifiedDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import { err, ok } from "../../../lib/result.js";
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import {
  asMeChannelFinding,
  findingIdentityRefusal,
  readBotMembership,
} from "../../../outbound/slack/findingIdentity.js";
import type { ConversationSurface } from "../../../outbound/slack/types.js";
import type { SlackDraftReleaseOptions, SlackDripOptions } from "./coreTypes.js";
import { placementOptions } from "./draftCompose.js";
import {
  type SlackLifecycle,
  type SlackLifecycleError,
  SlackLifecycleErrors,
  slackLifecycleErrorLines,
} from "./lifecycleErrors.js";
import { runBotDraftRelease } from "./releaseBotRun.js";
import { stampedGroupDmRefusal } from "./releaseGroupDm.js";
import { appendReleaseHold } from "./releaseRefusalHold.js";
import { reRecordAsBotLine, resolveDraftRow } from "./releaseRow.js";
import { releaseApprovedWords } from "./releaseSend.js";
import { releaseAsThanks } from "./releaseThanks.js";
import type { SlackWriteDeps } from "./run.js";
import { heldReleaseTarget, journalUnresolvedRelease } from "./sendFailureJournalling.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { usage } from "./writeOutput.js";

/**
 * A release resolved against its row: the ordinary drip options to send, the row they came from, and each
 * stored attachment's verified bytes keyed exactly as `drip.media` names them, in attach order.
 */
export interface ResolvedRelease {
  readonly draft: ParkedSlackDraft;
  readonly drip: SlackDripOptions;
  readonly media: ReadonlyMap<string, VerifiedDraftMedia>;
  /** Every other held cut of this message, which the release spends once it lands (`draftSpent.ts`). */
  readonly heldCuts: readonly string[];
}

/**
 * Re-read, at release, the one fact an as-me channel finding was parked on: the bot still cannot post there.
 * The row's `botCannotPost` stamp is what the RECORDING read, and the bot may have been invited, or the channel made
 * public, before they approved — so the stamp lets the row reach this read, never past it.
 *
 * @param deps the injected world, for the bot token and the membership read
 * @param draft the parked row
 * @param home the state home the bot token resolves under
 * @param surface the conversation's kind, read under their token for this release
 * @returns the refusal, or `undefined` when the row is not a stamped channel finding or the bot still cannot post
 */
async function stampedFindingRefusal({
  deps,
  draft,
  home,
  surface,
}: {
  deps: Pick<SlackWriteDeps, "botMembership" | "botToken">;
  draft: ParkedSlackDraft;
  home: string;
  surface: ConversationSurface | undefined;
}): Promise<SlackLifecycleError | undefined> {
  if (draft.botCannotPost === undefined || !asMeChannelFinding({ draft: { ...draft, botCannotPost: undefined } })) {
    return undefined;
  }
  const botToken = deps.botToken({ home });
  const { channel } = draft;
  const botMembership = await readBotMembership({ botToken, channel, read: deps.botMembership, surface });
  const refusal = findingIdentityRefusal({
    actor: "me",
    botMembership,
    channel,
    isFinding: true,
    surface,
    threadTs: undefined,
  });
  if (refusal.length === 0) {
    return undefined;
  }
  return SlackLifecycleErrors.draftFindingIdentity({
    draftId: draft.id,
    reasons: [...refusal, "Nothing was sent.", reRecordAsBotLine({ draft })],
  });
}

/**
 * Find the row, check the approval names it, and build the ordinary as-me options it sends as.
 *
 * `bumpExemption` is set from a LIVE surface read and never from argv: a direct message's one other person
 * is the reader, which is the `untagged-bump` hatch's own named exception, so a release there does not need
 * the hatch opened by hand. The same read is what a stamped channel finding's re-check runs on
 * ({@link stampedFindingRefusal}).
 *
 * @param deps the injected world, for the register, the surface read and the bot's membership read
 * @param options the parsed release
 * @param token the user token the release will post under
 * @returns the options to send and the row, or every reason the release is refused before preparing
 */
export async function resolveDraftRelease({
  deps,
  options,
  token,
}: {
  deps: Pick<
    SlackWriteDeps,
    | "botMembership"
    | "botToken"
    | "conversationGroupDm"
    | "conversationSurface"
    | "doorEnv"
    | "readDraftLog"
    | "readDraftMedia"
  >;
  options: SlackDraftReleaseOptions;
  token: string;
}): Promise<SlackLifecycle<ResolvedRelease>> {
  const row = resolveDraftRow({ deps, options });
  if (row.isErr()) {
    return err(row.error);
  }
  const { draft, formJson, heldCuts, media } = row.value;
  const surface = await deps.conversationSurface({ channel: draft.channel, token });
  const stamped = await stampedFindingRefusal({ deps, draft, home: options.home, surface });
  if (stamped !== undefined) {
    return err(stamped);
  }
  const groupDm = await stampedGroupDmRefusal({ deps, draft, token });
  if (groupDm !== undefined) {
    return err(groupDm);
  }
  return ok({
    draft,
    heldCuts,
    media,
    drip: {
      actor: "me",
      channel: draft.channel,
      dryRun: options.dryRun,
      home: options.home,
      json: options.json,
      media: [...media.keys()],
      resendUnconfirmed: options.resendUnconfirmed,
      source: { json: formJson, kind: "form" },
      ...placementOptions({ threadTs: draft.threadTs }),
      ...(surface === "direct-message" ? { bumpExemption: "direct-message" as const } : {}),
      // they said yes to these exact bytes; the review-ask shape is held at recording, never after their approval.
      reviewer: "approved",
    },
  });
}

/**
 * Release one parked as-me draft: resolve its row, re-prepare its words through every live gate, refuse any
 * drift from the digest they approved, send it as the ordinary drip does, and mark the row released.
 * The order only; each decision before the send is this module's, and the send is `./releaseSend.ts`'s.
 *
 * @returns the process exit code
 */
export async function runSlackDraftRelease({
  deps,
  options,
  token,
}: {
  deps: SlackWriteDeps;
  options: SlackDraftReleaseOptions;
  token: string;
}): Promise<number> {
  if (options.actor === "bot") {
    return runBotDraftRelease({ deps, options, token });
  }
  // The release's first act, and what "held when it started" means: one dropped or spent while the release runs is
  // still journalled against the thread it named here. A row not held at this read was never this release's.
  const target = heldReleaseTarget({ deps, options });
  // READ before resolving the row, which asks Slack the conversation's kind, so a corrupt profile costs no Slack read.
  const config = deps.dripConfig({ home: options.home });
  if (config.isErr()) {
    const exit = unreadableProfileExit({ error: config.error, nothingHappened: "nothing was sent." });
    journalUnresolvedRelease({ errors: [`the profile would not read: ${config.error.message}`], options, target });
    return exit;
  }
  let resolved: Awaited<ReturnType<typeof resolveDraftRelease>>;
  try {
    resolved = await resolveDraftRelease({ deps, options, token });
  } catch (cause: unknown) {
    const why = `the release stopped on an error before sending: ${cause instanceof Error ? cause.message : String(cause)}`;
    journalUnresolvedRelease({ errors: [why], options, target });
    // Resolving asks Slack the conversation's kind, so a throw here is Slack refusing a held row their yes is on.
    if (target !== undefined && !options.dryRun) {
      appendReleaseHold({ deps, home: options.home, id: options.release.draftId, reason: "slack-refused", why });
    }
    throw cause;
  }
  if (resolved.isErr()) {
    const errors = slackLifecycleErrorLines({ error: resolved.error });
    journalUnresolvedRelease({ errors, options, target });
    return usage({ errors });
  }
  if (options.thanksInstead !== undefined) {
    const thanks = options.thanksInstead;
    return releaseAsThanks({ config: config.value, deps, options, resolved: resolved.value, thanks, token });
  }
  return releaseApprovedWords({ config: config.value, deps, options, resolved: resolved.value, token });
}
