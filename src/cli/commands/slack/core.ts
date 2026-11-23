/**
 * The PURE core of `slopweaver slack post|reply` — parse, validate, plan, and format. No I/O.
 *
 * Everything a reviewer needs to reason about "what would this send, and under whose name?" is
 * decidable from this file alone, which is why the shell (`./run.ts`) holds almost no logic. The
 * invocation types live in `./coreTypes.js`, argument parsing in `./coreArgs.js`, and form
 * validation in `./coreForm.js` — this file re-exports all of it so every existing import of
 * `./core.js` keeps resolving, and itself holds only send-plan and report building.
 */
import type { DoorAcknowledgement, DoorDecision, DoorRequest } from "../../../admit/types.js";
import type { NoFoldArtifact, SlackBotArtifact, UpdateArtifact } from "../../../outbound/artifact/types.js";
import { noFoldRecurrenceOf } from "../../../outbound/slack/automationPromptChannel.js";
import { type DryRunStep, type DryRunWarning, dryRunSteps, dryRunWarnings } from "../../../outbound/slack/dryRun.js";
import { artifactFingerprint, duplicateKey } from "../../../outbound/slack/fingerprint.js";
import {
  type MentionOrigin,
  type MentionResolution,
  type RosterReport,
  resolutionSummaryLines,
} from "../../../outbound/slack/mentionIndex.js";
import { missingMediaSentence } from "../../../outbound/slack/missingMedia.js";
import { renderNoFoldMessage } from "../../../outbound/slack/noFold.js";
import { placementLine } from "../../../outbound/slack/placement.js";
import { noFoldPreviewLines, previewLines } from "../../../outbound/slack/preview.js";
import { type ResolvedMentions, renderUpdateCard } from "../../../outbound/slack/render.js";
import type {
  NoFoldRecurrence,
  SlackCardChrome,
  SlackCardPayload,
  SlackNoFoldPayload,
  SlackSendResult,
} from "../../../outbound/slack/types.js";
import type { SlackCardOptions, SlackWriteVerb } from "./coreTypes.js";

export { parseDripSource, parseSlackWriteArgs } from "./coreArgs.js";
export { parseSlackForm, unresolvedOwnerRefusal, unresolvedOwnerWarnings } from "./coreForm.js";
export {
  ALLOW_UNRESOLVED_OWNER_FLAG,
  type DripSource,
  isDraftRelease,
  type SlackCardOptions,
  type SlackDripOptions,
  type SlackWriteOptions,
  type SlackWriteVerb,
  STDIN_SENTINEL,
  takesFreshWordsAsMe,
} from "./coreTypes.js";
export { resolveSlackWriteToken } from "./writeToken.js";

/** What every bot send names regardless of form: who, where, and the identity the duplicate gate keys on. */
interface SlackWriteTarget {
  readonly actor: "bot";
  readonly channel: string;
  readonly duplicateKey: string;
  /**
   * Whether {@link SlackWriteTarget.duplicateKey} was derived from a caller-supplied DELIVERY identity
   * rather than from the message's content.
   *
   * It changes what a duplicate MEANS, so it changes the gate's severity: a content duplicate is a warn an
   * operator may override, and a keyed one is a hold, because the caller asserted this delivery happens once
   * and there is no operator watching a scheduled run. `outbound/slack/duplicateGate.ts` is where that lands.
   */
  readonly idempotencyKeyed: boolean;
  readonly threadTs?: string;
}

/**
 * A fully-decided send. Both `--dry-run` and the real path consume THIS, which is what keeps them equal.
 *
 * A CORRELATED union rather than two independent widenings, and the correlation is the point: an `update`
 * plan carries an `UpdateArtifact` with the card payload rendered from it, a `no-fold` plan carries a
 * `NoFoldArtifact` with the top-level payload rendered from it, and a `switch` on `kind` narrows both at
 * once. Unioning the artifact and the payload separately would have compiled while permitting the one
 * combination that must never exist — a no-fold artifact rendered into the attachment wrapper that makes a
 * message fold.
 */
export type SlackWritePlan =
  | (SlackWriteTarget & {
      readonly kind: "update";
      readonly artifact: UpdateArtifact;
      readonly payload: SlackCardPayload;
    })
  | (SlackWriteTarget & {
      readonly kind: "no-fold";
      readonly artifact: NoFoldArtifact;
      readonly payload: SlackNoFoldPayload;
      /** Whether these words recur by design — the repeat guard reads it, Slack never sees it. */
      readonly recurrence: NoFoldRecurrence;
    });

