/**
 * The PURE core of `slopweaver slack post|reply --as me` — plan, preview, outcome bookkeeping. The report a drip
 * prints once it has run, `slackDripSendLines`, is exported from `./dripSendLines.ts` only; that module imports the
 * `DripOutcome` type and `dripFullyLanded` from here, and this one imports nothing from it.
 *
 * Everything a reviewer needs to answer "what would go out, in what order, under whose name, and what
 * happens if the third one fails?" is decidable from this file and that one without running anything. The shell
 * (`./run.ts`) holds the loop and the clock and nothing else.
 *
 * The one genuinely new risk in this lane, stated up front because the rest of the file is built around
 * it: **a drip is N sends behind ONE approval, so it can be HALF sent.** The card lane cannot be — it
 * either posts or it does not. Everything here that looks like over-engineering (per-message keys, a
 * five-state outcome, an explicit resend flag) exists so that a half-sent drip is reported honestly and a
 * re-run neither double-posts the lines that landed nor silently skips the one that did not.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { bumpRefusalFor } from "../../../outbound/slack/asMeBumpGate.js";
import { renderDrip } from "../../../outbound/slack/dripRender.js";
import { type DripTarget, dripMessageIdentities, dripSequenceKey } from "../../../outbound/slack/fingerprint.js";
import { type MentionResolution, resolutionSummaryLines } from "../../../outbound/slack/mentionIndex.js";
import type { PlacementReport } from "../../../outbound/slack/placement.js";
import { PREVIEW_LEGEND, previewBlockLines } from "../../../outbound/slack/preview.js";
import type { ResolvedMentions } from "../../../outbound/slack/render.js";
import { payloadRenderIssues } from "../../../outbound/slack/renderCheck.js";
import type { DripShape, SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import { VOICE_RULES_ESCAPE } from "../../../outbound/voice/exactRules.js";
import { paragraphSpacingRefusalFor } from "../../../outbound/voice/paragraphSpacing.js";
import type { SlackDripOptions, SlackRefusal, SlackWriteVerb } from "./core.js";
import { dripMediaLines, mediaStepsFor } from "./dripMediaLines.js";

/** One drip message, fully decided: what goes on the wire, what rides under it, and the key that proves it went. */
export interface PlannedDripMessage {
  readonly index: number;
  readonly payload: SlackDripMessagePayload;
  readonly duplicateKey: string;
  /** The media paths this message carries. Empty on every message of a drip but the one that holds them. */
  readonly media: readonly string[];
}

/** A fully-decided drip. Both `--dry-run` and the real path consume THIS, which is what keeps them equal. */
export interface SlackDripPlan {
  readonly actor: "me";
  readonly channel: string;
  readonly shape: DripShape;
  readonly artifact: AsMeArtifact;
  readonly messages: readonly PlannedDripMessage[];
  /** The whole sequence's identity — the ONE key the door gate sees. */
  readonly duplicateKey: string;
  readonly intervalMs: number;
  /** Every media path the drip carries, in the caller's order — all on one message. */
  readonly media: readonly string[];
  readonly threadTs?: string;
}

/**
 * Build the drip plan: render ONCE, then derive every identity from the rendered payloads.
 *
 * **Media rides on the LAST message, and every earlier one carries none.** A drip is consecutive
 * sentences, so the evidence belongs under the finished thought rather than under its opening line — put
 * on message 1 the images would sit above the words they are evidence for. It is also the only placement
 * that keeps the failure honest: a media attach that cannot be verified retracts its own message, and
 * retracting the LAST message leaves a drip the report already knows how to describe as incomplete,
 * whereas retracting the first would leave replies orphaned from the parent they threaded under.
 *
 * @param options the parsed invocation
 * @param artifact the validated drip, or the plain-body escape hatch
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param intervalMs the operator's configured cadence
 * @returns the plan both the dry run and the real send consume
 */
export function buildSlackDripPlan({
  options,
  artifact,
  mentions,
  intervalMs,
}: {
  options: SlackDripOptions;
  artifact: AsMeArtifact;
  mentions: ResolvedMentions;
  intervalMs: number;
}): SlackDripPlan {
  const payloads = renderDrip({ artifact, mentions });
  const target: DripTarget = {
    actor: options.actor,
    channel: options.channel,
    shape: options.shape,
    ...(options.threadTs !== undefined ? { threadTs: options.threadTs } : {}),
  };
  const lastIndex = payloads.length - 1;
  const contents = payloads.map((payload, index) => ({
    media: index === lastIndex ? options.media : [],
    payload,
  }));
  return {
    actor: options.actor,
    artifact,
    channel: options.channel,
    duplicateKey: dripSequenceKey({ messages: contents, target }),
    intervalMs,
    media: options.media,
    messages: dripMessageIdentities({ messages: contents, target }).map((identity, index) => ({
      ...identity,
      index,
    })),
    shape: options.shape,
    ...(options.threadTs !== undefined ? { threadTs: options.threadTs } : {}),
  };
}

