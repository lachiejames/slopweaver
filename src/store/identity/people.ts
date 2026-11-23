/**
 * The pure build of the `person` table from the Google Workspace directory and the member pull.
 *
 * ## The order of authority, and why it is an order
 *
 * Owner ruling: identities come from Google Admin, the email is the key, each
 * platform's id is a column. So the directory is read FIRST and every person in it exists before any
 * platform is consulted. A platform member then does one of four things, decided here with no database in
 * the room so every branch is pinned by a unit test over real shapes:
 *
 * 1. **Carries a `trusted` address that Google holds** (primary, alias, or the address an off-boarded
 *    person used before their `term_emp_` rename) — their platform id lands on that person. This is the
 *    whole join, and it is exact: an address is issued by one authority, and two platforms echoing it is a
 *    shared fact rather than a coincidence of spelling.
 * 2. **Carries a `trusted` address Google does not hold** — they still become a person, with `googleId`
 *    null. That is the deliberate widening of "provisioned in Google Admin": staff whose Workspace account
 *    was deleted after they left, contractors on their own domain, Slack guests on gmail. Owner ruling:
 *    nobody who leaves is forgotten, and a person who was never in Google is
 *    still a human whose messages need an author.
 * 3. **Is a bot** — skipped. A bot has no mailbox to key on and is not a person (the owner's read was asked for on
 *    this; the answer is in {@link ../schema/person}'s header and on the content row's `authorNativeId`).
 * 4. **Carries no trusted address and is not a bot** — matched by NAME. One narrow case links
 *    ({@link exactOrgMember}); everything else is recorded as a candidate for someone to review and never
 *    applied, because a wrong auto-link merges two people's history and is invisible afterwards while a
 *    wrong candidate is a row somebody rejects. This is the archive's `pending_entity_links`, kept.
 *
 * ## What cannot come out of this
 *
 * Two people with one email (the map is keyed on it), one platform id on two people (a second claim is a
 * `refused` line, and the schema's unique index would refuse it anyway), an id in the wrong column (the
 * shape check runs here first, so a Slack `B…` id never reaches the Linear column — MEASURED,
 * nine of them had), and a person named by their id (a name comes from Google or a member profile, and a
 * member with neither name nor handle is named by their address).
 */
import type { DirectoryUserRow } from "../../corpus/directory/types.js";
import type { MemberBronzeRow } from "../../corpus/members/types.js";
import { isRecord } from "../../lib/parsers.js";

import { PERSON_ID_SHAPES } from "../schema/person.js";

import { nameSimilarity, normalizeEmail, normalizeName } from "./matching.js";

/**
 * The name similarity at or above which a link is worth a person's attention.
 *
 * Below this nothing is recorded at all, because a candidate list nobody can finish is a candidate list
 * nobody reads. 0.85 admits "Sadie C." for "Sadie Chen" (token overlap 0.67 loses to edit distance) and
 * "Sadi Chen" for "Sadie Chen" (0.9), and refuses two colleagues sharing a first name.
 *
 * @internal
 */
export const REVIEW_CONFIDENCE_FLOOR = 0.85;

/** What made a candidate worth recording, kept so a reviewer sees the evidence and not a score. */
export interface LinkSignal {
  readonly kind: "name_similarity" | "name_exact_org_member" | "same_name_second_mailbox";
  readonly detail: string;
  readonly confidence: number;
}

/** One person as the reconciler will write them — every column but the id and the timestamps. */
export interface PersonDraft {
  readonly email: string;
  readonly displayName: string;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly googleId: string | null;
  readonly active: boolean | null;
  readonly orgUnitPath: string | null;
  readonly title: string | null;
  readonly slackUserId: string | null;
  readonly linearUserId: string | null;
  readonly linearDisplayName: string | null;
  readonly githubId: string | null;
  readonly githubLogin: string | null;
  readonly notionUserId: string | null;
}

