/**
 * The two pure halves of resolving a person on their Google directory id as well as their email.
 *
 * ## Why the email alone is not a key the reconciler can upsert on
 *
 * `person` carries two unique keys a directory draft can meet: `uq_person_email` and `uq_person_google_id`.
 * The upsert targets the email, so a person whose primary address CHANGED in Google Workspace arrives as a
 * draft with a new email and the same, immutable google id: the insert meets no email conflict, tries a new
 * row, and the google id index refuses it — sinking the whole run, because the run is one transaction.
 *
 * ## Why the row is renamed, never re-keyed by moving the id
 *
 * The row's uuid is the identity everything else hangs off: `content.author_id`, the link candidates, the
 * owner profile and the curated per-person column all point at it. So the row Google identifies is RENAMED
 * in place to the new address, and the email upsert that follows meets it as an ordinary email conflict.
 * Moving the google id onto whichever row already holds the new address instead would hand one human's uuid
 * — and everything attached to it — to another, and on a two-person swap would exchange them outright.
 *
 * A destination address held by a row that is NOT itself being renamed away is two rows for one human, and
 * which of them survives is a merge nobody has specified, so it is a {@link PersonCollision} the run reports
 * by name before writing anything, never a guess. So is an OLD address a member draft with no google id
 * still claims: the rename would vacate it and the upsert would mint a second row there for the same human.
 *
 * {@link personCollisionOf} names the person when a unique index refuses a write anyway, so a failed run says
 * WHO rather than only which index.
 */
import type { PersonDraft } from "./people.js";

/** A stored person row as far as the google-id rekey reads it. */
export interface HeldPerson {
  readonly id: string;
  readonly email: string;
  readonly googleId: string | null;
}

/**
 * One stored row renamed in place to the address its google id now carries.
 *
 * Through a temporary address first, because `uq_person_email` is checked per statement: a swap or a chain
 * of renames cannot be ordered so that no intermediate state holds one address twice, while staging every
 * row out of the way and then into place always can.
 */
export interface PersonRekey {
  readonly personId: string;
  readonly googleId: string;
  readonly fromEmail: string;
  readonly temporaryEmail: string;
  readonly toEmail: string;
}

/** A person a `person` unique index would refuse — or did — named: the index, the value, the drafts carrying it. */
export interface PersonCollision {
  readonly constraint: string;
  readonly column: string;
  readonly value: string;
  /** The emails of this run's drafts carrying the value, sorted. */
  readonly emails: readonly string[];
  /** Why it collided, in a sentence, when the plan rather than the database found it. */
  readonly why?: string;
}

/** What the reconciler does to stored rows before the email upsert, or why it must not write at all. */
export interface GoogleIdRekeyPlan {
  readonly rekeys: readonly PersonRekey[];
  /** Non-empty means the run writes nothing and reports these. */
  readonly collisions: readonly PersonCollision[];
}

/** The domain every scratch address sits under, reserved for the rename: no draft may ever carry it. */
const REKEY_DOMAIN = "identity-rekey.invalid";

/**
 * The scratch address a renamed row passes through, deterministic so the read can check nobody holds it.
 *
 * `.invalid` is reserved (RFC 2606), so no real mailbox can ever be this address.
 *
 * @param googleId the directory id of the row being renamed
 * @returns an address the `person_email_shape` check accepts
 */
export function rekeyTemporaryEmail({ googleId }: { googleId: string }): string {
  return `rekey-${googleId}@${REKEY_DOMAIN}`;
}

/**
 * Sorted, distinct emails, so a report reads the same on every run.
 *
 * @param emails the addresses, in any order
 * @returns them sorted with duplicates removed
 */
function sortedEmails({ emails }: { emails: readonly string[] }): readonly string[] {
  return [...new Set(emails)].toSorted();
}

/**
 * Two drafts carrying one google id, which no rename can make storable.
 *
 * @param people every draft this run will upsert
 * @returns one collision per shared google id, and the ids it covers
 */
