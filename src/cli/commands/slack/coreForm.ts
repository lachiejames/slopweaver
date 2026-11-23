/**
 * Form parsing and validation for `slopweaver slack post|reply` — split out of `./core.js`, which
 * re-exports everything here under its original import path.
 *
 * The KINDS themselves and their canonical fixtures live in `../../../outbound/artifact/botFormKinds.ts`, their
 * parsers in `../../../outbound/artifact/botFormLanes.ts`; this module
 * is the dispatcher over that registry plus the owner-ping refusal both lanes print. The split is what makes
 * the kind set an enumerable value — see that module's header for the gate that needed one.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { botFormKindFor } from "../../../outbound/artifact/botFormKinds.js";
import type { ParsedForm } from "../../../outbound/artifact/botFormLanes.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import {
  groupRefusals,
  type MentionResolution,
  mentionRefusals,
  staleRosterRefusals,
} from "../../../outbound/slack/mentionIndex.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { ALLOW_UNRESOLVED_OWNER_FLAG } from "./coreTypes.js";

/**
 * What a parsed form yields, plus WHICH kind produced it.
 *
 * The kind is carried out because a door check can need it and the artifact cannot supply it: a
 * `automation-prompt` derives an ordinary `no-fold` artifact, so by the time the message exists there is
 * nothing left in it saying the bot's own instructions are what it holds. The owner wants that
 * refusal to be schema-shaped rather than a review note, and a payload that declares itself is only useful
 * to a door that can still see the declaration.
 */
export type ParsedFormOfKind = ParsedForm & {
  /** The `BOT_FORM_KINDS` entry that parsed this payload — the fallback's own kind when none matched. */
  readonly formKind: string;
};

/**
 * Parse and validate the form JSON into an artifact, reporting every schema violation in one pass.
 *
 * The shapes accepted are `BOT_FORM_KINDS`, discriminated on `kind`, and this function dispatches over
 * that array rather than over its own chain of comparisons — read that module for each kind and when it is
 * the right one. What matters here is that the set is a VALUE: a kind is added by adding an entry, which the
 * `derived-card-voice` gate then has to be able to see, rather than by adding an `if` nothing can enumerate.
 *
 * Every non-fallback kind is matched first and the fallback — `update` — takes everything else, including a
 * payload naming no kind at all. That ordering is load-bearing for `no-fold` in particular: routed through
 * `updateArtifactSchema` it would be rebuilt as a card, which is to say wrapped in the attachment that makes
 * a Slack message fold, which is the one thing that form exists to prevent.
 *
 * `isKnownPerson` is only consulted for a digest, whose owner ping degrades to visible plain text rather than
 * refusing an unattended send. It defaults to "everyone is known", which is the correct default for the
 * `update` path: there, a mention that does not resolve is caught by the caller's own pre-check and refused,
 * and quietly rewriting it to text here would defeat that.
 *
 * @param json the raw form text
 * @param isKnownPerson whether a person key resolves (digest owners only; default: assume it does)
 * @returns the validated artifact, the kind that produced it and any owner keys that degraded, or every
 *   violation
 */
export function parseSlackForm({
  json,
  isKnownPerson = () => true,
}: {
  json: string;
  isKnownPerson?: (person: string) => boolean;
}): SlackDelivery<ParsedFormOfKind> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return err(SlackDeliveryErrors.formNotJson({ reason: String(error) }));
  }
  const entry = botFormKindFor({ raw });
  return entry.parse({ isKnownPerson, raw }).map((parsed) => ({ ...parsed, formKind: entry.kind }));
}

/**
 * {@link parseSlackForm} with every digest owner judged against ONE roster read. `isKnownPerson` is a synchronous
 * predicate and the roster lives in the store, so the parse runs twice — it is pure — and the read sits between:
 * the first pass only records which owners it asks about, they are resolved together, and the second pass answers
 * from that one resolution. An owner the second pass asks about that the first did not is answered unknown, which
 * degrades or refuses the ping rather than vouching for a person nobody looked up.
 *
 * @param json the raw form text
 * @param knownPeople which of the asked-about people resolve, over one read of the identity roster — a read that
 *   fails is the send's refusal, never an answer
 * @returns what {@link parseSlackForm} returns, or the roster store's refusal
 */
export async function parseSlackFormKnowingOwners({
  json,
  knownPeople,
}: {
  json: string;
  knownPeople: (args: { people: readonly string[] }) => Promise<Result<ReadonlySet<string>, IdentityRosterError>>;
}): Promise<SlackDelivery<ParsedFormOfKind>> {
  const asked = new Set<string>();
  const first = parseSlackForm({
    isKnownPerson: (person) => {
      asked.add(person);
      return true;
    },
    json,
  });
  if (first.isErr() || asked.size === 0) {
    return first;
  }
  const known = await knownPeople({ people: [...asked] });
  if (known.isErr()) {
    return err(SlackDeliveryErrors.upstreamRefused({ reasons: [known.error.message] }));
  }
  return parseSlackForm({ isKnownPerson: (person) => known.value.has(person), json });
}

/**
 * Which of `people` resolve, over ONE call of a send path's mention resolver — the `knownPeople` a
 * {@link parseSlackFormKnowingOwners} caller hands in.
 *
 * @param people the digest owners the first parse asked about
 * @param resolveMentions the send path's resolver, one read of the identity roster per call
 * @returns the people that resolved, or the roster's refusal
 */