/**
 * A member with no trusted address whose name reached a person: `pending` when it resembles one and waits
 * for review, `accepted` when it was the one exact match this build applies (see {@link exactOrgMember}).
 */
export interface NameCandidate {
  /** The person's email — resolved to their id at write time. */
  readonly email: string;
  readonly source: MemberBronzeRow["source"];
  readonly nativeId: string;
  readonly handle: string | null;
  readonly signal: LinkSignal;
  readonly status: "pending" | "accepted";
}

/** Everything one build decided, with the counts a report prints. */
export interface PeopleBuild {
  /** One draft per email, in email order. */
  readonly people: readonly PersonDraft[];
  readonly candidates: readonly NameCandidate[];
  /** Members skipped because their platform flags them as a bot. */
  readonly bots: number;
  /** Non-bot members with no trusted address and no name close enough to anyone. */
  readonly unmatched: number;
  /** Members whose id failed its platform's shape, or whose column another person already holds. */
  readonly refused: readonly string[];
  /** How many people the directory itself supplied, before any platform was read. */
  readonly fromDirectory: number;
}

/** The person column each member source fills, and the shape its id must fit. */
const MEMBER_COLUMN = {
  github: { column: "githubId", shape: PERSON_ID_SHAPES.githubId },
  linear: { column: "linearUserId", shape: PERSON_ID_SHAPES.linearUserId },
  notion: { column: "notionUserId", shape: PERSON_ID_SHAPES.notionUserId },
  slack: { column: "slackUserId", shape: PERSON_ID_SHAPES.slackUserId },
} as const;

/**
 * The person column a member source fills, or `null` for a source no column takes.
 *
 * @param source the member row's source
 * @returns the column and the id shape it is pinned to
 */
function memberColumn({
  source,
}: {
  source: MemberBronzeRow["source"];
}): (typeof MEMBER_COLUMN)[keyof typeof MEMBER_COLUMN] | null {
  if (source === "github" || source === "linear" || source === "notion" || source === "slack") {
    return MEMBER_COLUMN[source];
  }
  return null;
}

/** A draft under construction: the columns, plus every platform's word on whether they are active. */
interface Building {
  draft: PersonDraft;
  readonly platformActive: (boolean | null)[];
}

/**
 * Collapse an append-only member log to one row per person: the last physical row wins.
 *
 * Last-write-wins on FILE ORDER rather than on `fetchedAtIso`, and the difference is load-bearing. The
 * writer appends, so file order is capture order; `fetchedAtIso` is excluded from the dedup fingerprint on
 * purpose, so two rows for one person can carry timestamps that do not order them. File order always does.
 *
 * @param rows every member row read off one or more source files, in the order they were read
 * @returns one row per `(source, sourceId)`, in first-seen order
 */
export function latestMembers({ rows }: { rows: readonly MemberBronzeRow[] }): readonly MemberBronzeRow[] {
  const latest = new Map<string, MemberBronzeRow>();
  for (const row of rows) {
    if (row.sourceId.length > 0) {
      latest.set(`${row.source} ${row.sourceId}`, row);
    }
  }
  return [...latest.values()];
}

/**
 * Order members so that the one a platform still calls active is placed first.
 *
 * A person can hold two accounts on one platform with one address — a re-created Slack account beside the
 * deactivated original, a Linear org member beside the external user an integration minted for the same
 * mailbox. MEASURED on the first live run: 13 such pairs. One column holds one id, so the
 * second claim is refused and reported; this ordering is what makes the refused one the dead account rather
 * than whichever the file happened to list first. Stable, so ties keep file order.
 *
 * @param rows the collapsed member rows
 * @returns the same rows, active first, then unknown, then deactivated
 */
function activeFirst({ rows }: { rows: readonly MemberBronzeRow[] }): readonly MemberBronzeRow[] {
  const rank = ({ row }: { row: MemberBronzeRow }): number => {
    if (row.profile.active === true) {
      return 0;
    }
    if (row.profile.active === false) {
      return 2;
    }
    return 1;
  };
  return rows.toSorted((left, right) => rank({ row: left }) - rank({ row: right }));
}