function duplicateGoogleIds({ people }: { people: readonly PersonDraft[] }): {
  collisions: readonly PersonCollision[];
  shared: ReadonlySet<string>;
} {
  const emailsByGoogleId = new Map<string, string[]>();
  for (const draft of people) {
    if (draft.googleId === null) {
      continue;
    }
    const emails = emailsByGoogleId.get(draft.googleId);
    if (emails === undefined) {
      emailsByGoogleId.set(draft.googleId, [draft.email]);
      continue;
    }
    emails.push(draft.email);
  }
  const collisions: PersonCollision[] = [];
  const shared = new Set<string>();
  for (const [googleId, emails] of emailsByGoogleId) {
    if (emails.length < 2) {
      continue;
    }
    shared.add(googleId);
    collisions.push({
      column: "google_id",
      constraint: "uq_person_google_id",
      emails: sortedEmails({ emails }),
      value: googleId,
      why: "two directory drafts carry one google id",
    });
  }
  return { collisions, shared };
}

/** The stored rows a plan reads, indexed by each key a draft can meet them on. */
interface HeldIndex {
  readonly byGoogleId: ReadonlyMap<string, HeldPerson>;
  readonly byEmail: ReadonlyMap<string, HeldPerson>;
}

/**
 * Index the stored rows by email and, where they carry one, by google id.
 *
 * @param held every stored row the reconciler read and locked
 * @returns the two lookups the planner meets a draft on
 */
function indexHeld({ held }: { held: readonly HeldPerson[] }): HeldIndex {
  const byGoogleId = new Map<string, HeldPerson>();
  const byEmail = new Map<string, HeldPerson>();
  for (const row of held) {
    byEmail.set(row.email, row);
    if (row.googleId !== null) {
      byGoogleId.set(row.googleId, row);
    }
  }
  return { byEmail, byGoogleId };
}

/**
 * The drafts sorted by email, so a plan and its report read the same on every run.
 *
 * @param people every draft this run will upsert
 * @returns a sorted copy
 */
function draftsByEmail({ people }: { people: readonly PersonDraft[] }): readonly PersonDraft[] {
  return people.toSorted((a, b) => a.email.localeCompare(b.email));
}

/**
 * The renames: every stored row holding a draft's google id under a different email follows that draft.
 *
 * @param people every draft this run will upsert
 * @param index the stored rows, indexed
 * @param shared google ids two drafts carry, which no rename can make storable
 * @returns one rename per row that moves
 */
function renamesFor({
  people,
  index,
  shared,
}: {
  people: readonly PersonDraft[];
  index: HeldIndex;
  shared: ReadonlySet<string>;
}): readonly PersonRekey[] {
  const rekeys: PersonRekey[] = [];
  for (const draft of draftsByEmail({ people })) {
    if (draft.googleId === null || shared.has(draft.googleId)) {
      continue;
    }
    const holder = index.byGoogleId.get(draft.googleId);
    if (holder === undefined || holder.email === draft.email) {
      continue;
    }
    rekeys.push({
      fromEmail: holder.email,
      googleId: draft.googleId,
      personId: holder.id,
      temporaryEmail: rekeyTemporaryEmail({ googleId: draft.googleId }),
      toEmail: draft.email,
    });
  }
  return rekeys;
}

/** An email collision the plan found, before any write. */
function emailCollision({
  emails,
  value,
  why,
}: {
  emails: readonly string[];
  value: string;
  why: string;
}): PersonCollision {
  return { column: "email", constraint: "uq_person_email", emails, value, why };
}

/**
 * The collision one draft's own address makes, if any: a reserved scratch address, or one Google REISSUED.
 *
 * A reissued address is one whose stored row belongs to ANOTHER google id that is not moving, so the email
 * upsert would overwrite that id and hand the row to a different human. A rename's own destination is
 * checked by {@link renameCollisions} instead, so it is skipped here rather than reported twice.
 *
 * @param draft the draft whose address is checked
 * @param index the stored rows, indexed
 * @param moving the ids of every row this plan renames
 * @param renamedTo every address a rename of this plan moves a row onto
 * @returns the collision, or `undefined` when the address is safe to upsert
 */
