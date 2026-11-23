/**
 * Account-kind classification (PR4.8): is this "person" in the people graph actually a **person**, a **bot**,
 * or an **integration**?
 *
 * The dogfood audit found the people directory counting `Slack`, `Datadog`, `githubcopilot` and an
 * `@integration.linear.app` account as teammates. The signals to tell them apart already exist — they were
 * just never applied consistently:
 *
 *  - `profile.bot` on a hydrated member row (Slack sets it from `is_bot`; about a third of a real workspace's members).
 *  - An app/integration email domain on a member row (`*.linear.app` — an OAuth-app or integration account,
 *    never a human's personal address).
 *  - The structural `[bot]` login suffix GitHub gives an App account.
 *  - A small, EXACT set of known bot/integration handles.
 *
 * Three hard rules this module obeys:
 *
 *  1. **Classification only — never a merge.** Identity resolution stays exact-email-join (PR4); nothing here
 *     touches how identities are grouped. It only labels an ALREADY-resolved account, so the
 *     "identity = exact-match only, NEVER fuzzy" rule is untouched.
 *  2. **Exact match, with an ambiguity guard.** The lookup keys are verbatim (case/whitespace-normalised)
 *     native ids, handles and names — no prefixes, no substrings, no similarity. A key claimed by BOTH a bot
 *     and a real member is AMBIGUOUS and dropped from the index, so a real teammate can never be filtered by
 *     a name collision.
 *  3. **Filtered from the DIRECTORY, kept in the corpus.** A bot's records, member row, dossier and
 *     resolved identity all survive and stay queryable (PR4.5 visibility is unchanged); it just isn't
 *     counted as a team member.
 *
 * Pure — no I/O, no clock.
 *
 * The name index is needed because SOME Slack records' `author` is the member's DISPLAY NAME (the same
 * `profile.display_name → real_name → name` string the member row carries) rather than the `U…` native id —
 * so a native-id-only join would not reach `profile.bot` for those. Measured on the dogfood corpus: that is
 * the `file` and `pin` projections (thousands of records), while `message`/`comment` (over a hundred thousand) do carry the native
 * id. The claim used to be written as "a Slack record's author is the display name", flatly — it is the
 * minority case, and the majority path is now repaired by
 * {@link ./personResolver.canonicalPersonIdForAuthor}, so the name index is a backstop rather than the
 * primary route.
 */
import type { MemberBronzeRow } from "../corpus/members/types.js";
import type { Person, PersonIdentity } from "./identity.js";

/**
 * What an account in the people graph IS: a human teammate, a bot, an app/integration, or an EXTERNAL
 * contact — somebody a source knows about who does not work here.
 *
 * `external` was added because its absence made a headline number lie. The derived roster reported most
 * people "single-source" as if it were a coverage failure, when **nearly all the single-source Linear people
 * are `externalUsers`** — customers and contacts who exist in exactly one system because that is the truth
 * about them. Counting them beside colleagues made a correct classification read as a broken one, and sent
 * a reader looking for a linking bug that measurement showed does not exist (zero missed links; every
 * person with an email is already linked).
 *
 * It is a REPORTING distinction and nothing more. Identity resolution is untouched: an external contact
 * resolves exactly as it did, and nothing here links, merges or guesses anything.
 */
type AccountKind = "person" | "bot" | "integration" | "external";

/** A classification plus the exact rule(s) that produced it — surfaced so a filter is never a black box. */
export interface AccountClassification {
  readonly kind: AccountKind;
  /** The rules that fired, sorted; empty for a plain `person` (nothing to explain). */
  readonly reasons: readonly string[];
}

/** A resolved {@link Person} labelled with its account kind — the shape derive persists. */
export interface KindedPerson extends Person {
  readonly kind: AccountKind;
  readonly kindReasons: readonly string[];
}

/**
 * The provenance that marks a member row as an external contact rather than a workspace member.
 *
 * Linear returns `externalUsers` for customers and contacts: no `active`, no `teams`, no `title`, and an
 * empty `email`. Matched EXACTLY against the row's own recorded provenance rather than inferred from a
 * missing field, so a workspace user who simply has no email is never mistaken for a customer.
 */
const EXTERNAL_MEMBER_PROVENANCE = "linear.externalUsers";

/** The structural suffix GitHub gives an App account's login (`dependabot[bot]`) — exact, never fuzzy. */
const BOT_LOGIN_SUFFIX = "[bot]";

/**
 * Email domains that belong to an app/integration, never to a human. `linear.app` and its subdomains cover
 * the `integration.linear.app` / `oauthapp.linear.app` / `linear.linear.app` accounts Linear creates for
 * apps. Matched as an exact domain or an exact dot-suffix — never a substring.
 */
const INTEGRATION_EMAIL_DOMAINS: readonly string[] = ["linear.app"];