/**
 * GitHub's immutable account id off a member row, which is not the key bronze uses.
 *
 * MEASURED: GitHub's member rows use the LOGIN as `sourceId`, and a login is mutable. Every
 * GitHub member row on this install carries the numeric account id at `raw.listMember.id`, so that is the
 * id column and the login sits beside it. Reproduce by reading `raw.listMember.id` off each row of
 * `members/github.jsonl`.
 *
 * @param row the member row
 * @returns the numeric id as a string, or `null` when the payload does not carry one
 */
export function githubAccountId({ row }: { row: MemberBronzeRow }): string | null {
  const raw = isRecord(row.raw) ? row.raw : undefined;
  const listMember = isRecord(raw?.["listMember"]) ? raw["listMember"] : undefined;
  const id = listMember?.["id"];
  return typeof id === "number" && Number.isFinite(id) ? String(id) : null;
}

/**
 * The name to show for a member, preferring what a human would recognise and never their id.
 *
 * @param row the member row
 * @returns the profile name, else the handle, else the address
 */
export function memberDisplayName({ row }: { row: MemberBronzeRow }): string {
  const name = row.identity.name;
  if (name !== undefined && name.length > 0) {
    return name;
  }
  const handle = row.identity.handle;
  if (handle !== undefined && handle.length > 0) {
    return handle;
  }
  const normalised = row.identity.emailNormalised;
  if (normalised !== undefined) {
    return normalised;
  }
  const raw = row.identity.email;
  if (raw !== undefined) {
    return raw;
  }
  return row.sourceId;
}

/**
 * A draft carrying nothing but its key and its name, for a person a platform knows and Google does not.
 *
 * @param email the normalised address
 * @param displayName the name to show
 * @returns the empty draft
 */
function emptyDraft({ email, displayName }: { email: string; displayName: string }): PersonDraft {
  return {
    active: null,
    displayName,
    email,
    familyName: null,
    githubId: null,
    githubLogin: null,
    givenName: null,
    googleId: null,
    linearDisplayName: null,
    linearUserId: null,
    notionUserId: null,
    orgUnitPath: null,
    slackUserId: null,
    title: null,
  };
}

/**
 * Fold every platform's word on activity into one value, for a person Google does not hold.
 *
 * Any platform saying active wins, because a deactivation on one platform is that platform's
 * off-boarding and not the person's; all platforms that answered saying inactive is `false`; nobody
 * answering is `null`, which is a different claim from `true`.
 *
 * @param words each platform's `active`, `null` where it said nothing
 * @returns the folded value
 */
export function foldActive({ words }: { words: readonly (boolean | null)[] }): boolean | null {
  const answered = words.filter((word): word is boolean => word !== null);
  if (answered.length === 0) {
    return null;
  }
  return answered.some((word) => word);
}

/**
 * Build the person set. Pure.
 *
 * @param directory every Google Workspace user, as the last pull listed them
 * @param members every member row across every source, as read off the member store
 * @returns the drafts, the candidates and the counts
 */
export function buildPeople({
  directory,
  members,
}: {
  directory: readonly DirectoryUserRow[];
  members: readonly MemberBronzeRow[];
}): PeopleBuild {
  const { building, aliasToEmail, refused: seedRefused } = seedFromDirectory({ directory });
  const fromDirectory = building.size;
  const claimed = new Map<string, string>();
  const refused: string[] = [...seedRefused];
  const candidates: NameCandidate[] = [];

  const addressed = placeAddressedMembers({ aliasToEmail, building, claimed, members });
  refused.push(...addressed.refused);

  // The named pass runs against the people UNDER CONSTRUCTION, never against a snapshot of them: an exact
  // org-member link writes a column, and a build that had already frozen its drafts would report the link
  // and store nothing. MEASURED, which is how that was found — 17 GitHub links silently lost.
  const named = placeNamedMembers({ building, claimed, rows: addressed.named });
  refused.push(...named.refused);
  candidates.push(...named.candidates, ...sameNameElsewhere({ building }));

  const people = [...building.values()]
    .map((entry) => ({
      ...entry.draft,
      active: entry.draft.googleId === null ? foldActive({ words: entry.platformActive }) : entry.draft.active,
    }))
    .toSorted((left, right) => left.email.localeCompare(right.email));

  return { bots: addressed.bots, candidates, fromDirectory, people, refused, unmatched: named.unmatched };
}

