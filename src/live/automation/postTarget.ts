/**
 * Where a scheduled row's CARD is allowed to land — the owner's own bot DM, and nowhere else the owner has not
 * said out loud.
 *
 * ## The incident, and what it says about defaults
 *
 * Unasked scheduled cards posted into team channels are spam. Under the current level of graduated autonomy a
 * scheduled card goes to the owner's bot DM, and the owner shares it into a public channel when they choose; the
 * bot never posts these automatically into channels.
 *
 * The mechanism was a DEFAULT rather than anything a row asked for. `./alertSummary.ts` resolved a card's
 * destination as `params.postTo ?? params.channel`, and `params.channel` is **the team channel being
 * read** — so a row that said nothing at all about where its card went posted it into the monitored team
 * channel. Every posting row on this install carried that default. That is why this module exists to
 * supply the DEFAULT and not only to police an override: a refusal bolted onto a bad default catches the
 * rows somebody remembered to look at.
 *
 * ## The prompt rail extended to the CARD
 *
 * `../../outbound/slack/automationPromptChannel.ts` already refuses an automation's QUESTION anywhere
 * but the configured private conversation, because the question is the bot's own instructions. That rail
 * left the ANSWER's audience — `params.postTo` — deliberately free, and its own header says so. This module
 * closes that half: the answer goes to the owner too, and the owner shares it. Read the two as one mechanism.
 *
 * ## The one exception, and the shape it has to have
 *
 * When someone asks the bot to do something, that is a different case: a person's direct ask is not a
 * scheduled row and never reaches this module. What a scheduled row may have is a channel THE OWNER named, in
 * their DM, recorded as a {@link RecipeChannelApproval} — the hold mechanism's `clearedBy` shape plus the channel
 * it admits. What that buys is ORIGIN, never authority (`cross-session-messages.md` § "Anchoring an
 * authority"): the recorded `dmChannel` and `ts` resolve to one message a reader can go and read, so a
 * wrong approval is visible and a missing one refuses.
 *
 * ## No hatch, and the refusal says so
 *
 * Same standing as the prompt refusal and for the same reason (`.claude/rules/error-handling.md` § "A
 * `hold` has no hatch, and says so"): an override here would be a documented way to post
 * unasked into a team channel, which is the exact act the owner deletes. Silence about the absence reads as a
 * forgotten hatch, so every message below names it — and names the real fix, which is an approval row.
 *
 * ## Two gates, complements, and the asymmetry is deliberate
 *
 * This module is the TIGHT one: it knows the recipe, so it can ask whether THIS row was approved for THIS
 * channel. `../../outbound/slack/scheduledPostChannel.ts` is the blunt one at the wire, and it can only ask
 * whether ANY row was approved for the channel — because `./slotLedger.ts`'s `slotDeliveryKey` deliberately
 * keeps the raw recipe id off the wire, so the door has a discriminant and no subject. Neither subsumes the
 * other: this one is skipped by a caller that composes a card without a planner, and that one is skipped by
 * a `verb-run` row whose verb posts without carrying the slot key. Keep both.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { RecipeChannelApproval, RecipeDefinition } from "./definition.js";
import type { RecipeEffect } from "./kinds.js";

/** One conversation a run of a row would post into, and the field that named it. */
export interface RecipePostTarget {
  /** The conversation id. */
  readonly channel: string;
  /** Where the row spelled it, so a refusal names the line an operator has to edit. */
  readonly where: string;
}

/**
 * The install has configured no private conversation, so there is nowhere a scheduled card may land.
 *
 * @internal — a member of {@link ScheduledPostTargetError}; branch on `code`, never on this name.
 */
export interface DmUnconfiguredError {
  readonly code: "DM_UNCONFIGURED";
  readonly message: string;
  readonly recipeId: string;
}

/**
 * The row aims a card at a conversation that is neither the owner's DM nor one the owner has approved for this row.
 *
 * @internal — a member of {@link ScheduledPostTargetError}; branch on `code`, never on this name.
 */
