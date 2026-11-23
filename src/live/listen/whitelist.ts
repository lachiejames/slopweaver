/**
 * WHO may tag this bot and get an answer at all — one deterministic gate, an explicit list of Slack user ids,
 * and nothing else.
 *
 * PURE: a list and an identity in, a decision out. There is no model in this path and there will not be
 * one. The whole value of this gate is that its behaviour is predictable when everything else is not — a
 * mistake about who is driving the bot is worse than a mistake about phrasing, and it is about to reach
 * more systems.
 *
 * ## This is the tree's GATE, and that is its only job
 *
 * The list is who may tag the bot and get an answer at all; past the gate, a decision tree decides what happens
 * to the ask, and the ASK decides, not the person — a listed person can be compromised. The tree is
 * `../../live/turn/tagDecisionTree.ts`, judged by the visible session that takes the turn. Who is on this list is
 * the owner's to settle by criteria, never a hand-kept pick, and the list file is another workspace's to edit.
 *
 * ## The three concerns this is NOT
 *
 * | Concern | Mechanism | Nature |
 * |---|---|---|
 * | **who may tag it** | this whitelist | **deterministic**, an explicit list |
 * | what it does with the ask | the tag decision tree | judgement, in a visible session |
 * | what it may say | the withhold verdict + queue | judgement |
 * | what it may read | nothing — it reads everything | deliberately unconstrained |
 *
 * They COMPOSE and are not collapsed into one setting: the whitelist decides whether to act at all, the
 * withhold judgement decides whether the composed answer may be sent. Neither replaces the other, and
 * neither replaces `./mention.ts`'s own self-loop refusal — THIS install's own app is refused there
 * regardless of whether its user id happens to appear on this list. Any OTHER bot's tag is
 * not refused at that layer at all: it reaches this exact list, exactly like a human's.
 *
 * ## Exact match, and nothing that resembles a match
 *
 * Slack user ids only. No display names, no handles, no email matching, no domain rules, no "anyone in
 * this channel", no group rules, no audience or channel awareness of any kind — a whitelisted identity is
 * admitted everywhere the pre-existing mention parser accepts one. A file with one malformed entry is
 * refused WHOLE — see {@link parseResponderWhitelist}.
 *
 * ## Fail CLOSED by default, with a named escape hatch
 *
 * Absent, unreadable, and empty all refuse everyone by default — including the owner. Failing open
 * silently would hand the bot to the workspace, and the failure would be invisible precisely because the
 * bot kept answering. `openOverride` is the one deliberate exception: an explicit, loud, every-time-logged
 * break-glass for when the gate itself is in the way, matching the `SLOPWEAVER_DOOR_OVERRIDE` /
 * `SLOPWEAVER_ALLOW_RAW` pattern already in this codebase. It is the journalled
 * `responder-allow-open` grant, resolved by the caller (`./responderHatch.ts`) and handed in as a plain
 * boolean — this module reads neither the grant journal nor `process.env`.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

/** The file the list lives in, under `$SLOPWEAVER_HOME`. Never in this repository: it holds real user ids. */
export const RESPONDER_WHITELIST_FILE = "responders.json";

/**
 * The loaded gate: a list, or the fact that it is absent or could not be read.
 *
 * `absent` and `unreadable` are both closed states with different fixes — one is "add the file", the
 * other is "the file exists and is broken" — so they stay distinct rather than collapsing to one "closed".
 * There is no `origin`/profile-fallback concept: the file is the only source of truth.
 */
export type ResponderWhitelist =
  | { readonly kind: "absent" }
  | { readonly kind: "list"; readonly identities: readonly string[] }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The gate's verdict for one identity. A refusal always carries the reason; an admission carries whether
 * the break-glass override is what admitted it, so a caller can log the override firing every time it does.
 */
export type ResponderDecision =
  { readonly admitted: true; readonly openOverride?: true } | { readonly admitted: false; readonly why: string };

const NOT_AN_ARRAY = `${RESPONDER_WHITELIST_FILE} must be a JSON array of Slack user id strings`;

const whitelistSchema = z.array(
  z
    .string({ error: NOT_AN_ARRAY })
    .regex(/^\S+$/, `every entry in ${RESPONDER_WHITELIST_FILE} must be a non-empty Slack user id with no whitespace`),
  { error: NOT_AN_ARRAY },
);