/**
 * Every directory user as a draft, and the address map that reaches them.
 *
 * @param directory every Google Workspace user, as the last pull listed them
 * @returns the drafts by email, every address that resolves to one of them, and every user refused as a key
 */
function seedFromDirectory({ directory }: { directory: readonly DirectoryUserRow[] }): {
  readonly building: Map<string, Building>;
  readonly aliasToEmail: Map<string, string>;
  readonly refused: readonly string[];
} {
  const building = new Map<string, Building>();
  const aliasToEmail = new Map<string, string>();
  const refused: string[] = [];
  for (const [used, directoryEmail] of terminatedAliases({ directory })) {
    aliasToEmail.set(used, directoryEmail);
  }
  for (const user of directory) {
    const email = user.emailNormalised;
    if (!isKeyableAddress({ email })) {
      refused.push(`directory ${user.googleId}: "${email}" is not a shape the person key accepts`);
      continue;
    }
    aliasToEmail.set(email, email);
    for (const alias of user.aliases) {
      aliasToEmail.set(alias, email);
    }
    // The column is nullable and the directory field is absent when Google holds nothing, so the
    // substitution is written as a destructured default rather than coalesced at the property.
    const { familyName = null, givenName = null, orgUnitPath = null, title = null } = user;
    building.set(email, {
      draft: {
        ...emptyDraft({ displayName: user.fullName, email }),
        active: !user.suspended && !user.archived,
        familyName,
        givenName,
        googleId: user.googleId,
        orgUnitPath,
        title,
      },
      platformActive: [],
    });
  }
  return { aliasToEmail, building, refused };
}

/**
 * Place every member whose trusted address reaches a person, creating one where Google holds nobody.
 *
 * @param members every member row across every source
 * @param building the people under construction, extended in place
 * @param aliasToEmail every address that resolves to a person, extended in place
 * @param claimed the platform ids placed so far, extended in place
 * @returns the bots skipped, the members left for the name pass, and every refusal
 */
function placeAddressedMembers({
  members,
  building,
  aliasToEmail,
  claimed,
}: {
  members: readonly MemberBronzeRow[];
  building: Map<string, Building>;
  aliasToEmail: Map<string, string>;
  claimed: Map<string, string>;
}): { readonly bots: number; readonly named: readonly MemberBronzeRow[]; readonly refused: readonly string[] } {
  const refused: string[] = [];
  const named: MemberBronzeRow[] = [];
  let bots = 0;
  for (const row of activeFirst({ rows: latestMembers({ rows: members }) })) {
    if (row.profile.bot === true) {
      bots += 1;
      continue;
    }
    const email = personKeyFor({ aliasToEmail, row });
    if (email === null) {
      named.push(row);
      continue;
    }
    if (!isKeyableAddress({ email })) {
      refused.push(`${row.source} ${row.sourceId}: "${email}" is not a shape the person key accepts`);
      continue;
    }
    const placed = placeMember({ claimed, entry: entryFor({ aliasToEmail, building, email, row }), row });
    if (placed !== null) {
      refused.push(placed);
    }
  }
  return { bots, named, refused };
}

/**
 * The person key a member's own address reaches, or `null` when they have none the key can use.
 *
 * @param row the member row
 * @param aliasToEmail every address that resolves to a person
 * @returns the key, or `null` for a member the name pass has to decide
 */