/**
 * The known-handle sets are deliberately NARROW: product names that no human uses as a login or display
 * name. The error costs are asymmetric — a false negative (one bot still counted as a teammate) is cheap and
 * visible, while a false positive ERASES a real person from the directory. So a generic single word that a
 * human could plausibly carry (`slack`, `linear`, `github`, `notion`, `incident`, `workflows`, `copilot`, …)
 * is deliberately NOT here, even though app accounts do use those names — the structural rules
 * (`profile.bot`, the `[bot]` suffix, an app email domain) catch those accounts anyway. Measured on the
 * dogfood workspace (over a thousand member rows): the structural rules caught dozens of accounts and these
 * sets added one, so
 * keeping them narrow costs essentially nothing.
 *
 * Exact handles/names of known automation accounts (lower-case, no leading `@`).
 */
const KNOWN_BOT_HANDLES: ReadonlySet<string> = new Set([
  "dependabot",
  "renovate",
  "renovate-bot",
  "github-actions",
  "githubcopilot",
  "slackbot",
  "codecov",
  "sonarcloud",
]);

/** Exact handles/names of known first-party integrations that post like people (lower-case, no leading `@`). */
const KNOWN_INTEGRATION_HANDLES: ReadonlySet<string> = new Set([
  "datadog",
  "pagerduty",
  "statuspage",
  "zapier",
  "google drive",
  "google calendar",
]);

/** Lower-case + trim a lookup key (and strip a leading `@`) — the one normalisation the index uses. Pure. */
function normaliseKey({ value }: { value: string }): string {
  return (value.startsWith("@") ? value.slice(1) : value).trim().toLowerCase();
}

/**
 * Whether an email's domain belongs to an app/integration. Exact domain or exact dot-suffix match. Pure.
 *
 * @param email the email address (any case)
 * @returns true when the domain is an integration domain
 */
export function isIntegrationEmail({ email }: { email: string }): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return false;
  }
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return INTEGRATION_EMAIL_DOMAINS.some((known) => domain === known || domain.endsWith(`.${known}`));
}

/**
 * Whether a native id / handle / login carries the structural `[bot]` suffix. Pure.
 *
 * @param value the raw native id, handle, or login
 * @returns true when it ends with `[bot]`
 */
export function hasBotLoginSuffix({ value }: { value: string }): boolean {
  return normaliseKey({ value }).endsWith(BOT_LOGIN_SUFFIX);
}

/**
 * The classification for one hydrated member row. STRUCTURAL rules first (`profile.bot`, the `[bot]` login
 * suffix, an integration email domain) — those are unambiguous. The known-handle sets are the weakest rule,
 * so they apply ONLY to a row with no TRUSTED personal email: a real teammate always carries one, so a
 * name collision with an app can never reclassify a human.
 *
 * @param row the hydrated member row
 * @returns the classification, plus which rule decided it
 */
export function classifyMemberRow({ row }: { row: MemberBronzeRow }): AccountClassification {
  const reasons: string[] = [];
  // Checked FIRST and returned early: an external contact is not a teammate, and running the bot heuristics
  // over a customer's name would classify some of them `bot` on a coincidence of handle.
  if (row.provenance.includes(EXTERNAL_MEMBER_PROVENANCE)) {
    return { kind: "external", reasons: [`provenance:${EXTERNAL_MEMBER_PROVENANCE}`] };
  }
  const keys = [row.identity.nativeId, row.identity.handle, row.identity.name].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  const namedByHandleSet = row.identity.emailTrust !== "trusted";
  if (row.profile.bot === true) {
    reasons.push("member-profile-bot");
  }
  if (keys.some((value) => hasBotLoginSuffix({ value }))) {
    reasons.push(`login-suffix:${BOT_LOGIN_SUFFIX}`);
  }
  if (namedByHandleSet && keys.some((value) => KNOWN_BOT_HANDLES.has(normaliseKey({ value })))) {
    reasons.push("known-bot-handle");
  }
  if (reasons.length > 0) {
    return { kind: "bot", reasons: reasons.toSorted() };
  }
  const { emailNormalised: email = row.identity.email } = row.identity;
  if (email !== undefined && isIntegrationEmail({ email })) {
    return { kind: "integration", reasons: ["integration-email-domain"] };
  }
  if (namedByHandleSet && keys.some((value) => KNOWN_INTEGRATION_HANDLES.has(normaliseKey({ value })))) {
    return { kind: "integration", reasons: ["known-integration-handle"] };
  }
  return { kind: "person", reasons: [] };
}

/**
 * Build the EXACT lookup index from hydrated member rows: every verbatim native id / handle / name a member
 * carries, normalised, mapped to that member's kind. A key claimed by two DIFFERENT kinds is ambiguous and
 * OMITTED — a real teammate whose display name happens to collide with a bot's is never filtered. Pure.
 *
 * @param rows the hydrated member rows across all sources
 * @returns the unambiguous key → classification index
 */