function draftAddressCollision({
  draft,
  index,
  moving,
  renamedTo,
}: {
  draft: PersonDraft;
  index: HeldIndex;
  moving: ReadonlySet<string>;
  renamedTo: ReadonlySet<string>;
}): PersonCollision | undefined {
  if (draft.email.endsWith(`@${REKEY_DOMAIN}`)) {
    // Reserved for EVERY draft, not only one whose address a rename of this run uses: a concurrent run's
    // rename may be about to pass through it, and its row lock cannot hold an address nobody holds yet.
    return emailCollision({
      emails: [draft.email],
      value: draft.email,
      why: `${draft.email} sits in the reserved ${REKEY_DOMAIN} namespace a rename passes through, never a person's address`,
    });
  }
  const occupant = index.byEmail.get(draft.email);
  // `== null` covers both an address nobody holds (undefined) and a holder with no google id (null).
  if (draft.googleId === null || occupant?.googleId == null || renamedTo.has(draft.email)) {
    return undefined;
  }
  const reissued = occupant.googleId !== draft.googleId && !moving.has(occupant.id);
  if (!reissued) {
    return undefined;
  }
  return emailCollision({
    emails: [draft.email],
    value: draft.email,
    why: `Google now issues ${draft.email} to google id ${draft.googleId}, but the person row holding it belongs to google id ${occupant.googleId} — the email upsert would hand that person's history to someone else`,
  });
}

/**
 * The collisions one rename makes: an old address a google-less draft still claims, a destination a row
 * that stays put holds, or a scratch address already held.
 *
 * A member draft with no google id still claiming the address a rename vacates means the upsert would mint a
 * second row there for what is almost certainly the same human. A draft there WITH a google id is a new
 * holder Google reissued the address to, and inserting it is right.
 *
 * @param rekey the rename being checked
 * @param index the stored rows, indexed
 * @param moving the ids of every row this plan renames
 * @param googlelessEmails every address a draft with no google id carries
 * @returns every collision the rename makes, possibly none
 */
function renameCollisions({
  rekey,
  index,
  moving,
  googlelessEmails,
}: {
  rekey: PersonRekey;
  index: HeldIndex;
  moving: ReadonlySet<string>;
  googlelessEmails: ReadonlySet<string>;
}): readonly PersonCollision[] {
  const collisions: PersonCollision[] = [];
  if (googlelessEmails.has(rekey.fromEmail)) {
    collisions.push(
      emailCollision({
        emails: [rekey.fromEmail],
        value: rekey.fromEmail,
        why: `google id ${rekey.googleId} moved from ${rekey.fromEmail} to ${rekey.toEmail}, but a member draft with no google id still claims ${rekey.fromEmail} — renaming would split one person into two rows`,
      }),
    );
  }
  const destination = index.byEmail.get(rekey.toEmail);
  const destinationStays =
    destination !== undefined && destination.id !== rekey.personId && !moving.has(destination.id);
  if (destinationStays) {
    collisions.push(
      emailCollision({
        emails: [rekey.toEmail],
        value: rekey.toEmail,
        why: `google id ${rekey.googleId} moved from ${rekey.fromEmail} to ${rekey.toEmail}, which another person row already holds — merging the two is not something the reconciler decides`,
      }),
    );
  }
  if (index.byEmail.has(rekey.temporaryEmail)) {
    collisions.push(
      emailCollision({
        emails: [rekey.toEmail],
        value: rekey.temporaryEmail,
        why: `the scratch address renaming ${rekey.fromEmail} passes through is already held by a person row`,
      }),
    );
  }
  return collisions;
}

/**
 * Decide, for every draft whose google id a stored row holds under a different email, how that row follows.
 *
 * Every such row is renamed in place, through {@link rekeyTemporaryEmail}. The new address may be held only
 * by the row itself or by another row this same plan is renaming away — a swap or a chain, which staging
 * makes safe. Held by any row that stays put, or a scratch address held at all, it is a collision. So is a
 * draft whose address Google has REISSUED: its row belongs to a different google id that is not moving, and
 * upserting on the email would quietly hand that person's row, and history, to the new holder.
 *
 * @param people every draft this run will upsert
 * @param held every stored row holding any draft's google id, any draft's email, or any scratch address
 * @returns the renames to apply, and the collisions that forbid applying any of them
 */
export function planGoogleIdRekeys({
  people,
  held,
}: {
  people: readonly PersonDraft[];
  held: readonly HeldPerson[];
}): GoogleIdRekeyPlan {
  const duplicates = duplicateGoogleIds({ people });
  const index = indexHeld({ held });
  const rekeys = renamesFor({ index, people, shared: duplicates.shared });
  const moving = new Set(rekeys.map((rekey) => rekey.personId));
  const renamedTo = new Set(rekeys.map((rekey) => rekey.toEmail));
  const googlelessEmails = new Set(people.flatMap((draft) => (draft.googleId === null ? [draft.email] : [])));
  const addressCollisions = draftsByEmail({ people }).flatMap((draft) => {
    const collision = draftAddressCollision({ draft, index, moving, renamedTo });
    return collision === undefined ? [] : [collision];
  });
  const rekeyCollisions = rekeys.flatMap((rekey) => renameCollisions({ googlelessEmails, index, moving, rekey }));
  return { collisions: [...duplicates.collisions, ...addressCollisions, ...rekeyCollisions], rekeys };
}