function personKeyFor({
  row,
  aliasToEmail,
}: {
  row: MemberBronzeRow;
  aliasToEmail: ReadonlyMap<string, string>;
}): string | null {
  const address = row.identity.emailTrust === "trusted" ? row.identity.emailNormalised : undefined;
  if (address === undefined || address.length === 0 || isPlaceholderAddress({ email: address })) {
    return null;
  }
  const key = normalizeEmail({ email: address });
  const mapped = aliasToEmail.get(key);
  if (mapped === undefined) {
    return key;
  }
  return mapped;
}

/**
 * The person under construction for one key, created from the member's own profile when nobody holds it.
 *
 * @param email the person key
 * @param row the member whose profile names a person Google does not hold
 * @param building the people under construction, extended in place
 * @param aliasToEmail every address that resolves to a person, extended in place
 * @returns the entry to place this member on
 */
function entryFor({
  email,
  row,
  building,
  aliasToEmail,
}: {
  email: string;
  row: MemberBronzeRow;
  building: Map<string, Building>;
  aliasToEmail: Map<string, string>;
}): Building {
  const held = building.get(email);
  if (held !== undefined) {
    return held;
  }
  const fresh: Building = { draft: emptyDraft({ displayName: memberDisplayName({ row }), email }), platformActive: [] };
  building.set(email, fresh);
  aliasToEmail.set(email, email);
  return fresh;
}

/**
 * Decide what every member with no usable address is: an exact org-member link, a candidate, or nothing.
 *
 * @param rows the members the address pass left
 * @param building the people under construction, extended in place
 * @param claimed the platform ids placed so far, extended in place
 * @returns the candidates, the refusals, and how many members reached nobody at all
 */
function placeNamedMembers({
  rows,
  building,
  claimed,
}: {
  rows: readonly MemberBronzeRow[];
  building: Map<string, Building>;
  claimed: Map<string, string>;
}): {
  readonly candidates: readonly NameCandidate[];
  readonly refused: readonly string[];
  readonly unmatched: number;
} {
  const byName = peopleByName({ building });
  const candidates: NameCandidate[] = [];
  const refused: string[] = [];
  let unmatched = 0;
  for (const row of rows) {
    const exact = exactOrgMember({ byName, row });
    if (exact !== null) {
      const placed = placeMember({ claimed, entry: exact.entry, row });
      if (placed === null) {
        candidates.push(exact.candidate);
        continue;
      }
      refused.push(placed);
    }
    const found = candidatesByName({ building, row });
    if (found.length === 0) {
      unmatched += 1;
    }
    candidates.push(...found);
  }
  return { candidates, refused, unmatched };
}

/**
 * Put one member's platform id on the person their address reached.
 *
 * @param entry the person under construction
 * @param row the member row
 * @param claimed every `(source, id)` already placed this build, and the email that holds it
 * @returns the refusal line, or `null` when the id was placed or was already there
 */
function placeMember({
  entry,
  row,
  claimed,
}: {
  entry: Building;
  row: MemberBronzeRow;
  claimed: Map<string, string>;
}): string | null {
  const source = row.source;
  const target = memberColumn({ source });
  if (target === null) {
    return `${source} ${row.sourceId}: no person column takes ${source} ids`;
  }
  const { column, shape } = target;
  const nativeId = source === "github" ? githubAccountId({ row }) : row.sourceId;
  if (nativeId === null) {
    return `github ${row.sourceId}: the member payload carries no account id`;
  }
  if (!new RegExp(shape).test(nativeId)) {
    return `${source} ${nativeId}: not the shape of a ${source} member id, so it cannot be a person's`;
  }
  const holder = claimed.get(`${source} ${nativeId}`);
  if (holder !== undefined && holder !== entry.draft.email) {
    return `${source} ${nativeId}: already on ${holder}, so ${entry.draft.email} cannot carry it too`;
  }
  const held = entry.draft[column];
  if (held !== null && held !== nativeId) {
    return `${source} ${nativeId}: ${entry.draft.email} already carries ${source} ${held}`;
  }
  claimed.set(`${source} ${nativeId}`, entry.draft.email);
  // `active` is three-valued and a platform that said nothing is a different claim from one that said
  // false, so the absent case is named here rather than coalesced.
  const { active = null } = row.profile;
  entry.platformActive.push(active);
  entry.draft = { ...entry.draft, [column]: nativeId };
  if (source === "github" && new RegExp(PERSON_ID_SHAPES.githubLogin).test(row.sourceId)) {
    entry.draft = { ...entry.draft, githubLogin: row.sourceId };
  }
  const handle = linearHandle({ row });
  if (handle !== null && entry.draft.linearDisplayName === null) {
    entry.draft = { ...entry.draft, linearDisplayName: handle };
  }
  return null;
}