/**
 * Parse an already-decoded JSON value into the identity list.
 *
 * Strict, and the strictness is the point: one malformed entry refuses the WHOLE file rather than being
 * dropped. A silently-dropped entry is an identity the owner believes is whitelisted and is not, which is
 * the failure this gate exists to prevent — refusing the file is fail-closed, so the mistake costs an
 * unanswered tag rather than an answered stranger. Duplicates are collapsed, preserving first-seen order.
 *
 * @param value a parsed JSON value (e.g. from `readFileSync` + `parseJson`)
 * @returns the deduplicated identities, or every reason the file was refused
 */
export function parseResponderWhitelist({ value }: { value: unknown }): Result<readonly string[]> {
  const parsed = whitelistSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  return ok([...new Set(parsed.data)]);
}

/**
 * Decide whether one identity may command the bot.
 *
 * Every branch that is not an exact hit on a non-empty list refuses, and says why in words a log line can
 * carry unchanged — never in words the reply text may carry, which is a separate, deliberately duller
 * template (see {@link responderRefusalText}). `openOverride` is checked only once every ordinary path has
 * already refused, so it can never mask a genuine admission with a misleading "override" flag.
 *
 * @param userId the Slack user id that addressed the bot
 * @param whitelist the loaded gate
 * @param openOverride whether the journalled `responder-allow-open` grant is open — the caller's job to read
 * @returns admitted (optionally flagged as an override), or refused with the reason
 */
export function admitResponder({
  userId,
  whitelist,
  openOverride,
}: {
  userId: string;
  whitelist: ResponderWhitelist;
  openOverride: boolean;
}): ResponderDecision {
  const decision = admitByList({ userId, whitelist });
  if (decision.admitted || !openOverride) {
    return decision;
  }
  return { admitted: true, openOverride: true };
}

/** The ordinary, override-free decision: exact match against whichever state the list is in. */
function admitByList({ userId, whitelist }: { userId: string; whitelist: ResponderWhitelist }): ResponderDecision {
  if (whitelist.kind === "absent") {
    return {
      admitted: false,
      why: `${RESPONDER_WHITELIST_FILE} is absent under $SLOPWEAVER_HOME — refusing every identity`,
    };
  }
  if (whitelist.kind === "unreadable") {
    return {
      admitted: false,
      why: `the responder whitelist could not be read (${whitelist.why}) — refusing every identity`,
    };
  }
  if (whitelist.identities.length === 0) {
    return { admitted: false, why: "the responder whitelist is empty — refusing every identity" };
  }
  if (whitelist.identities.includes(userId)) {
    return { admitted: true };
  }
  return {
    admitted: false,
    why: `\`${userId}\` is not on the responder whitelist (${String(whitelist.identities.length)} configured identities)`,
  };
}

/**
 * One line describing the gate, for the startup log and `listen --check`.
 *
 * States the COUNT rather than the identities, so it is safe to print and to paste into a proof. Names the
 * break-glass override whenever it is active, regardless of the list's own state — the override changes the
 * outcome for any non-member even when the list is otherwise healthy, so hiding it there would be the
 * override acting invisibly, which is exactly what a break-glass must never do.
 *
 * @param whitelist the loaded gate
 * @param openOverride whether the journalled `responder-allow-open` grant is open for this session
 * @returns the summary line
 */
export function whitelistSummary({
  whitelist,
  openOverride,
}: {
  whitelist: ResponderWhitelist;
  openOverride: boolean;
}): string {
  const overrideNote = openOverride
    ? " — the responder-allow-open grant is OPEN for this session, so every identity is admitted regardless"
    : "";
  if (whitelist.kind === "absent") {
    return `the responder whitelist is ABSENT — every identity is refused${overrideNote}`;
  }
  if (whitelist.kind === "unreadable") {
    return `the responder whitelist is UNREADABLE (${whitelist.why}) — every identity is refused${overrideNote}`;
  }
  const count = whitelist.identities.length;
  if (count === 0) {
    return `the responder whitelist is EMPTY — every identity is refused${overrideNote}`;
  }
  return `${String(count)} identit${count === 1 ? "y is" : "ies are"} whitelisted to command the bot${overrideNote}`;
}

