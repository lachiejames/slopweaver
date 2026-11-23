/**
 * Heard-as pins: what the owner's voice-to-text makes of a colleague's name, declared by the owner in
 * the store's identity roster, applied only when the exact member ladder names nobody.
 *
 * ## Why this exists
 *
 * The owner's voice-to-text transcripts say "Smitty" where the owner said "Smith", and the owner means John Smith,
 * a person quite different from Orrin Wexley.
 * `identity resolve Smitty` matched nobody and nothing near it, so the session holding "Smitty" labelled the author
 * of the Slack thread it had found — Orrin Wexley — and a review-ask draft tagged that person. The miss left a session guessing from context; a pin gives it the owner's answer.
 *
 * ## Why this is not a spelling table
 *
 * `./rosterNarrow.ts` records the owner's ruling against an alternative-spellings list IN CODE as the fix for
 * misspellings in general; the judged `identity narrow` pass is that fix. A heard-as pin is not a guess about
 * spelling. It is the owner's own declaration about their own dictation, one person at a time, and like every other
 * roster fact it lives off-repo in the human override roster. This module holds the mechanism and no names.
 *
 * ## The order, and why a pin never outranks a real match
 *
 * The exact ladder runs first, and any answer it gives — a colleague, an ambiguity, an outsider, an
 * unplaceable account, a person with no account on the surface — stands. So does a key a roster record confirms
 * outright, its handle, id or email, which the mention layers check before any member answer: the human override
 * always wins, a contradiction inside it included. Only the ladder's `unknown` is a miss. A pin
 * then applies when exactly ONE roster record claims the token; a claim it cannot route — two records, or
 * one with no address — is refused, never picked by array order and never left to the derived roster. The
 * pin's target is re-run through the same exact ladder, so what a caller holds is the resolution typing the
 * right name would have produced, refusals included.
 *
 * Pure — the caller injects the folded people and the roster.
 */
import type { MemberBronzeRow } from "../corpus/members/types.js";
import type { IdentityRecord, IdentitySource } from "./identity.js";
import { mentionLookupRefusals } from "./mentionRefusals.js";
import { lookupMention, type MentionLookup, type MentionPerson, mentionPeople } from "./mentionResolver.js";
import { normaliseHandle } from "./personLookup.js";

/**
 * A member-index lookup, carrying what a heard-as pin did to it. `heardAsTarget` is the key a pin redirected
 * it to; `heardAsUnaddressable` says why a claimed token could not follow its pin. Both absent means the token
 * itself answered, so every existing `MentionLookup` is already one of these.
 */
export type RoutedMentionLookup = MentionLookup & {
  readonly heardAsTarget?: string;
  readonly heardAsUnaddressable?: string;
};

/** Where a heard-as pin sends a token: nowhere, to one key, or into a refusal because the claim is unusable. */
export type HeardAsRoute =
  | { readonly kind: "none" }
  | { readonly kind: "target"; readonly key: string; readonly via: "email" | "slack" }
  | { readonly kind: "unaddressable"; readonly why: string };

/**
 * Where a heard-as pin sends a token: the one claiming record's email, else its one Slack id. A token the
 * roster claims but cannot route — two records, or one with no address — is `unaddressable`, never `none`,
 * because a claimed token falling through to the derived roster could tag somebody else.
 *
 * @param records the human override roster
 * @param token the token as the caller wrote it, `@` and case included
 * @returns `none` when no record claims the token, else the target key or why there is none
 */
export function heardAsRoute({ records, token }: { records: readonly IdentityRecord[]; token: string }): HeardAsRoute {
  const claimants = claimantsOf({ records, token });
  if (claimants.length === 0) {
    return { kind: "none" };
  }
  if (claimants.length > 1) {
    const ids = claimants.map((record) => record.id).join(", ");
    return { kind: "unaddressable", why: `${String(claimants.length)} records claim it (${ids})` };
  }
  const record = claimants[0]!;
  if (record.email !== undefined) {
    return { key: record.email, kind: "target", via: "email" };
  }
  const { identities = [] } = record;
  const slackIds = [...new Set(identities.filter((identity) => identity.source === "slack").map((i) => i.nativeId))];
  if (slackIds.length !== 1) {
    return { kind: "unaddressable", why: `${record.id} claims it but carries no email and not exactly one Slack id` };
  }
  return { key: slackIds[0]!, kind: "target", via: "slack" };
}