/**
 * Every person whose display name is close enough to a member's to be worth someone's attention.
 *
 * @param building the people under construction
 * @param row the member with no trusted address
 * @returns the candidates, empty when nothing reaches {@link REVIEW_CONFIDENCE_FLOOR}
 */
function candidatesByName({
  building,
  row,
}: {
  building: ReadonlyMap<string, Building>;
  row: MemberBronzeRow;
}): readonly NameCandidate[] {
  const incomingName = memberDisplayName({ row });
  // A candidate's handle column is nullable, and a member whose platform issues no handle is the absent
  // case rather than a value to invent — named here so the substitution is written down once.
  const { handle: handleOrNull = null } = row.identity;
  const found: NameCandidate[] = [];
  for (const entry of building.values()) {
    const person = entry.draft;
    const score = nameSimilarity({ left: incomingName, right: person.displayName });
    if (score >= REVIEW_CONFIDENCE_FLOOR) {
      found.push({
        email: person.email,
        handle: handleOrNull,
        nativeId: row.sourceId,
        signal: {
          confidence: score,
          detail: `"${incomingName}" resembles "${person.displayName}"`,
          kind: "name_similarity",
        },
        source: row.source,
        status: "pending",
      });
    }
  }
  return found;
}

/**
 * Whether an address can be a person's key at all — the same shape `person_email_shape` enforces.
 *
 * ## Why a pure check here rather than letting the database refuse it
 *
 * The reconcile is ONE transaction, all-or-nothing, so a single address the CHECK rejects does not skip one
 * person — it aborts the whole run and leaves the store on yesterday's people, with a driver error naming a
 * constraint rather than a member. Nothing upstream guarantees the shape: a member's address is whatever its
 * platform returned, `normalizeEmail` lowercases and strips plus-addressing but never validates, and
 * `emailTrust: "trusted"` means "unique to this member", not "well-formed".
 *
 * Exactly one `@` and no whitespace, which is what the column's own CHECK spells. Deliberately no stricter:
 * this is a gate against a value the database will refuse, never an opinion about what an address may be.
 *
 * @param email the normalised address
 * @returns whether it can key a person
 */
export function isKeyableAddress({ email }: { email: string }): boolean {
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && at < email.length - 1 && !/\s/.test(email);
}

/** The local part Slack rewrites a deactivated member's address to, before its digits. */
const PLACEHOLDER_LOCAL = "deactivateduser";

/** The prefix off-boarding puts on a leaver's primary address. */
export const TERMINATED_PREFIX = "term_emp_";

/**
 * Whether an address is a platform's placeholder rather than a mailbox.
 *
 * Slack rewrites a deactivated member's address to `deactivateduser<n>-<workspace>@slack-corp.com`. The
 * member pull rates it `trusted` because it is unique to that member, and it IS unique — to nobody.
 * MEASURED on the first live run: 14 people keyed on one, every one named "deactivateduser".
 *
 * @param email the normalised address
 * @returns whether it is a placeholder no human reads
 */