/** Each `person` unique index: the column Postgres names in its detail line, and the draft field holding it. */
const UNIQUE_INDEX_FIELDS: Readonly<Record<string, { column: string; field: keyof PersonDraft }>> = {
  uq_person_email: { column: "email", field: "email" },
  uq_person_github_id: { column: "github_id", field: "githubId" },
  uq_person_github_login: { column: "github_login", field: "githubLogin" },
  uq_person_google_id: { column: "google_id", field: "googleId" },
  uq_person_linear_display_name: { column: "linear_display_name", field: "linearDisplayName" },
  uq_person_linear_user_id: { column: "linear_user_id", field: "linearUserId" },
  uq_person_notion_user_id: { column: "notion_user_id", field: "notionUserId" },
  uq_person_slack_user_id: { column: "slack_user_id", field: "slackUserId" },
};

/** Postgres's `unique_violation` SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/** The fields a unique violation carries, as the driver names them. */
interface ViolationFields {
  readonly code: string;
  readonly constraint: string | undefined;
  readonly detail: string | undefined;
}

/**
 * One string-valued field off an error object, or `undefined` when it is absent or not a string.
 *
 * @param link the error object read
 * @param key the property name the driver uses
 * @returns the field's string value
 */
function stringField({ link, key }: { link: object; key: string }): string | undefined {
  const value: unknown = Reflect.get(link, key);
  return typeof value === "string" ? value : undefined;
}

/**
 * The unique-violation fields off the first error in the cause chain that carries a SQLSTATE.
 *
 * Drizzle wraps the driver's error and `postgres.js`'s `PostgresError` is the `cause` underneath. Read
 * structurally rather than by `instanceof`, and with a visited set, because a cause chain is whatever the
 * thrower built and can loop.
 *
 * @param cause whatever the transaction threw
 * @returns the SQLSTATE, constraint and detail, or `undefined` when no link in the chain carries a code
 */
function violationFields({ cause }: { cause: unknown }): ViolationFields | undefined {
  const seen = new Set<object>();
  let link: unknown = cause;
  while (typeof link === "object" && link !== null && !seen.has(link)) {
    seen.add(link);
    const code = stringField({ key: "code", link });
    if (code !== undefined) {
      return {
        code,
        constraint: stringField({ key: "constraint_name", link }),
        detail: stringField({ key: "detail", link }),
      };
    }
    link = Reflect.get(link, "cause");
  }
  return undefined;
}

/**
 * Name the person a `person` unique index refused, off the error a failed reconcile threw.
 *
 * Reads Postgres's own detail line, `Key (google_id)=(104729) already exists.`, never the message: the message
 * Drizzle builds carries the whole statement and its bound values (see `databaseReason` in `../errors.ts`).
 *
 * @param cause whatever the transaction threw
 * @param people every draft this run tried to write
 * @returns the collision, or `undefined` when the failure is not a unique violation on a `person` index or no
 *   draft carries the refused value — a collision naming nobody is less honest than the driver's own line
 */
export function personCollisionOf({
  cause,
  people,
}: {
  cause: unknown;
  people: readonly PersonDraft[];
}): PersonCollision | undefined {
  const fields = violationFields({ cause });
  if (fields === undefined || fields.code !== UNIQUE_VIOLATION || fields.constraint === undefined) {
    return undefined;
  }
  const index = UNIQUE_INDEX_FIELDS[fields.constraint];
  if (index === undefined || fields.detail === undefined) {
    return undefined;
  }
  const match = /^Key \(([a-z_]+)\)=\((.*)\) already exists\.$/u.exec(fields.detail);
  if (match === null || match[1] !== index.column) {
    return undefined;
  }
  const value = match[2]!;
  const emails = sortedEmails({
    emails: people.filter((draft) => draft[index.field] === value).map((draft) => draft.email),
  });
  if (emails.length === 0) {
    return undefined;
  }
  return { column: index.column, constraint: fields.constraint, emails, value };
}
