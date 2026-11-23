/**
 * Resolve a person TOKEN — a first name, a full name, a handle, an email, a native id — to the colleague it
 * names, **from the member index alone**. No corpus read, no `derive`, no network. This is what addressing
 * someone needs: the id to tag, or a loud refusal.
 *
 * ## Why it exists
 *
 * Every addressing surface here read the DERIVED roster, and `derive` refuses on a corpus past the heap
 * ceiling — a corpus of several GiB on a real machine, `slopweaver audit run`. So the roster froze at whenever
 * derive last succeeded and degraded SILENTLY: a colleague who joined after that reads as `no canonical
 * person`, which is the same answer as a colleague who does not exist. Measured while trying to
 * tag eight named colleagues, five would not resolve, and the fifth resolved to the wrong human.
 *
 * The member index has no such dependency. It is written by hydration straight from each provider's own
 * member list — Slack's `users.list` and its peers — and read here with `readAllMembers`. Everything a
 * mention needs is already in it: ids, handles, display names, emails, and whether the account is a bot or
 * deactivated. That is the whole design decision this file records, and it was taken over the alternative
 * deliberately: a LIVE `users.list` read on every send would put a network round-trip and a token scope in
 * front of addressing someone, for data that is already on disk. (`slack probe` cannot serve as that live
 * path in any case — it reports response SHAPE by design, field names and counts, never values, so it can
 * say `users.list` returned N users and can never say which one is a given colleague.)
 *
 * ## Why it does not go through `resolvePeople`
 *
 * That resolver answers a different question. It groups every identity the whole corpus ever emitted,
 * including activity-derived candidates carrying a display name and nothing else, and its lookup
 * ({@link ./personLookup.resolvePersonForRaw}) matches a name only EXACTLY. Both properties are right for
 * `identity show`, and together they are what produced the measured failures: three first names returned
 * `no canonical person` because no identity is *named* by a first name — a colleague's display name is their
 * full name; one returned a junk single-source Linear row whose display name happened to be exactly the
 * first name, in preference to the colleague carrying that name properly across three sources; and one
 * returned an external guest at another company. Four of the five read as ABSENCE. None of them was.
 *
 * ## The ladder
 *
 * Colleagues are considered first and alone: the strongest tier at which any ORG member matches decides the
 * answer, and an outsider never outranks one. Only when no colleague matches at all does an external or
 * unverifiable match get reported — as a refusal, never as an answer.
 *
 *   1. `native-id`  — the source's own id for the person. Unambiguous by construction.
 *   2. `email`      — the full address, or its local part.
 *   3. `handle`     — the source handle.
 *   4. `full-name`  — the whole display name.
 *   5. `given-name` — the FIRST token of a display name. This is the tier the failures needed.
 *   6. `name-part`  — any other token of a display name (a surname, a middle name).
 *
 * Given-name sits above name-part deliberately: two colleagues can share a token where one carries it as a
 * first name and the other as a surname, and a bare first name means the first name. That is a tier, not a
 * tie-break, and the regression fixture carries the real pair it separates.
 *
 * ## What it refuses
 *
 * Two live colleagues of the same first name is a REAL ambiguity and a human has to choose, so it names them
 * and answers nothing. An external domain, a member row with no verifiable email, or a colleague with no
 * account on the surface being addressed is refused with the reason. What it must never do is what it used
 * to do: answer.
 *
 * TWO exceptions, and each is a membership fact rather than a loosening: a bot of this workspace's own Slack,
 * matched at an identifier tier, resolves; and so does a member of the CONVERSATION the message posts into,
 * when the caller read that conversation's members. See {@link isSlackWorkspaceBot} and {@link inConversationId}
 * for why email cannot decide either case, and {@link addressableAtStrongestTier} for why neither ever displaces
 * a live colleague.
 *
 * Pure — the caller injects the member rows and the org domains. The words a refusal prints are
 * `./mentionRefusals.ts`.
 */