export function isPlaceholderAddress({ email }: { email: string }): boolean {
  const at = email.indexOf("@");
  // Two cheap checks rather than one pattern: `\d+[^@]*` is two adjacent quantifiers over overlapping
  // sets, which is the polynomial-backtracking shape the `redos-check` gate refuses, and this is a
  // caller-controlled string.
  return (
    email.slice(at + 1) === "slack-corp.com" &&
    email.startsWith(PLACEHOLDER_LOCAL) &&
    /^[0-9]$/.test(email.charAt(PLACEHOLDER_LOCAL.length))
  );
}

/**
 * The address an off-boarded person USED, mapped to the one the directory now holds them under.
 *
 * Off-boarding renames a leaver's primary address to `term_emp_<local>@<domain>`, and every platform they
 * were on still knows them by the plain `<local>@<domain>` their Slack or Linear account was created
 * with. MEASURED: 38 such directory rows, and without this fold every one of them is TWO
 * `person` rows with the same display name — the duplicate-human defect this whole shape exists to make
 * impossible, wearing the one disguise the email key cannot see through on its own.
 *
 * The stripped address is claimed only when the directory does not hold it under someone else, which is
 * the case where it was re-issued to a different person.
 *
 * @param directory every directory user
 * @returns the used address → the directory address
 */
export function terminatedAliases({
  directory,
}: {
  directory: readonly DirectoryUserRow[];
}): ReadonlyMap<string, string> {
  const held = new Set(directory.map((user) => user.emailNormalised));
  const folded = new Map<string, string>();
  for (const user of directory) {
    // A prefix strip and an `@` test rather than `^term_emp_(.+@.+)$`, whose two `.+` around one literal
    // is the polynomial-backtracking shape `redos-check` refuses.
    const used = user.emailNormalised.startsWith(TERMINATED_PREFIX)
      ? user.emailNormalised.slice(TERMINATED_PREFIX.length)
      : "";
    if (used.includes("@") && !held.has(used)) {
      folded.set(used, user.emailNormalised);
    }
  }
  return folded;
}

/**
 * Every person under construction, keyed by their normalised display name — `null` where two share one.
 *
 * @param building the people so far
 * @returns the index, ambiguous names mapped to `null`
 */
function peopleByName({ building }: { building: ReadonlyMap<string, Building> }): ReadonlyMap<string, Building | null> {
  const byName = new Map<string, Building | null>();
  for (const entry of building.values()) {
    const name = normalizeName({ name: entry.draft.displayName });
    if (name.length === 0) {
      continue;
    }
    byName.set(name, byName.has(name) ? null : entry);
  }
  return byName;
}

/**
 * The one exact match a GitHub org member's profile name has among the people, or `null`.
 *
 * ## The one place a name is allowed to link, and why it is this narrow
 *
 * The rule everywhere else is that a name is a candidate and never a link. This is the deliberate
 * exception, and its three conditions are the argument: the account is a MEMBER of the organisation (the
 * member pull lists org members and nothing else), its profile name is the FULL name and matches EXACTLY
 * after normalisation, and that name is UNIQUE across the whole directory. MEASURED: GitHub
 * exposes a public address for 7 of 55 org members, so without this 48 logins — and 52,954 of 57,028
 * GitHub rows — resolve to nobody, and 23 of those members carry a profile name. The link is recorded as an
 * ACCEPTED candidate with its signal, so it is auditable and re-derived on every run rather than hidden.
 *
 * @param byName every person by normalised display name, ambiguous names as `null`
 * @param row the member with no trusted address
 * @returns the person and the candidate row to record, or `null` when nothing is exact and unique
 */