/**
 * Rule 7: a chase names the person, or the door refuses it — run over the WHOLE rendered drip, so a chase
 * opening one message and its mention landing on a later one still passes. See
 * `../../../outbound/slack/asMeBumpGate.ts`.
 *
 * @param plan the fully rendered drip plan
 * @returns the refusal lines, or empty when the plan is not a chase or already tags someone
 */
export function bumpRefusalForPlan({
  plan,
  allowUntagged = false,
}: {
  plan: SlackDripPlan;
  allowUntagged?: boolean;
}): readonly string[] {
  return bumpRefusalFor({ allowUntagged, text: plan.messages.map((message) => message.payload.text).join(" ") });
}

/**
 * The door request for a whole drip.
 *
 * ONE request for the sequence, never one per line: the operator approves "send this thread", and being
 * asked five times to approve five sentences would train them to stop reading. As on the card lane the
 * summary carries NO prose — the ledger records that a send happened, how many messages it was, and its
 * opaque identity, never a word of the body.
 *
 * @param plan the drip plan
 * @param home the state home the ledger lives under
 * @returns the door request
 */
export function slackDripDoorRequest({ plan, home }: { plan: SlackDripPlan; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: plan.threadTs === undefined ? "post" : "reply" },
    artifact: {
      actor: plan.actor,
      channel: plan.channel,
      duplicateKey: plan.duplicateKey,
      mediaCount: plan.media.length,
      messageCount: plan.messages.length,
      shape: plan.shape,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * What happened to ONE message of a drip. Five states, and each one is a thing that actually occurs:
 *
 * - `sent` — it went out on this run, and here is its `ts`, plus the ids of any files verified onto it.
 * - `already-sent` — a previous run sent it and CONFIRMED it; the resume skipped it. Not an error.
 * - `unconfirmed` — a previous run reserved it and never confirmed. It may or may not be in Slack. This is
 *   the state that must never be guessed at: skipping it silently drops a line, re-sending it silently
 *   double-posts, so it halts and says so.
 * - `failed` — the send was attempted on this run and threw.
 * - `not-attempted` — everything after a halt. Reported explicitly rather than omitted, because "message 4
 *   is missing from the report" and "message 4 was never tried" must not look the same.
 */
export type DripOutcome =
  | {
      readonly index: number;
      readonly state: "sent";
      readonly ts: string;
      readonly fileIds: readonly string[];
      /** The link a reader can follow, built from the workspace url — see `../../../outbound/slack/renderCheck.ts`. */
      readonly permalink?: string | undefined;
      /**
       * What a reader will see wrong in the message Slack STORED, read back after the send.
       *
       * Three states, and collapsing them would be the lie this exists to prevent. Absent means the
       * read-back never ran or could not answer. Empty means it ran and the message renders as intended.
       * Non-empty means it is published and something in it renders as literal punctuation.
       */
      readonly renderIssues?: readonly string[] | undefined;
      /** Where the message was read back to be, and any repair the read-back made. */
      readonly placement?: PlacementReport | undefined;
    }
  | { readonly index: number; readonly state: "already-sent"; readonly ts: string }
  | { readonly index: number; readonly state: "unconfirmed"; readonly reservedIso: string }
  | { readonly index: number; readonly state: "failed"; readonly error: string }
  | { readonly index: number; readonly state: "not-attempted"; readonly reason: DripHaltReason };

/** Why the rest of a drip was never attempted. */
export type DripHaltReason = "earlier-failure" | "unconfirmed-prior";

/**
 * Mark every message after a halt as never attempted. Pure — the whole partial-failure story is a function
 * of (how many messages there were, what happened to the ones we got to).
 *
 * The sequence STOPS at the first failure rather than pressing on, and that is deliberate: a drip is
 * consecutive sentences, so posting messages 4 and 5 after 3 failed publishes a paragraph with a hole in
 * the middle under the operator's own name. Halting leaves a resumable gap; continuing leaves a published
 * mistake.
 *
 * @param outcomes what happened to the messages that were reached, in order
 * @param total how many messages the drip has
 * @param reason why the remainder was abandoned
 * @returns one outcome per message, in index order
 */
export function withUnattempted({
  outcomes,
  total,
  reason,
}: {
  outcomes: readonly DripOutcome[];
  total: number;
  reason: DripHaltReason;
}): readonly DripOutcome[] {
  const reached = outcomes.length;
  return [
    ...outcomes,
    ...Array.from({ length: Math.max(0, total - reached) }, (_unused, offset) => ({
      index: reached + offset,
      reason,
      state: "not-attempted" as const,
    })),
  ];
}

/**
 * Whether every message of the drip is accounted for as landed — the only fully-happy outcome.
 *
 * @param outcomes one outcome per message
 * @returns true iff every message was sent on this run or confirmed by an earlier one
 */
export function dripFullyLanded({ outcomes }: { outcomes: readonly DripOutcome[] }): boolean {
  return outcomes.every((outcome) => outcome.state === "sent" || outcome.state === "already-sent");
}

/** One message's body as readable lines — the rendered payload, never the artifact. */
function messageLines({ payload }: { payload: SlackDripMessagePayload }): readonly string[] {
  if (payload.form === "plain") {
    return payload.text.split("\n");
  }
  return previewBlockLines({ block: payload.blocks[0] });
}

/**
 * The human-readable dry-run report: the messages in order, exactly as they will go out.
 *
 * No fold marker and no block counts. The card's preview draws a fold because the card has one; a drip has
 * no wrapper, so the only things worth checking here are the WORDS, the ORDER and the BOUNDARIES between
 * messages — which is why each message is numbered and ruled off rather than run together.
 *
 * @param plan the fully-decided drip
 * @param mentions how the mentions resolved, and the roster state behind them
 * @returns the report lines, in display order
 */
export function slackDripDryRunLines({
  plan,
  mentions,
}: {
  plan: SlackDripPlan;
  mentions: MentionResolution;
}): readonly string[] {
  const count = plan.messages.length;
  return [
    `dry run — nothing was sent. as=me channel=${plan.channel} shape=${plan.shape}` +
      (plan.threadTs === undefined ? "" : ` thread-ts=${plan.threadTs}`),
    `drip: ${String(count)} message(s), ${String(plan.intervalMs)}ms apart, sent in order (no card, no fold)`,
    ...dripMediaLines({ count, media: plan.media }),
    ...resolutionSummaryLines({ resolution: mentions }),
    "",
    PREVIEW_LEGEND,
    ...plan.messages.flatMap((message) => [
      `── message ${String(message.index + 1)}/${String(count)} ──`,
      ...messageLines({ payload: message.payload }),
    ]),
    "",
    "steps the real send would perform:",
    ...plan.messages.flatMap((message) => [
      `  ${String(message.index + 1)}. chat.postMessage — channel=${plan.channel}` +
        `${threadNoteFor({ index: message.index, plan })}, ${describeForm({ payload: message.payload })}`,
      ...mediaStepsFor({ media: message.media }),
    ]),
  ];
}

/** How message N is threaded, said in the dry run rather than discovered by the reader afterwards. */
function threadNoteFor({ index, plan }: { index: number; plan: SlackDripPlan }): string {
  if (plan.shape === "top-level") {
    return " (top-level)";
  }
  if (plan.threadTs !== undefined) {
    return ` thread_ts=${plan.threadTs}`;
  }
  return index === 0 ? " (top-level — becomes the thread parent)" : " thread_ts=<parent from message 1>";
}

/** The wire shape of one message, so a reader can see the escape hatch really is unstructured. */
function describeForm({ payload }: { payload: SlackDripMessagePayload }): string {
  return payload.form === "plain"
    ? "plain text, no blocks (escape hatch — your bytes, unchanged)"
    : "1 rich_text block, no attachment";
}

/**
 * The machine-readable document for `--json` on the as-me lane.
 *
 * `lane` discriminates it from the card lane's {@link SlackWriteReport} at the top level, so a consumer
 * switches on a field instead of sniffing for the presence of `card` — the two documents describe
 * genuinely different sends and pretending otherwise is how a consumer reads a drip as a card with one
 * block. `outcomes` is explicitly `null` on a dry run rather than an empty array, because "nothing was
 * sent" and "nothing landed" are different facts.
 */
export interface SlackDripReport {
  readonly lane: "drip";
  readonly verb: SlackWriteVerb;
  readonly actor: "me";
  readonly channel: string;
  readonly shape: DripShape;
  readonly threadTs: string | null;
  readonly dryRun: boolean;
  readonly duplicateKey: string;
  readonly intervalMs: number;
  /** Every media path the drip carries, in the caller's order — the `messages` entry that holds them says which. */
  readonly media: readonly string[];
  readonly messages: readonly {
    readonly index: number;
    readonly duplicateKey: string;
    readonly payload: SlackDripMessagePayload;
    readonly preview: readonly string[];
    readonly media: readonly string[];
  }[];
  readonly mentions: readonly { readonly person: string; readonly slackId: string; readonly via: string }[];
  readonly roster: MentionResolution["roster"];
  readonly outcomes: readonly DripOutcome[] | null;
  readonly refusal: SlackRefusal | null;
}

/**
 * Build the `--json` document for one drip. Pure.
 *
 * @param plan the fully-decided drip
 * @param options the parsed invocation
 * @param mentions how the mentions resolved
 * @param outcomes one outcome per message, or null for a dry run / a refusal
 * @param refusal what the door refused, or null
 * @returns the report object
 */
export function slackDripReport({
  plan,
  options,
  mentions,
  outcomes,
  refusal,
}: {
  plan: SlackDripPlan;
  options: SlackDripOptions;
  mentions: MentionResolution;
  outcomes: readonly DripOutcome[] | null;
  refusal: SlackRefusal | null;
}): SlackDripReport {
  return {
    actor: "me",
    channel: plan.channel,
    dryRun: options.dryRun,
    duplicateKey: plan.duplicateKey,
    intervalMs: plan.intervalMs,
    lane: "drip",
    media: plan.media,
    mentions: [...mentions.resolved].map(([person, target]) => ({
      person,
      slackId: target.slackId,
      via: target.origin,
    })),
    messages: plan.messages.map((message) => ({
      duplicateKey: message.duplicateKey,
      index: message.index,
      media: message.media,
      payload: message.payload,
      preview: messageLines({ payload: message.payload }),
    })),
    outcomes,
    refusal,
    roster: mentions.roster,
    shape: plan.shape,
    threadTs: unsetFieldAsNull({ key: "threadTs", record: plan }),
    verb: options.verb,
  };
}

/**
 * Refuse an as-me send whose own rendered blocks already carry a defect a reader would see.
 *
 * The SAME pure checker the send receipt runs afterwards (`../../../outbound/slack/renderCheck.ts`), moved
 * to the only other position it can occupy. That symmetry is the design rather than a coincidence, and each
 * position covers exactly what the other cannot:
 *
 * - **The FORM lane can be checked before the wire.** Its blocks are built here, and what Slack stores for
 *   a `rich_text` message is what we sent, so a bare `@handle` or a literal `*bold*` in a text run is
 *   visible now. Refusing beats reporting, because nothing has been published yet.
 * - **The `--body` lane only partly can be.** It is a bare string, and the styling and mentions in it are
 *   decided by Slack's own parse, which has not happened yet — its blocks arrive only on the read-back, which
 *   is precisely why the receipt exists rather than this gate being the whole answer. What the string alone
 *   DOES decide is whether an angle-bracket link can parse at all, so a nested or unclosed one is refused
 *   here, thread replies included (`payloadRenderIssues`).
 *
 * @param plan the fully-built plan, for the blocks each message would post
 * @returns one refusal per defect, naming the message it is in; empty when every message renders as intended
 */
export function renderRefusalForPlan({ plan }: { plan: SlackDripPlan }): readonly string[] {
  return plan.messages.flatMap((message) =>
    payloadRenderIssues({ payload: message.payload }).map(
      (issue) => `message ${String(message.index + 1)} would post something a reader sees wrong. ${issue}`,
    ),
  );
}

/**
 * Refuse a SINGLE as-me message whose paragraphs run together with no blank line between them.
 *
 * Sits beside {@link renderRefusalForPlan} and for the same reason: the subject is the FINAL rendered text,
 * which is the only place the `one-card` form's structural breaks and the `--body` escape hatch's own bytes
 * become the same string. A multi-message drip is out of scope by construction — the gap between messages
 * IS its spacing, and its schema refuses a `\n` in a run — so the gate names the shape it judges.
 *
 * @param plan the fully-built plan, for the rendered text of its one message
 * @param enabled whether the operator's `profile.json` declares the rule
 * @returns one refusal when a single message packs its paragraphs, or empty when it may proceed
 */
export function paragraphSpacingRefusalForPlan({
  plan,
  enabled,
}: {
  plan: SlackDripPlan;
  enabled: boolean;
}): readonly string[] {
  const sole = plan.messages.length === 1 ? plan.messages[0] : undefined;
  if (!enabled || sole === undefined) {
    return [];
  }
  return paragraphSpacingRefusalFor({ escape: VOICE_RULES_ESCAPE, text: sole.payload.text });
}