import type { MemberBronzeRow } from "../corpus/members/types.js";
import type { IdentitySource } from "./identity.js";
import { isOrgEmail } from "./orgDomains.js";
import { normaliseEmail, normaliseHandle, normaliseName } from "./personLookup.js";

/** How strongly a token matched a person, strongest first. See the module note for why the order is this. */
type MentionTier = "native-id" | "email" | "handle" | "full-name" | "given-name" | "name-part";

const TIER_ORDER: readonly MentionTier[] = ["native-id", "email", "handle", "full-name", "given-name", "name-part"];

/**
 * Whether a matched person is a colleague. `org` joins on an org email domain; `external` carries an email
 * at some other domain; `unverified` carries no trusted email at all, so nothing places them either way.
 */
export type MentionOrgStatus = "org" | "external" | "unverified";

/** One source's contribution to a mentionable person — the fields a caller needs to tag or to disambiguate. */
interface MentionIdentity {
  readonly source: IdentitySource;
  readonly nativeId: string;
  readonly handle?: string;
  readonly name?: string;
  readonly email?: string;
  /** False when the source says the account is deactivated. */
  readonly active: boolean;
  readonly bot: boolean;
}

/** A person the member index knows, folded across every source that named them. */
export interface MentionPerson {
  /** Stable key: the trusted email when there is one, else `<source>:<nativeId>` — the grouping key too. */
  readonly key: string;
  readonly displayName: string;
  readonly email?: string;
  readonly identities: readonly MentionIdentity[];
  /** True when at least one source still calls the account active. */
  readonly active: boolean;
  readonly bot: boolean;
  readonly orgStatus: MentionOrgStatus;
}

/** A matched person and the tier that matched them. */
export interface MentionMatch {
  readonly person: MentionPerson;
  readonly tier: MentionTier;
}

/**
 * What a token resolved to. Every non-`resolved` arm is a REFUSAL that carries what it saw, because the
 * failure this module exists to prevent is a confident answer — so "I found someone and will not hand them
 * to you" has to be representable, and distinguishable from "I found nobody".
 *
 * The arms are separate because their FIXES are separate: choose a person, address them by id, hydrate
 * members, or accept that they have no account on this surface.
 */
export type MentionLookup =
  | { readonly kind: "resolved"; readonly match: MentionMatch; readonly nativeId: string }
  | { readonly kind: "ambiguous"; readonly tier: MentionTier; readonly matches: readonly MentionMatch[] }
  | { readonly kind: "external"; readonly matches: readonly MentionMatch[] }
  | { readonly kind: "unverified"; readonly matches: readonly MentionMatch[] }
  | { readonly kind: "no-account"; readonly match: MentionMatch; readonly source: IdentitySource }
  | { readonly kind: "unknown" };

/**
 * The latest row per `(source, sourceId)`. Member bronze is APPEND-ONLY — a re-hydrate that sees a changed
 * profile appends rather than replaces — so a naive read sees one colleague as several, and a stale row can
 * outvote the current one. Pure.
 *
 * @param rows every row read off member bronze
 * @returns one row per member, the most recently fetched; a tie keeps the last in file order, which is the
 *   later append
 */