function exactOrgMember({
  byName,
  row,
}: {
  byName: ReadonlyMap<string, Building | null>;
  row: MemberBronzeRow;
}): { readonly entry: Building; readonly candidate: NameCandidate } | null {
  if (row.source !== "github") {
    return null;
  }
  const raw = isRecord(row.raw) ? row.raw : undefined;
  const profile = isRecord(raw?.["profile"]) ? raw["profile"] : undefined;
  const profileName = profile?.["name"];
  if (typeof profileName !== "string" || profileName.trim().length === 0) {
    return null;
  }
  const name = normalizeName({ name: profileName });
  if (!name.includes(" ")) {
    return null;
  }
  const entry = byName.get(name);
  if (entry === undefined || entry === null) {
    return null;
  }
  // Nullable column, absent field: named rather than coalesced at the property.
  const { handle: handleOrNull = null } = row.identity;
  return {
    candidate: {
      email: entry.draft.email,
      handle: handleOrNull,
      nativeId: row.sourceId,
      signal: {
        confidence: 1,
        detail: `"${profileName}" is an org member whose full name is exactly "${entry.draft.displayName}", unique in the directory`,
        kind: "name_exact_org_member",
      },
      source: "github",
      status: "accepted",
    },
    entry,
  };
}

/**
 * Linear's @-handle off an ORG member's row, or `null` for an external user or an empty handle.
 *
 * Org membership is read off `profile.active` being present at all: the connector omits the field for the
 * external users Linear mints for a Slack- or GitHub-synced commenter, whose handle can echo a member's.
 * MEASURED: 865 members carry a handle and 79 handles appear on more than one of them, while
 * the 189 org members' handles are all distinct.
 *
 * @param row the member row
 * @returns the handle when it is an org member's and fits the column's shape
 */
function linearHandle({ row }: { row: MemberBronzeRow }): string | null {
  if (row.source !== "linear" || row.profile.active === undefined) {
    return null;
  }
  const raw = isRecord(row.raw) ? row.raw : undefined;
  const handle = raw?.["displayName"];
  if (typeof handle !== "string" || !new RegExp(PERSON_ID_SHAPES.linearDisplayName).test(handle)) {
    return null;
  }
  return handle;
}

/**
 * A candidate for every pair of people carrying the same display name.
 *
 * ## Why this is recorded rather than merged
 *
 * Every remaining pair is two real mailboxes: a colleague's personal gmail beside their work address, a
 * staff member's second Workspace account on the NZ domain, a contractor's `.ctr` account beside their
 * staff one. Each is a unique key issued by an authority, so each is correctly its own `person` — but the
 * RESULT still looks like the duplicate-human defect, and only the owner can say which pairs are one human.
 * MEASURED on the live store: 55 names on two or more rows after the folds above, every one of
 * them two accounts Google itself provisioned separately.
 *
 * So the duplicate is made VISIBLE instead of guessed at. A Slack display name is not
 * a reliable source, because many people set their display name to something completely different, and a
 * wrong merge of two mailboxes is invisible afterwards, while a candidate is a row somebody answers.
 *
 * @param building every person under construction
 * @returns one pending candidate per extra person sharing a name, pointed at the first by address order
 */
function sameNameElsewhere({ building }: { building: ReadonlyMap<string, Building> }): readonly NameCandidate[] {
  const byName = new Map<string, PersonDraft[]>();
  for (const entry of building.values()) {
    const name = normalizeName({ name: entry.draft.displayName });
    if (name.length === 0) {
      continue;
    }
    const held = byName.get(name);
    if (held === undefined) {
      byName.set(name, [entry.draft]);
    } else {
      byName.set(name, [...held, entry.draft]);
    }
  }
  const found: NameCandidate[] = [];
  for (const drafts of byName.values()) {
    const [first, ...rest] = drafts.toSorted((left, right) => left.email.localeCompare(right.email));
    if (first === undefined) {
      continue;
    }
    for (const other of rest) {
      found.push({
        email: first.email,
        handle: null,
        nativeId: other.email,
        signal: {
          confidence: 1,
          detail: `${other.email} and ${first.email} carry the same name — one human under two mailboxes, or two people`,
          kind: "same_name_second_mailbox",
        },
        source: "self",
        status: "pending",
      });
    }
  }
  return found;
}