export function accountKindIndex({
  rows,
}: {
  rows: readonly MemberBronzeRow[];
}): ReadonlyMap<string, AccountClassification> {
  const all = accountKindIndexAll({ rows });
  const index = new Map<string, AccountClassification>();
  for (const [key, classification] of all) {
    if (classification.kind !== "person") {
      index.set(key, classification);
    }
  }
  return index;
}

/**
 * The same index as {@link accountKindIndex}, keeping the `person` entries it drops. Same rows, same keys,
 * same ambiguity guard — the only difference is what survives the last filter.
 *
 * It exists because the two consumers need opposite things from the same evidence. The directory filter
 * asks "should this account be hidden?", so encoding `person` as ABSENCE is exactly right there and
 * {@link classifyAccount} leans on it to default an un-hydrated source's people to `person`. A record-level
 * actor classifier ({@link ./actorKind.classifyActor}) asks the harder question "is there positive evidence
 * a PERSON is behind this?", and absence cannot answer it: an unrecognised author might be a real external
 * contributor or a GitHub App with no member row, and those must not collapse to the same verdict.
 *
 * @param rows the hydrated member rows across all sources
 * @returns the unambiguous key → classification index, `person` entries included
 */
export function accountKindIndexAll({
  rows,
}: {
  rows: readonly MemberBronzeRow[];
}): ReadonlyMap<string, AccountClassification> {
  const claims = new Map<string, AccountClassification[]>();
  for (const row of rows) {
    const classification = classifyMemberRow({ row });
    for (const raw of [row.identity.nativeId, row.identity.handle, row.identity.name, row.identity.emailNormalised]) {
      if (raw === undefined || raw.length === 0) {
        continue;
      }
      const key = normaliseKey({ value: raw });
      // The first row to claim a key opens its list; every later claim joins it.
      if (!claims.has(key)) {
        claims.set(key, []);
      }
      claims.get(key)!.push(classification);
    }
  }
  const index = new Map<string, AccountClassification>();
  for (const [key, list] of claims) {
    const kinds = new Set(list.map((entry) => entry.kind));
    if (kinds.size === 1) {
      index.set(key, list[0]!);
    }
  }
  return index;
}

/** The lookup keys an account offers: its directory/canonical id plus every field of every identity. Pure. */
function accountKeys({ id, identities }: { id: string; identities: readonly PersonIdentity[] }): readonly string[] {
  const keys = [id];
  for (const identity of identities) {
    keys.push(identity.nativeId);
    if (identity.handle !== undefined) {
      keys.push(identity.handle);
    }
    if (identity.name !== undefined) {
      keys.push(identity.name);
    }
    if (identity.email !== undefined) {
      keys.push(identity.email);
    }
  }
  return keys.filter((key) => key.length > 0);
}

/**
 * Classify one account (a resolved person OR a raw, unresolved directory id) against the member-row index.
 * Two rules, both exact: the structural `[bot]` login suffix on any of its keys, then an index hit. Anything
 * unmatched is a `person` — the safe default, so an un-hydrated source never loses real people. Pure.
 *
 * @param id the canonical person id or raw directory id
 * @param identities the per-source identities the account owns (empty for an unresolved raw id)
 * @param index the member-row classification index ({@link accountKindIndex})
 * @returns the classification
 */
export function classifyAccount({
  id,
  identities = [],
  index,
}: {
  id: string;
  identities?: readonly PersonIdentity[];
  index: ReadonlyMap<string, AccountClassification>;
}): AccountClassification {
  const keys = accountKeys({ id, identities });
  if (keys.some((key) => hasBotLoginSuffix({ value: key }))) {
    return { kind: "bot", reasons: [`login-suffix:${BOT_LOGIN_SUFFIX}`] };
  }
  for (const key of keys) {
    const hit = index.get(normaliseKey({ value: key }));
    if (hit !== undefined) {
      return hit;
    }
  }
  return { kind: "person", reasons: [] };
}

/**
 * Label every resolved person with its account kind — the shape derive persists to `identities.json`, so the
 * audit can count bots/integrations exactly instead of guessing from a login suffix. The resolution itself is
 * untouched (same people, same identities, same order): this only ADDS `kind` + `kindReasons`. Pure.
 *
 * @param people the canonical people from the identity resolution
 * @param index the member-row classification index ({@link accountKindIndex})
 * @returns the same people, in the same order, each labelled with its kind
 */
export function withAccountKinds({
  people,
  index,
}: {
  people: readonly Person[];
  index: ReadonlyMap<string, AccountClassification>;
}): readonly KindedPerson[] {
  return people.map((person) => {
    const { kind, reasons } = classifyAccount({ id: person.id, identities: person.identities, index });
    return { ...person, kind, kindReasons: reasons };
  });
}