/**
 * Build the send plan: render the message ONCE, and derive its identities from it.
 *
 * @param options the parsed invocation
 * @param artifact the validated bot artifact, of either form
 * @param formKind the bot form that produced the artifact, which decides a no-fold message's recurrence
 * @param chrome the operator's card chrome
 * @param mentions identity-map keys already resolved to Slack user ids
 * @returns the plan both the dry run and the real send consume
 */
export function buildSlackWritePlan({
  options,
  artifact,
  formKind,
  chrome,
  mentions,
}: {
  options: SlackCardOptions;
  artifact: SlackBotArtifact;
  formKind: string;
  chrome: SlackCardChrome;
  mentions: ResolvedMentions;
}): SlackWritePlan {
  const target: SlackWriteTarget = {
    actor: options.actor,
    channel: options.channel,
    duplicateKey: duplicateKey({
      actor: options.actor,
      artifact,
      channel: options.channel,
      idempotencyKey: options.idempotencyKey,
      threadTs: options.threadTs,
    }),
    idempotencyKeyed: options.idempotencyKey !== undefined,
    ...(options.threadTs !== undefined ? { threadTs: options.threadTs } : {}),
  };
  if (artifact.kind === "no-fold") {
    return {
      ...target,
      artifact,
      kind: "no-fold",
      payload: renderNoFoldMessage({
        artifact,
        artifactFingerprint: artifactFingerprint({ artifact }),
        mentions,
        metadataEventType: chrome.metadataEventType,
      }),
      recurrence: noFoldRecurrenceOf({ formKind }),
    };
  }
  return {
    ...target,
    artifact,
    kind: "update",
    payload: renderUpdateCard({
      artifact,
      artifactFingerprint: artifactFingerprint({ artifact }),
      chrome,
      mentions,
    }),
  };
}

/**
 * How many blocks one plan's payload carries, whichever form it is.
 *
 * A card's blocks live inside its one attachment wrapper and a no-fold message's live at top level, so
 * every reader of a block count had a `plan.payload.attachments[0]` in it — which does not exist on the
 * no-fold payload and would have been a runtime crash rather than a type error had the two payload types
 * shared a shape. One accessor, switched on the discriminant.
 *
 * @param plan the fully-decided send
 * @returns the number of blocks the message is made of
 * @internal
 */
function planBlockCount({ plan }: { plan: SlackWritePlan }): number {
  return plan.kind === "no-fold" ? plan.payload.blocks.length : plan.payload.attachments[0].blocks.length;
}

/**
 * The readable preview of one plan's payload, whichever form it is.
 *
 * @param plan the fully-decided send
 * @returns the preview lines, including the legend
 * @internal
 */
function planPreviewLines({ plan }: { plan: SlackWritePlan }): readonly string[] {
  return plan.kind === "no-fold"
    ? noFoldPreviewLines({ payload: plan.payload })
    : previewLines({ payload: plan.payload });
}

/**
 * The door request for a send. The artifact summary carries NO prose — the ledger records that a
 * send happened and its opaque identity, never the message body.
 *
 * @param plan the send plan
 * @param home the state home the ledger lives under
 * @param mediaCount how many files ride along
 * @param resendUnconfirmed whether the operator vouched that an unconfirmed prior attempt did not land
 * @param acknowledgements what the caller answered by name — today the picture question's
 *   `--no-picture-because` reason (`../../cardPictureDoor.ts`), which the ledger row records
 * @returns the door request
 */