export async function knownPeopleVia({
  home,
  people,
  resolveMentions,
}: {
  home: string;
  people: readonly string[];
  resolveMentions: (args: {
    people: readonly string[];
    groups: readonly string[];
    home: string;
  }) => Promise<Result<MentionResolution, IdentityRosterError>>;
}): Promise<Result<ReadonlySet<string>, IdentityRosterError>> {
  const resolved = await resolveMentions({ groups: [], home, people });
  return resolved.map((resolution) => new Set(people.filter((person) => resolution.resolved.has(person))));
}

/**
 * Resolve every person and group a message addresses, and admit the resolution only when it is whole: one
 * read of the roster, then refused on an unresolved person, a refused group or a roster too stale to trust.
 * Every lane that renders a mention runs this one contract rather than restating it.
 *
 * @param people every person the message mentions
 * @param groups every group the message addresses
 * @param home the state home holding the rosters
 * @param resolveMentions the roster lookup, whose store refusal stops the message too
 * @returns the whole resolution, or every refusal — the roster store's own among them
 */
export async function admittedMentions({
  groups,
  home,
  people,
  resolveMentions,
}: {
  groups: readonly string[];
  home: string;
  people: readonly string[];
  resolveMentions: (args: {
    people: readonly string[];
    groups: readonly string[];
    home: string;
  }) => Promise<Result<MentionResolution, IdentityRosterError>>;
}): Promise<Result<MentionResolution>> {
  const resolved = await resolveMentions({ groups, home, people });
  if (resolved.isErr()) {
    return err([resolved.error.message]);
  }
  const resolution = resolved.value;
  const missing = people.filter((person) => !resolution.resolved.has(person));
  const groupsRefused = groupRefusals({ resolution });
  if (missing.length > 0 || groupsRefused.length > 0) {
    return err([...mentionRefusals({ missing, resolution }), ...groupsRefused]);
  }
  const stale = staleRosterRefusals({ people, resolution });
  if (stale.length > 0) {
    return err(stale);
  }
  return ok(resolution);
}

/**
 * The REFUSAL for an owner ping that would not resolve — the default, because the alternative ships broken.
 *
 * ## Why this is not a warning any more
 *
 * It used to be. `digestToUpdate` degrades an unresolvable owner to visible plain text rather than throwing, on
 * the reasoning that a refusal means no digest at all at the scheduled hour — which is a real trade-off and
 * still the behaviour behind the break-glass. What made it wrong as a DEFAULT was the signal: the only trace was
 * a `logger.warn` line on stderr, and the exit code stayed 0. Measured on the real verb — a card went out
 * reading `Ada Lovelace (unresolved)`, the person named was not notified, and a caller reading stdout or the
 * exit code saw a clean success. That is the silent-failure shape: the state was reported fine when it was not.
 *
 * So the default is now to refuse, and `--{@link ALLOW_UNRESOLVED_OWNER_FLAG}` is how a caller says "post it
 * anyway". Same two outcomes as before; the difference is that the degraded one is now CHOSEN rather than
 * discovered later by whoever noticed they were never pinged.
 *
 * ## What it does NOT suggest
 *
 * It never proposes a near-match. `name` is deliberately not an addressable key — a display name is ambiguous
 * no matter who typed it — and the addressable set is the canonical person id, the Slack id, the Slack handle
 * (bare or `@`-prefixed) and the FULL email, never its local part. Guessing across that boundary is how the
 * wrong person gets pinged, so the message says what the valid keys ARE and stops.
 *
 * @param unresolvedOwners the owner keys that did not resolve
 * @returns one refusal line per unresolved owner, plus how to proceed
 */
export function unresolvedOwnerRefusal({
  unresolvedOwners,
}: {
  unresolvedOwners: readonly string[];
}): readonly string[] {
  if (unresolvedOwners.length === 0) {
    return [];
  }
  return [
    ...unresolvedOwners.map(
      (person) =>
        `owner "${person}" is not an exact match in the identity map, so they CANNOT be pinged — refusing ` +
        `rather than posting a card that reads "${person} (unresolved)" while nobody is notified.`,
    ),
    "an owner must be an exact match on a canonical person id, a Slack id, a Slack handle (`handle` or " +
      "`@handle`), or a full email address. A display name is deliberately never a key, and neither is the " +
      "local part of an email — matching either would risk pinging the wrong person.",
    `fix it with \`slopweaver derive\`, or add them to the identity roster with \`slopweaver identity roster replace\`. To post anyway, with the name as plain ` +
      `text and nobody notified, pass \`--${ALLOW_UNRESOLVED_OWNER_FLAG}\`.`,
  ];
}

/**
 * The loud warning for an owner ping that degraded to plain text — now only reachable via the break-glass.
 *
 * Worded to name the consequence rather than only the cause: the digest DID go out, and the person it was meant
 * to reach was not notified. A line that only said "unresolved" would read as cosmetic.
 *
 * @param unresolvedOwners the owner keys that did not resolve
 * @returns one warning line per unresolved owner
 */
export function unresolvedOwnerWarnings({
  unresolvedOwners,
}: {
  unresolvedOwners: readonly string[];
}): readonly string[] {
  return unresolvedOwners.map(
    (person) =>
      `owner "${person}" is not an exact match in the identity map, so they were NOT pinged — the digest ` +
      `still went out with "${person} (unresolved)" as plain text. Run \`slopweaver derive\`, or add them to ` +
      "the identity roster with `slopweaver identity roster replace`, so the next one notifies them.",
  );
}