/**
 * The fixed reply to a tagger the gate did not admit — deterministic, never model-generated, and never carrying
 * the refusal REASON or the list's size (both stay in the log and the door ledger only).
 *
 * ## A populated list WAITS ON THE OWNER, it never refuses
 *
 * An unlisted tagger is not told the bot will not answer them. The bot says the owner has not made a general
 * ruling on this yet and brings them in to approve this one, so it reads as waiting on a person rather than a
 * rejection. The tag on the owner IS the bringing-in: the owner's own in-thread tag of the bot is the free-form
 * approval, and that tag passes this gate because the owner is on the list. Nothing records the approval as
 * standing: past approvals are never a grant, so the next unlisted tag waits on the owner again.
 *
 * The gate itself does not move: the list is who may tag the bot and get an answer at all, and an unlisted
 * tagger still gets no answer and no turn — bar the journalled `responder-allow-open` grant, which admits
 * everyone and so never reaches this text at all. Whether that tagger is an employee is not something this list can
 * know — what "verified employee" means is not yet ruled — so the copy claims nothing about who they are.
 *
 * ## A closed gate says so instead
 *
 * Absent, unreadable or empty refuses the owner too, so "bringing them in to approve" would be false: the owner's
 * own approval tag would be refused by the same gate. That state says nobody is being answered, and who can fix it.
 *
 * The register stays friendly and short. Copy like "isn't taking direction from you" or "I've flagged this
 * thread" reads as a telling-off to a colleague it refuses.
 *
 * `botLabel` is the operator's own `cardChrome.authorLabel` (see `chromeFromProfile`) rather than a name
 * baked into this file: what the bot calls itself is local, uncommitted configuration, like every other
 * chrome value.
 *
 * @param botLabel what the bot calls itself, from the caller's own chrome configuration
 * @param ownerUserId the owner's Slack user id from the profile, or `null` when it does not resolve
 * @param whitelist the loaded gate, read fresh at send time — never the admission check's own cached copy
 * @returns the reply text to post in the tagger's thread
 */
export function responderRefusalText({
  botLabel,
  ownerUserId,
  whitelist,
}: {
  botLabel: string;
  ownerUserId: string | null;
  whitelist: ResponderWhitelist;
}): string {
  const populated = whitelist.kind === "list" && whitelist.identities.length > 0;
  const owner = mentionableOwner({ ownerUserId });
  if (!populated) {
    const fixer = owner === null ? "its owner can add you, just ask them" : `<@${owner}> can add you, just ask them`;
    return `hey! ${botLabel} isn't answering anyone right now. ${fixer}.`;
  }
  return ownerWaitText({ ownerUserId: owner });
}

/**
 * The owner id only when it can render as a Slack mention: the profile schema accepts any string, and a blank
 * one (`<@>`) or a name (`<@ada>`) tags nobody while reading as though it did. The shape is a Slack user
 * id's — `U` or `W`, then at least two upper-case letters or digits.
 *
 * @param ownerUserId the profile's owner id, or `null` when it does not resolve
 * @returns the id, or `null` when it is not shaped like a Slack user id
 */
function mentionableOwner({ ownerUserId }: { ownerUserId: string | null }): string | null {
  if (ownerUserId === null || !/^[UW][A-Z0-9]{2,}$/.test(ownerUserId)) {
    return null;
  }
  return ownerUserId;
}

/**
 * The waiting-on-the-owner line the listener posts to an unlisted tagger: the owner has not made a general ruling
 * on this yet, and is being brought in to approve this one, with the owner's name replaced by the tag that brings
 * them in. A visible turn's step (d) says the same thing through
 * `turn block --need ruling` (`../turn/blockedForm.ts`), whose card carries the tag.
 *
 * @param ownerUserId the owner's Slack user id from the profile, or `null` when it does not resolve or cannot
 *   render as a mention
 * @returns the line to post in the asker's thread
 */
export function ownerWaitText({ ownerUserId }: { ownerUserId: string | null }): string {
  const owner = mentionableOwner({ ownerUserId });
  if (owner === null) {
    return "hey! its owner hasn't made a general ruling on this yet, so this one waits on their approval.";
  }
  return `hey! <@${owner}> hasn't made a general ruling on this yet, bringing them in to approve this one.`;
}