export function slackDoorRequest({
  plan,
  home,
  mediaCount,
  resendUnconfirmed,
  acknowledgements = [],
}: {
  plan: SlackWritePlan;
  home: string;
  mediaCount: number;
  resendUnconfirmed: boolean;
  acknowledgements?: readonly DoorAcknowledgement[];
}): DoorRequest {
  return {
    // Absent rather than empty when nothing was acknowledged, so an ordinary send writes the line it always did.
    ...(acknowledgements.length === 0 ? {} : { acknowledgements }),
    action: { kind: "verb", noun: "slack", verb: plan.threadTs === undefined ? "post" : "reply" },
    artifact: {
      actor: plan.actor,
      blockCount: planBlockCount({ plan }),
      channel: plan.channel,
      duplicateKey: plan.duplicateKey,
      mediaCount,
      // In the ledger on purpose: a pass the operator's vouching produced must be readable as one later.
      resendUnconfirmed,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/** The steps + advisory warnings for one plan — shared by the human lines and the JSON, so they cannot drift. */
function planFindings({ plan, mediaFilenames }: { plan: SlackWritePlan; mediaFilenames: readonly string[] }): {
  readonly steps: readonly DryRunStep[];
  readonly warnings: readonly DryRunWarning[];
} {
  return {
    steps: dryRunSteps({
      blockCount: planBlockCount({ plan }),
      channel: plan.channel,
      mediaFilenames,
      metadataEventType: plan.payload.metadata.event_type,
      wrappers: plan.kind === "no-fold" ? 0 : plan.payload.attachments.length,
      ...(plan.threadTs !== undefined ? { threadTs: plan.threadTs } : {}),
    }),
    // The advisory warnings read a CARD's fields. A no-fold message has none of them: it carries no
    // citations to be advised about, and its raw-markup and inert-mention classes are both hard REFUSALS in
    // its own schema rather than advisories, so there is nothing left for this to say about one.
    warnings: plan.kind === "no-fold" ? [] : dryRunWarnings({ artifact: plan.artifact }),
  };
}

/**
 * The human-readable dry-run report: the readable CARD first, then the steps, then the advisory warnings.
 *
 * The preview leads because it is the thing a reviewer actually has to read — block counts told you the
 * shape was right and nothing about whether the message was.
 *
 * @param plan the fully-decided send
 * @param mediaFilenames the files that would ride along, in caller order
 * @param mentions how the mentions resolved, and the roster state behind them
 * @returns the report lines, in display order
 */
export function slackDryRunLines({
  plan,
  mediaFilenames,
  mentions,
}: {
  plan: SlackWritePlan;
  mediaFilenames: readonly string[];
  mentions: MentionResolution;
}): readonly string[] {
  const blockCount = planBlockCount({ plan });
  const { steps, warnings } = planFindings({ mediaFilenames, plan });
  return [
    `dry run — nothing was sent. as=${plan.actor} channel=${plan.channel}`,
    planShapeLine({ blockCount, plan }),
    ...resolutionSummaryLines({ resolution: mentions }),
    "",
    ...planPreviewLines({ plan }),
    "",
    "steps the real send would perform:",
    ...steps.map((step) => `  ${String(step.order)}. ${step.api} — ${step.detail}`),
    ...(warnings.length === 0
      ? []
      : ["", "warnings (advisory — these never block a send):", ...warnings.map((w) => `  ! ${w.message}`)]),
  ];
}

/**
 * The one line describing the message's SHAPE, and what that shape does or does not promise.
 *
 * The card arm no longer claims a card "WILL NOT FOLD" under five blocks. That claim was refuted by a
 * three-block attachment that folds, and a dry run repeating it is worse than silent — it is the exact
 * reassurance that let a folding message be shipped as proof that the fold was gone. What the card arm says
 * now is where to go for an answer nothing local can give.
 *
 * @param plan the fully-decided send
 * @param blockCount how many blocks the message is made of
 * @returns the one shape line
 */
function planShapeLine({ plan, blockCount }: { plan: SlackWritePlan; blockCount: number }): string {
  if (plan.kind === "no-fold") {
    return (
      `no-fold: ${String(blockCount)} top-level block(s), NO attachment wrapper — the wrapper is what was ` +
      "measured to make a message fold. Prove it with `slopweaver slack shot` after sending."
    );
  }
  return (
    `card: ${String(blockCount)} blocks in 1 wrapper — whether Slack draws "Show more" on it is NOT ` +
    "decidable here; photograph it with `slopweaver slack shot` if that matters."
  );
}

/**
 * The report after a real send.
 *
 * @param result the created message's identity and attached file ids
 * @returns the report lines, in display order
 */
export function slackSendLines({ result }: { result: SlackSendResult }): readonly string[] {
  return [
    `sent — channel=${result.channel} ts=${result.ts}`,
    ...(result.fileIds.length === 0 ? [] : [`media attached and read back: ${String(result.fileIds.length)} file(s)`]),
    ...(result.missingMedia.length === 0
      ? []
      : [`DEGRADED — ${missingMediaSentence({ missing: result.missingMedia })}`]),
    ...(result.placement === undefined ? [] : [placementLine({ report: result.placement })]),
  ];
}

/**
 * What stopped a send, when nothing went out — carried in the JSON so a caller need not parse stderr.
 *
 * Two different facts share this shape and `status` tells them apart. A door refusal is `warn` or `hold`, with the
 * gates' findings. A store that could not record the door's decision is `recording-refused`: no findings, and
 * `error` carrying why — never a `pass`, since the door's verdict is not what stopped the send.
 */
export interface SlackRefusal {
  readonly status: DoorDecision["status"] | "recording-refused";
  readonly findings: readonly { readonly code: string; readonly summary: string; readonly correction: string }[];
  /** Why the decision could not be recorded; present only when `status` is `recording-refused`. */
  readonly error?: string;
}

/**
 * The machine-readable document for `--json`: the EXACT payload, the readable preview, every step, the
 * warnings, how each mention resolved, and the outcome.
 *
 * One document serves the dry run, a completed send and a refusal, because a consumer that has to branch on
 * which shape it got is a consumer that will get it wrong. `sent` and `refusal` are explicitly `null` rather
 * than absent for the same reason.
 */
export interface SlackWriteReport {
  /** Discriminates the CARD document from the as-me drip's — see `SlackDripReport`. */
  readonly lane: "card";
  readonly verb: SlackWriteVerb;
  readonly actor: "bot";
  readonly channel: string;
  readonly threadTs: string | null;
  readonly dryRun: boolean;
  readonly duplicateKey: string;
  /** Which bot form this was: the folded card, or the one that must render entirely above the fold. */
  readonly form: "update" | "no-fold";
  /**
   * The message's shape. `folds` is deliberately GONE: it was computed as `blocks > 5`, which is the
   * refuted claim, and a consumer reading it was being told something no code here can know. A no-fold
   * message reports `wrappers: 0`, which is the structural fact that matters and is checkable.
   */
  readonly card: { readonly blocks: number; readonly wrappers: number };
  readonly payload: SlackCardPayload | SlackNoFoldPayload;
  readonly preview: readonly string[];
  readonly steps: readonly DryRunStep[];
  readonly warnings: readonly DryRunWarning[];
  readonly mentions: readonly { readonly person: string; readonly slackId: string; readonly via: MentionOrigin }[];
  readonly roster: RosterReport;
  readonly sent: SlackSendResult | null;
  readonly refusal: SlackRefusal | null;
}

/** The thread this send replies under, or `null` for a top-level post, which carries no thread parent. */
function replyParentOf({ plan }: { plan: SlackWritePlan }): string | null {
  if (plan.threadTs === undefined) {
    // A top-level post, not a reply.
    return null;
  }
  return plan.threadTs;
}

/**
 * Build the `--json` document for one invocation. Pure.
 *
 * @param plan the fully-decided send
 * @param options the parsed invocation
 * @param mediaFilenames the files riding along, in caller order
 * @param mentions how the mentions resolved
 * @param sent the send result, or null for a dry run / a refusal
 * @param refusal what the door refused, or null
 * @returns the report object
 */
export function slackWriteReport({
  plan,
  options,
  mediaFilenames,
  mentions,
  sent,
  refusal,
}: {
  plan: SlackWritePlan;
  options: SlackCardOptions;
  mediaFilenames: readonly string[];
  mentions: MentionResolution;
  sent: SlackSendResult | null;
  refusal: SlackRefusal | null;
}): SlackWriteReport {
  const blocks = planBlockCount({ plan });
  const { steps, warnings } = planFindings({ mediaFilenames, plan });
  return {
    actor: plan.actor,
    card: { blocks, wrappers: plan.kind === "no-fold" ? 0 : plan.payload.attachments.length },
    channel: plan.channel,
    form: plan.kind,
    dryRun: options.dryRun,
    duplicateKey: plan.duplicateKey,
    lane: "card",
    mentions: [...mentions.resolved].map(([person, target]) => ({
      person,
      slackId: target.slackId,
      via: target.origin,
    })),
    payload: plan.payload,
    preview: planPreviewLines({ plan }),
    refusal,
    roster: mentions.roster,
    sent,
    steps,
    threadTs: replyParentOf({ plan }),
    verb: options.verb,
    warnings,
  };
}

/**
 * Serialise the report. A single document on stdout and nothing else, per the repo's stream contract —
 * diagnostics and warnings stay on stderr so `slopweaver slack post --json | jq` always parses.
 *
 * @param report the report object
 * @returns the JSON text
 */
export function slackWriteJson({ report }: { report: SlackWriteReport }): string {
  return JSON.stringify(report, null, 2);
}