export interface PostTargetNotApprovedError {
  readonly code: "POST_TARGET_NOT_APPROVED";
  readonly message: string;
  readonly recipeId: string;
  readonly channel: string;
  /** The field that named the channel — `params.postTo`, or the argv word for a `verb-run` row. */
  readonly where: string;
}

/** Every way a scheduled row's destination can be one it may not have. */
export type ScheduledPostTargetError = DmUnconfiguredError | PostTargetNotApprovedError;

/**
 * Construct one {@link ScheduledPostTargetError}. Tests build fixtures through these, never a hand-built
 * literal.
 *
 * @internal
 */
export const ScheduledPostTargetErrors = {
  dmUnconfigured: ({ recipeId }: { readonly recipeId: string }): DmUnconfiguredError => ({
    code: "DM_UNCONFIGURED",
    message:
      `recipe '${recipeId}' would post a card, and no \`slackBot.promptChannel\` is set in profile.json, ` +
      "so there is no private conversation for it to land in. Set it to the conversation only you and the " +
      "bot read (the bot's own DM is the intended one). There is deliberately NO override: a scheduled " +
      "card posted where a team can read it is spam.",
    recipeId,
  }),
  postTargetNotApproved: ({
    recipeId,
    channel,
    where,
    dmChannel,
  }: {
    readonly recipeId: string;
    readonly channel: string;
    readonly where: string;
    readonly dmChannel: string;
  }): PostTargetNotApprovedError => ({
    channel,
    code: "POST_TARGET_NOT_APPROVED",
    message:
      `recipe '${recipeId}' aims its card at ${channel} (from ${where}), which is neither the private ` +
      `conversation ${dmChannel} nor a channel it carries the owner's approval for. A scheduled post goes to the ` +
      "owner's DM and the owner shares it. Point it at the DM, or ask the owner on the Queue " +
      "(`handover register`, never in their DM) and, once they have said that channel, record the approval on the " +
      "row's `channelApprovals` — { channel, runSlug, atIso } for the owner's Queue answer, or { channel, " +
      "dmChannel, ts, atIso } for a message the owner sent — which a reader can go and read. There is " +
      "deliberately NO escape hatch here, and that is not an omission: an override would be a documented way to do the thing this refusal exists to prevent.",
    recipeId,
    where,
  }),
} as const;

/**
 * Whether one row carries the owner's recorded approval for one conversation.
 *
 * Exact-match on the channel, never a prefix or a pattern: an approval names ONE conversation the owner said, and
 * anything looser would admit a channel the owner never mentioned.
 *
 * @param approvals the row's recorded approvals, absent on a row that carries none
 * @param channel the conversation being asked about
 * @returns the approval that admits it, or `undefined` when none does
 */
export function approvalFor({
  approvals,
  channel,
}: {
  readonly approvals: readonly RecipeChannelApproval[] | undefined;
  readonly channel: string;
}): RecipeChannelApproval | undefined {
  if (approvals === undefined) {
    return undefined;
  }
  return approvals.find((approval) => approval.channel === channel);
}

/**
 * Resolve where one row's card lands: the owner's DM unless the row named a conversation the owner has approved.
 *
 * The DEFAULT is the point. A row that names no destination gets the DM — not the channel it happens to be
 * reading, which is the spam-shaped resolution a channel default produces.
 *
 * @param recipeId the row being resolved, so a refusal names it
 * @param requested the conversation the row asked for, absent when it named none
 * @param dmChannel the owner's private conversation from `slackBot.promptChannel`, absent on an install with none
 * @param approvals the row's recorded channel approvals
 * @returns the conversation to post into, or the one reason this row may not post where it asked
 */
export function resolveScheduledPostTarget({
  recipeId,
  requested,
  dmChannel,
  approvals,
  where,
}: {
  readonly recipeId: string;
  readonly requested: string | undefined;
  readonly dmChannel: string | undefined;
  readonly approvals: readonly RecipeChannelApproval[] | undefined;
  /** The field the request came from, for the refusal's own text. */
  readonly where: string;
}): Result<string, ScheduledPostTargetError> {
  if (dmChannel === undefined) {
    return err(ScheduledPostTargetErrors.dmUnconfigured({ recipeId }));
  }
  if (requested === undefined || requested === dmChannel) {
    return ok(dmChannel);
  }
  if (approvalFor({ approvals, channel: requested }) !== undefined) {
    return ok(requested);
  }
  return err(ScheduledPostTargetErrors.postTargetNotApproved({ channel: requested, dmChannel, recipeId, where }));
}