/**
 * Resolve a token through the exact ladder, and through a heard-as pin only when that ladder names nobody.
 *
 * @param people the folded, org-classified people
 * @param records the human override roster the pins are read from
 * @param token the raw token
 * @param source the surface being addressed
 * @param conversationMembers the Slack ids in the conversation the message posts into, when read
 * @returns the exact answer when there is one, else the pin target's answer marked with the key it went to,
 *   else the exact `unknown`, marked with why when the roster claims the token but cannot route it
 */
export function lookupMentionWithHeardAs({
  people,
  records,
  token,
  source,
  conversationMembers,
}: {
  people: readonly MentionPerson[];
  records: readonly IdentityRecord[];
  token: string;
  source: IdentitySource;
  conversationMembers?: ReadonlySet<string> | undefined;
}): RoutedMentionLookup {
  const exact = lookupMention({ conversationMembers, people, source, token });
  if (exact.kind !== "unknown") {
    return exact;
  }
  const route = heardAsRoute({ records, token });
  if (route.kind === "none") {
    return exact;
  }
  if (route.kind === "unaddressable") {
    return { ...exact, heardAsUnaddressable: route.why };
  }
  const routed = lookupMention({ conversationMembers, people, source, token: route.key });
  const why = misrouted({ records, route, routed, source, token });
  if (why !== undefined) {
    return { heardAsUnaddressable: why, kind: "unknown" };
  }
  return { ...routed, heardAsTarget: route.key };
}

/** Every roster record whose `heardAs` names the token, compared the way a handle is; none for a blank token. */
function claimantsOf({ records, token }: { records: readonly IdentityRecord[]; token: string }): IdentityRecord[] {
  const needle = normaliseHandle({ handle: token.trim() });
  if (needle.length === 0) {
    return [];
  }
  return records.filter(
    (record) => record.heardAs?.some((value) => normaliseHandle({ handle: value.trim() }) === needle) === true,
  );
}

/**
 * Why a pin's routed answer is not the claiming record's person, or nothing when it is. The person must carry
 * the address the pin went by, and when the record declares its own ids on the surface, the id the ladder picked
 * must be one of them: a fold by email keeps whichever account it met first, so two members sharing one email
 * would otherwise tag the other account.
 */
function misrouted({
  records,
  route,
  routed,
  source,
  token,
}: {
  records: readonly IdentityRecord[];
  route: { readonly key: string; readonly via: "email" | "slack" };
  routed: MentionLookup;
  source: IdentitySource;
  token: string;
}): string | undefined {
  if (routed.kind !== "resolved" && routed.kind !== "no-account") {
    return undefined;
  }
  const named = routed.match.person;
  if (!carriesRoute({ person: named, route })) {
    return `${route.key} resolves to ${named.displayName}, who does not carry it as their ${route.via}`;
  }
  const { identities = [] } = claimantsOf({ records, token })[0]!;
  const declared = identities.filter((identity) => identity.source === source).map((identity) => identity.nativeId);
  if (routed.kind === "resolved" && declared.length > 0 && !declared.includes(routed.nativeId)) {
    return `${route.key} resolves to ${source} id ${routed.nativeId}, which the claiming record does not declare`;
  }
  return undefined;
}

/**
 * Whether the person a pin's target resolved to really carries that target: the ladder matches a key against
 * every field of every source, so an address the record declared could otherwise land on whoever else happens
 * to carry the same string — another provider's id, a reassigned email.
 */
function carriesRoute({
  person,
  route,
}: {
  person: MentionPerson;
  route: { readonly key: string; readonly via: "email" | "slack" };
}): boolean {
  if (route.via === "email") {
    return person.email !== undefined && person.email.toLowerCase() === route.key.toLowerCase();
  }
  return person.identities.some((identity) => identity.source === "slack" && identity.nativeId === route.key);
}