export function latestMemberRows({ rows }: { rows: readonly MemberBronzeRow[] }): readonly MemberBronzeRow[] {
  const latest = new Map<string, MemberBronzeRow>();
  for (const row of rows) {
    const key = `${row.source}:${row.sourceId}`;
    const held = latest.get(key);
    if (held === undefined || row.fetchedAtIso >= held.fetchedAtIso) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

/** The trusted, normalised email a row contributes as a join key — `weak`/`missing` trust contributes none. */
function joinEmail({ row }: { row: MemberBronzeRow }): string | undefined {
  const { emailNormalised, emailTrust } = row.identity;
  return emailTrust === "trusted" && emailNormalised !== undefined && emailNormalised.length > 0
    ? normaliseEmail({ email: emailNormalised })
    : undefined;
}

/**
 * The name tokens a display name contributes: the whole normalised name, then its parts. Split on
 * whitespace and on the separators a handle-shaped display name uses, so `ada.lovelace` yields the same two
 * parts as `Ada Lovelace`. Pure.
 *
 * @param name the raw display name
 * @returns the whole normalised name, and each part in order — position 0 of the parts is the given name
 */
export function nameTokens({ name }: { name: string }): { whole: string; parts: readonly string[] } {
  const whole = normaliseName({ name });
  const parts = whole
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { parts, whole };
}

/** Classify a person's email against the org's domains. */
function orgStatusOf({
  email,
  orgDomains,
}: {
  email: string | undefined;
  orgDomains: readonly string[];
}): MentionOrgStatus {
  if (email === undefined) {
    return "unverified";
  }
  return isOrgEmail({ email, orgDomains }) ? "org" : "external";
}

/** Fold one member row into a person under construction. */
function foldRow({ people, row }: { people: Map<string, MentionPerson>; row: MemberBronzeRow }): void {
  const email = joinEmail({ row });
  const key = email ?? `${row.source}:${row.identity.nativeId}`;
  const { handle, name } = row.identity;
  const active = row.profile.active !== false;
  const bot = row.profile.bot === true;
  const identity: MentionIdentity = {
    active,
    bot,
    nativeId: row.identity.nativeId,
    source: row.source,
    ...(handle !== undefined ? { handle } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(row.identity.email !== undefined ? { email: row.identity.email } : {}),
  };
  const held = people.get(key);
  people.set(key, {
    active: held?.active === true || active,
    bot: held?.bot === true || bot,
    displayName: held?.displayName ?? name ?? handle ?? row.identity.nativeId,
    // The first row folded under a key starts its person's identities; every later row extends them.
    identities: held === undefined ? [identity] : [...held.identities, identity],
    key,
    orgStatus: orgStatusOf({ email, orgDomains: [] }),
    ...(email !== undefined ? { email } : {}),
  });
}

/**
 * Fold member rows into the distinct people they describe, joined across sources on a trusted email and
 * classified against the org's domains. Pure.
 *
 * @param rows the member rows, any vintage — {@link latestMemberRows} is applied here
 * @param orgDomains the established org email domains
 * @returns one entry per person, deterministically ordered by key
 */
export function mentionPeople({
  rows,
  orgDomains,
}: {
  rows: readonly MemberBronzeRow[];
  orgDomains: readonly string[];
}): readonly MentionPerson[] {
  const people = new Map<string, MentionPerson>();
  for (const row of latestMemberRows({ rows })) {
    foldRow({ people, row });
  }
  return [...people.values()]
    .map((person) => ({ ...person, orgStatus: orgStatusOf({ email: person.email, orgDomains }) }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
}

/** Whether any of a person's identities carries the token as its native id. */
function matchesNativeId({ person, needle }: { person: MentionPerson; needle: string }): boolean {
  return person.identities.some((identity) => normaliseHandle({ handle: identity.nativeId }) === needle);
}

/** Whether any of a person's emails matches the token whole, or by its local part. */
function matchesEmail({ person, needle }: { person: MentionPerson; needle: string }): boolean {
  return person.identities.some((identity) => {
    if (identity.email === undefined) {
      return false;
    }
    const normalised = normaliseEmail({ email: identity.email });
    return normalised === needle || normalised.split("@")[0] === needle;
  });
}

/** Whether any of a person's source handles matches the token. */
function matchesHandle({ person, needle }: { person: MentionPerson; needle: string }): boolean {
  return person.identities.some(
    (identity) => identity.handle !== undefined && normaliseHandle({ handle: identity.handle }) === needle,
  );
}

/** The strongest tier at which a token matches this person, or `undefined`. */
function tierFor({ person, needle }: { person: MentionPerson; needle: string }): MentionTier | undefined {
  if (matchesNativeId({ needle, person })) {
    return "native-id";
  }
  if (matchesEmail({ needle, person })) {
    return "email";
  }
  if (matchesHandle({ needle, person })) {
    return "handle";
  }
  const names = person.identities.flatMap((identity) =>
    identity.name !== undefined ? [nameTokens({ name: identity.name })] : [],
  );
  if (names.some((tokens) => tokens.whole === needle)) {
    return "full-name";
  }
  if (names.some((tokens) => tokens.parts[0] === needle)) {
    return "given-name";
  }
  return names.some((tokens) => tokens.parts.includes(needle)) ? "name-part" : undefined;
}

/** Every match at the STRONGEST tier present in a set of matches (weaker tiers are dropped, not ranked). */
function strongestTier({ matches }: { matches: readonly MentionMatch[] }): readonly MentionMatch[] {
  for (const tier of TIER_ORDER) {
    const atTier = matches.filter((match) => match.tier === tier);
    if (atTier.length > 0) {
      return atTier;
    }
  }
  return [];
}

/**
 * Drop deactivated people when a live one matched equally well. A deactivated account cannot be addressed,
 * so keeping it would manufacture an ambiguity out of someone who has left — but when EVERY match is
 * deactivated they are all that is left, and reporting them beats reporting nothing.
 */
function preferActive({ matches }: { matches: readonly MentionMatch[] }): readonly MentionMatch[] {
  const live = matches.filter((match) => match.person.active);
  return live.length > 0 ? live : matches;
}

/**
 * A bot may be named by an exact identifier, never by a name. Asking who a given id is is a legitimate
 * question; "who is <a first name>" must never answer with an integration that happens to carry the string.
 */
function tierAllowsBot({ tier }: { tier: MentionTier }): boolean {
  return tier === "native-id" || tier === "email" || tier === "handle";
}

/**
 * A WORKSPACE BOT of this organisation's own Slack: an app installed in the team, which the member index
 * learned from that team's own `users.list`.
 *
 * It exists because the org check above asks a question a bot cannot answer. `orgStatusOf` places a person
 * by their email domain, and a Slack bot user has no email AT ALL by construction. MEASURED on
 * a real index: thousands of distinct members, hundreds of them bots, and ZERO of those bots carrying an email.
 * Reproduce by piping the member bronze through one filter:
 *
 *     find ~/.slopweaver/corpus/members -name '[*].jsonl' -exec cat {} + | python3 -c "import sys,json;rows=[json.loads(l) for l in sys.stdin];latest={(r['source'],r['identity']['nativeId']):r for r in rows};bots=[r for r in latest.values() if (r.get('profile') or {}).get('bot') is True];print(len(latest),len(bots),sum(1 for b in bots if (b.get('identity') or {}).get('email')))"
 *
 * So every bot fell to `unverified` and was refused, which made {@link tierAllowsBot}'s permission ineffective
 * for the only tier that needed it: `email` can never match a bot, `native-id` is already rescued by the
 * outbound layer's own identity map, and `handle` — `@acmebot`, the thing a human actually types — refused.
 *
 * The evidence is membership, not email: a row the org's own `users.list` returned is inside the org by
 * construction. Read per IDENTITY rather than off the folded `person.bot`, so the exception covers a Slack
 * app and never a bot some other provider happened to name.
 */
function isSlackWorkspaceBot({ person }: { person: MentionPerson }): boolean {
  return person.identities.some((identity) => identity.source === "slack" && identity.bot);
}

/**
 * The matches to answer from: a COLLEAGUE whenever any colleague matched at all, and only otherwise one of
 * this workspace's own Slack bots.
 *
 * The order is the point, and it is the ladder's own rule applied to a new kind of match rather than a new
 * rule: *colleagues are considered first and alone, and an outsider never outranks one.* A bot is not a
 * colleague, so it never competes with one — it is what is left when nothing else matched.
 *
 * Written as an early return on the org set rather than as one filter over both, because that keeps the
 * colleague path BYTE-IDENTICAL to the code before the bot exception existed. Codex's review pass killed the
 * version that did merge them, with two counterexamples this shape cannot express: a live bot sharing a
 * colleague's handle turned a resolved colleague AMBIGUOUS, and a live bot beat a DEACTIVATED colleague whom
 * `preferActive` had deliberately kept as the sole answer. Both regressed a token that already worked, to fix
 * one that never had.
 */
function addressableAtStrongestTier({
  matches,
  conversationMembers,
}: {
  matches: readonly MentionMatch[];
  conversationMembers: ReadonlySet<string> | undefined;
}): readonly MentionMatch[] {
  const org = strongestTier({ matches: matches.filter((match) => match.person.orgStatus === "org") });
  if (org.length > 0) {
    return org;
  }
  return strongestTier({
    matches: matches.filter(
      (match) =>
        (match.person.orgStatus === "unverified" && isSlackWorkspaceBot({ person: match.person })) ||
        inConversationId({ conversationMembers, person: match.person }) !== undefined,
    ),
  });
}

/**
 * The Slack id by which a person is a MEMBER of the conversation the message posts into, or nothing.
 *
 * The second membership exception, and the same kind of evidence as {@link isSlackWorkspaceBot}: email cannot place
 * an outsider (MEASURED: Felix Marsh of Auditco Security, `U0SYN000026`, sits in the three-person DM the
 * owner opened with Felix and Rosa, `C0SYN000028`, with no email on that member row — so even the member's own id refused), but
 * Slack already answered the question that matters for addressing that person. Being in the conversation is exactly who a
 * mention there can reach, so the person the message is addressed TO cannot be refused for being outside the org.
 *
 * It is a fallback, never a rival: an org colleague matching the token still answers alone, so a shared first name
 * resolves to the colleague and the conversation's own gate (`../outbound/slack/dmMembership.ts`) then says whether
 * that colleague is in the DM.
 *
 * @returns the id on the person's Slack identity that is a member, or `undefined` when none is or no set was read
 */
function inConversationId({
  conversationMembers,
  person,
}: {
  conversationMembers: ReadonlySet<string> | undefined;
  person: MentionPerson;
}): string | undefined {
  if (conversationMembers === undefined) {
    return undefined;
  }
  return person.identities.find((identity) => identity.source === "slack" && conversationMembers.has(identity.nativeId))
    ?.nativeId;
}

/**
 * The native id a match carries on one source, when that source named them at all.
 *
 * @returns the id on that source, or `undefined` when the person has no account there
 */
export function nativeIdOn({ match, source }: { match: MentionMatch; source: IdentitySource }): string | undefined {
  return match.person.identities.find((identity) => identity.source === source)?.nativeId;
}

/**
 * Resolve a person token against the member index. Pure — no corpus read, no derive, no network.
 *
 * @param rows every source's member rows, as read off bronze
 * @param orgDomains the org's own email domains ({@link ./orgDomains.resolveOrgDomains})
 * @param token the raw token — a first name, full name, handle (with or without `@`), email or native id
 * @param source the surface being addressed; the resolution must carry an id on it, or it refuses
 *   `no-account` rather than handing back a person who cannot be reached there
 * @param conversationMembers the Slack ids in the conversation the message posts into, when the caller read
 *   them — a member there is addressable whatever their email says ({@link inConversationId})
 * @returns the colleague it names, or the refusal that says why nothing was handed back
 */
export function resolveMention({
  rows,
  orgDomains,
  token,
  source,
  conversationMembers,
}: {
  rows: readonly MemberBronzeRow[];
  orgDomains: readonly string[];
  token: string;
  source: IdentitySource;
  conversationMembers?: ReadonlySet<string> | undefined;
}): MentionLookup {
  return lookupMention({ conversationMembers, people: mentionPeople({ orgDomains, rows }), source, token });
}

/**
 * Resolve a person token against people already folded by {@link mentionPeople} — the inner loop, so a
 * caller resolving several keys folds the member rows once. Pure.
 *
 * @param people the folded, org-classified people
 * @param token the raw token
 * @param source the surface being addressed
 * @param conversationMembers the Slack ids in the conversation the message posts into, when read
 * @returns the colleague it names, or the refusal that says why nothing was handed back
 */
export function lookupMention({
  people,
  token,
  source,
  conversationMembers,
}: {
  people: readonly MentionPerson[];
  token: string;
  source: IdentitySource;
  conversationMembers?: ReadonlySet<string> | undefined;
}): MentionLookup {
  const needle = normaliseHandle({ handle: token });
  if (needle.length === 0) {
    return { kind: "unknown" };
  }
  const matches: MentionMatch[] = [];
  for (const person of people) {
    const tier = tierFor({ needle, person });
    if (tier !== undefined && (!person.bot || tierAllowsBot({ tier }))) {
      matches.push({ person, tier });
    }
  }
  const addressable = addressableAtStrongestTier({ conversationMembers, matches });
  if (addressable.length === 0) {
    return refusalForNonOrg({ matches });
  }
  const survivors = preferActive({ matches: addressable });
  const only = survivors[0]!;
  if (survivors.length > 1) {
    return { kind: "ambiguous", matches: survivors, tier: only.tier };
  }
  const nativeId = addressedId({ conversationMembers, match: only, source });
  return nativeId === undefined
    ? { kind: "no-account", match: only, source }
    : { kind: "resolved", match: only, nativeId };
}

/**
 * The id a resolved match is tagged by. An outsider answered only BECAUSE one of their Slack accounts is in the
 * conversation, so that is the account to tag; a colleague keeps the account the ladder always picked.
 */
function addressedId({
  conversationMembers,
  match,
  source,
}: {
  conversationMembers: ReadonlySet<string> | undefined;
  match: MentionMatch;
  source: IdentitySource;
}): string | undefined {
  if (match.person.orgStatus !== "org") {
    const member = inConversationId({ conversationMembers, person: match.person });
    if (member !== undefined) {
      return member;
    }
  }
  return nativeIdOn({ match, source });
}

/** The refusal for a token no colleague matched: an outsider, someone unplaceable, or nobody at all. */
function refusalForNonOrg({ matches }: { matches: readonly MentionMatch[] }): MentionLookup {
  const external = strongestTier({ matches: matches.filter((match) => match.person.orgStatus === "external") });
  if (external.length > 0) {
    return { kind: "external", matches: external };
  }
  const unverified = strongestTier({ matches: matches.filter((match) => match.person.orgStatus === "unverified") });
  return unverified.length > 0 ? { kind: "unverified", matches: unverified } : { kind: "unknown" };
}

/**
 * Resolve several keys over one fold of the member rows. Pure.
 *
 * @param rows every source's member rows
 * @param orgDomains the org's own email domains
 * @param keys the keys to resolve, in any order
 * @param source the surface being addressed
 * @param conversationMembers the Slack ids in the conversation the message posts into, when read
 * @returns one lookup per DISTINCT key
 */
export function lookupMentions({
  rows,
  orgDomains,
  keys,
  source,
  conversationMembers,
}: {
  rows: readonly MemberBronzeRow[];
  orgDomains: readonly string[];
  keys: readonly string[];
  source: IdentitySource;
  conversationMembers?: ReadonlySet<string> | undefined;
}): ReadonlyMap<string, MentionLookup> {
  const people = mentionPeople({ orgDomains, rows });
  return new Map(
    [...new Set(keys)].map((key) => [key, lookupMention({ conversationMembers, people, source, token: key })]),
  );
}