/** The argv flags that name a conversation. A closed list: a flag spelled another way is the blind spot below. */
const CHANNEL_FLAGS: ReadonlySet<string> = new Set(["--channel", "--post-to", "--postTo"]);

/** The declared effects under which a `verb-run` row's verb could post at all. */
const EFFECTS_THAT_MAY_POST: ReadonlySet<RecipeEffect> = new Set(["write", "read-write"]);

/**
 * Every conversation a `verb-run` row's argv names — a TRIPWIRE, not a fence.
 *
 * AGENTS.md rule 3's own words apply exactly: "a block confirms you were wrong, its absence means nothing."
 * A `verb-run` row selects an arbitrary verb, so this is a syntax scan of words the row wrote, and it is
 * wrong in both directions on purpose:
 *
 * - **Over-inclusive**: `slack alert-summary --channel <team>` READS that channel. Scoping to rows whose
 *   declared effect could post narrows it and does not fix it. The over-inclusion is ACCEPTED — the fix for
 *   a false positive is an approval row or a split recipe, and on an unattended scheduled post, refusing
 *   too much is the correct direction of error.
 * - **Under-inclusive**, and this is the real limit: a verb can derive a channel itself — from a subteam,
 *   from its own default, from a config file — with no flag here to see. Nothing a scan of argv can reach.
 *   That hole is why `../../outbound/slack/scheduledPostChannel.ts` exists at the wire, and why neither
 *   gate is described as covering this on its own.
 *
 * A row declaring `read` names no post target at all, because a read row's verb may not write — a claim
 * `./verbRun.ts` already checks against the verb's own manifest, so it is a checked fact here rather than
 * an assumption.
 *
 * @param definition the parsed row
 * @returns every conversation its argv names, in argv order, empty when the row cannot post
 */
export function verbRunPostTargets({
  definition,
}: {
  readonly definition: RecipeDefinition;
}): readonly RecipePostTarget[] {
  if (!EFFECTS_THAT_MAY_POST.has(definition.effect)) {
    return [];
  }
  const argv = definition.params["argv"];
  if (!Array.isArray(argv)) {
    return [];
  }
  const targets: RecipePostTarget[] = [];
  argv.forEach((word, index) => {
    if (typeof word !== "string" || !CHANNEL_FLAGS.has(word)) {
      return;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0) {
      return;
    }
    targets.push({ channel: value, where: `params.argv \`${word} ${value}\`` });
  });
  return targets;
}

/**
 * Refuse a `verb-run` row that aims any argv conversation somewhere the owner has not approved.
 *
 * Answers the row's targets on success rather than nothing, so a caller can print what it checked — a gate
 * whose pass is indistinguishable from a gate that ran over an empty list is one nobody can tell is working.
 *
 * @param definition the parsed row
 * @param dmChannel the owner's private conversation, absent on an install that has configured none
 * @returns the targets this row may post into, or the first one it may not
 */
export function refuseVerbRunPostTargets({
  definition,
  dmChannel,
}: {
  readonly definition: RecipeDefinition;
  readonly dmChannel: string | undefined;
}): Result<readonly RecipePostTarget[], ScheduledPostTargetError> {
  const targets = verbRunPostTargets({ definition });
  if (targets.length === 0) {
    return ok(targets);
  }
  if (dmChannel === undefined) {
    return err(ScheduledPostTargetErrors.dmUnconfigured({ recipeId: definition.recipeId }));
  }
  for (const target of targets) {
    if (target.channel === dmChannel) {
      continue;
    }
    if (approvalFor({ approvals: definition.channelApprovals, channel: target.channel }) !== undefined) {
      continue;
    }
    return err(
      ScheduledPostTargetErrors.postTargetNotApproved({
        channel: target.channel,
        dmChannel,
        recipeId: definition.recipeId,
        where: target.where,
      }),
    );
  }
  return ok(targets);
}