/**
 * Resolve several keys over one fold of the member rows, heard-as pins included. Pure.
 *
 * @param rows every source's member rows
 * @param orgDomains the org's own email domains
 * @param keys the keys to resolve, in any order
 * @param records the human override roster the pins are read from
 * @param source the surface being addressed
 * @param conversationMembers the Slack ids in the conversation the message posts into, when read
 * @returns one lookup per DISTINCT key
 */
export function lookupMentionsWithHeardAs({
  rows,
  orgDomains,
  keys,
  records,
  source,
  conversationMembers,
}: {
  rows: readonly MemberBronzeRow[];
  orgDomains: readonly string[];
  keys: readonly string[];
  records: readonly IdentityRecord[];
  source: IdentitySource;
  conversationMembers?: ReadonlySet<string> | undefined;
}): ReadonlyMap<string, RoutedMentionLookup> {
  const people = mentionPeople({ orgDomains, rows });
  return new Map(
    [...new Set(keys)].map((key) => [
      key,
      lookupMentionWithHeardAs({ conversationMembers, people, records, source, token: key }),
    ]),
  );
}

/**
 * Why a routed lookup handed nobody back, naming the pin when one was followed.
 *
 * A pin whose target no longer resolves must not read like a token nobody declared: the fix is in
 * the identity roster, and a refusal that hid the pin would send a reader to the member index instead.
 *
 * @param key the token as the caller wrote it
 * @param lookup what the routed lookup concluded
 * @param source the surface being addressed
 * @returns the refusal lines; empty when the lookup resolved, or was an `unknown` no record claims
 */
export function routedLookupRefusals({
  key,
  lookup,
  source,
}: {
  key: string;
  lookup: RoutedMentionLookup;
  source: IdentitySource;
}): readonly string[] {
  const refusals = mentionLookupRefusals({ key, lookup, source });
  if (lookup.heardAsUnaddressable !== undefined) {
    return [
      `${JSON.stringify(key)} cannot follow its heard-as pin in the identity roster (slopweaver identity roster replace): ${lookup.heardAsUnaddressable}. Leave exactly one record claiming it, with an email or one Slack id.`,
      ...refusals,
    ];
  }
  if (lookup.heardAsTarget === undefined || lookup.kind === "resolved") {
    return refusals;
  }
  return [
    `${JSON.stringify(key)} is pinned heard-as ${lookup.heardAsTarget} in the identity roster (slopweaver identity roster replace), but the member index does not resolve that target on ${source}.`,
    ...refusals,
  ];
}

/**
 * Whether a routed lookup left the key free to fall through to the derived roster: an `unknown` no roster record
 * claims. A claimed `unknown` — a pin whose target is gone, or a claim no single record can route — is a
 * refusal instead, because the roster answering for the raw token could tag somebody else.
 *
 * @param lookup what the routed lookup concluded, or nothing when the key was never looked up
 * @returns `true` only for an unpinned miss
 */
export function isUnpinnedMiss({ lookup }: { lookup: RoutedMentionLookup | undefined }): boolean {
  if (lookup === undefined) {
    return true;
  }
  return lookup.kind === "unknown" && lookup.heardAsTarget === undefined && lookup.heardAsUnaddressable === undefined;
}

/**
 * The member lookups with every key the roster makes a heard-as claim on, but that arrived unrouted, marked
 * `unaddressable`. A caller that resolved its lookups without `lookupMentionWithHeardAs` would otherwise reopen
 * the derived-roster fallback a claim exists to close. A routed lookup is untouched.
 *
 * @param lookups what the member layer concluded, per key
 * @param keys every key being resolved, looked up or not
 * @param records the human override roster the claims are read from
 * @returns the lookups, with each unrouted claimed key marked
 */
export function markClaims({
  lookups,
  keys,
  records,
}: {
  lookups: ReadonlyMap<string, RoutedMentionLookup>;
  keys: readonly string[];
  records: readonly IdentityRecord[];
}): ReadonlyMap<string, RoutedMentionLookup> {
  const marked = new Map(lookups);
  for (const key of keys) {
    const lookup = lookups.get(key);
    if (isUnpinnedMiss({ lookup }) && heardAsRoute({ records, token: key }).kind !== "none") {
      marked.set(key, { heardAsUnaddressable: "its member lookup was never routed through the pin", kind: "unknown" });
    }
  }
  return marked;
}
