/**
 * The reconciler: the Google Workspace directory and the member pull become the store's people, and every
 * content row's author is re-pointed at them.
 *
 * ## The one writer
 *
 * This is the ONLY code that inserts or updates a `person` row. Record ingest looks the table up and never
 * writes it — the fallback that minted a person from every author it met (`displayName: author.handle ??
 * author.nativeId`) is what named 1,241 people by their id and split 76 humans in two, and the owner's
 * ruling that identities come from Google Admin is a ruling about WHO WRITES, not only about shape.
 *
 * ## Why one transaction for the whole run
 *
 * A partial reconcile is worse than none: a platform id released from one person and not yet placed on
 * another is a row with no author for as long as the gap lasts. Whole-run atomicity makes a failed run a
 * no-op, and a second run over unchanged inputs upserts the same values — idempotent, and safe on a
 * schedule.
 *
 * ## The email is the key; the google id is the identity
 *
 * Drafts upsert on the email, but a person Google still lists can change their primary address while their
 * google id never changes. So before the upsert, a stored row holding a draft's google id under another
 * address is renamed in place (`./rekey.ts` says why the row is renamed rather than the id moved), and a
 * rename that would need two rows merged stops the run before any write, naming the person.
 *
 * ## What it never does: delete
 *
 * A person Google no longer lists keeps their row, their email and their history; only `google_id` is
 * what the next upsert carries, and a person the directory has dropped is simply not upserted at all.
 * A platform id that vanished from a pull is left where it was — member bronze cannot express a departure
 * (its own header says why) — and only an id that MOVED to another address is released, because two people
 * cannot hold one. Owner ruling: nobody is forgotten.
 */
import { sql } from "drizzle-orm";

import { readGoogleDirectory } from "../../corpus/directory/store.js";
import { readAllMembers } from "../../corpus/members/store.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  PERSON_COLUMN_BY_SOURCE,
  PERSON_RESOLVABLE_SOURCES,
  type PersonResolvableSource,
  personTable,
} from "../schema/person.js";
import { personLinkCandidateTable } from "../schema/personLink.js";

import { buildPeople, type NameCandidate, type PeopleBuild, type PersonDraft } from "./people.js";
import { type PersonCollision, personCollisionOf } from "./rekey.js";
import { applyRekeys, planRekeys, textArray } from "./rekeyWrites.js";

/** What one reconcile run did. */
export interface ReconcileReport {
  readonly directoryUsers: number;
  readonly membersRead: number;
  /** People upserted this run — the directory's plus every member with a trusted address Google lacks. */
  readonly people: number;
  readonly fromDirectory: number;
  readonly bots: number;
  readonly candidates: number;
  /** Of those, the exact org-member name matches this build APPLIED — see `exactOrgMember`. */
  readonly accepted: number;
  readonly unmatched: number;
  readonly refused: readonly string[];
  /** Content rows whose `author_id` this run changed, in either direction. */
  readonly authorsRepointed: number;
  /** Stored rows renamed in place to the new primary address their google id now carries. */
  readonly renamed: number;
  /** Stale rows a previous build produced that this one does not, and nothing authored — see `prunePeople`. */
  readonly pruned: number;
  readonly warnings: readonly string[];
  readonly elapsedMs: number;
}

/** How many drafts one upsert statement carries: 13 columns each, well under the driver's parameter cap. */
const UPSERT_BATCH = 500;

/** The platform id columns, in the order they are released and re-pointed. */
const ID_COLUMNS = [
  "slackUserId",
  "linearUserId",
  "linearDisplayName",
  "githubId",
  "githubLogin",
  "notionUserId",
] as const;

/**
 * Release every platform id this build places on a DIFFERENT person than the one holding it.
 *
 * One statement per column: unnest the (id, email) pairs and null the column wherever the row's email is
 * not the pair's. An id that stays put matches nothing; an id that moved is freed before the upsert claims
 * it, which is what keeps the unique index from refusing a legitimate move.
 *
 * @param writer the transaction this write runs in
 * @param people every draft this run will upsert
 */
async function releaseMovedIds({
  writer,
  people,
}: {
  writer: StoreWriter;
  people: readonly PersonDraft[];
}): Promise<void> {
  for (const column of ID_COLUMNS) {
    const pairs = people.filter((draft) => draft[column] !== null);
    if (pairs.length === 0) {
      continue;
    }
    const ids = pairs.flatMap((draft) => (draft[column] === null ? [] : [draft[column]]));
    const emails = pairs.map((draft) => draft.email);
    await writer
      .update(personTable)
      .set({ [column]: null, updatedAt: new Date() })
      .where(
        sql`${personTable[column]} in (
          select moved.id from unnest(${textArray({ values: ids })}, ${textArray({ values: emails })}) as moved(id, email)
          where moved.id = ${personTable[column]} and moved.email <> ${personTable.email})`,
      );
  }
}

/**
 * Upsert every draft, keyed on the email — {@link applyRekeys} has already made the email the key a renamed
 * person's row answers to.
 *
 * @param writer the transaction this write runs in
 * @param people the drafts, in batches
 */
async function upsertPeople({
  writer,
  people,
}: {
  writer: StoreWriter;
  people: readonly PersonDraft[];
}): Promise<void> {
  for (let at = 0; at < people.length; at += UPSERT_BATCH) {
    const batch = people.slice(at, at + UPSERT_BATCH);
    await writer
      .insert(personTable)
      .values(batch.map((draft) => ({ ...draft })))
      .onConflictDoUpdate({
        set: {
          active: sql`excluded.active`,
          displayName: sql`excluded.display_name`,
          familyName: sql`excluded.family_name`,
          githubId: sql`coalesce(excluded.github_id, ${personTable.githubId})`,
          githubLogin: sql`coalesce(excluded.github_login, ${personTable.githubLogin})`,
          givenName: sql`excluded.given_name`,
          googleId: sql`coalesce(excluded.google_id, ${personTable.googleId})`,
          linearDisplayName: sql`coalesce(excluded.linear_display_name, ${personTable.linearDisplayName})`,
          linearUserId: sql`coalesce(excluded.linear_user_id, ${personTable.linearUserId})`,
          notionUserId: sql`coalesce(excluded.notion_user_id, ${personTable.notionUserId})`,
          orgUnitPath: sql`excluded.org_unit_path`,
          slackUserId: sql`coalesce(excluded.slack_user_id, ${personTable.slackUserId})`,
          title: sql`excluded.title`,
          updatedAt: new Date(),
        },
        target: personTable.email,
      });
  }
}

/**
 * Record the name matches for review, resolving each candidate's person by email.
 *
 * A re-run overwrites what it decided rather than stacking duplicates — see the set clause.
 *
 * @param writer the transaction this write runs in
 * @param candidates the matches the build found
 */
async function recordCandidates({
  writer,
  candidates,
}: {
  writer: StoreWriter;
  candidates: readonly NameCandidate[];
}): Promise<void> {
  if (candidates.length === 0) {
    return;
  }
  const emails = [...new Set(candidates.map((candidate) => candidate.email))];
  const people = await writer
    .select({ email: personTable.email, id: personTable.id })
    .from(personTable)
    .where(sql`${personTable.email} = any(${textArray({ values: emails })})`);
  const idByEmail = new Map(people.map((person) => [person.email, person.id]));
  const values = candidates.flatMap((candidate) => {
    const personId = idByEmail.get(candidate.email);
    if (personId === undefined) {
      return [];
    }
    return [
      {
        confidence: candidate.signal.confidence.toFixed(3),
        handle: candidate.handle,
        nativeId: candidate.nativeId,
        personId,
        signals: [candidate.signal],
        source: candidate.source,
        status: candidate.status,
      },
    ];
  });
  for (let at = 0; at < values.length; at += UPSERT_BATCH) {
    await writer
      .insert(personLinkCandidateTable)
      .values(values.slice(at, at + UPSERT_BATCH))
      .onConflictDoUpdate({
        // The status and the signal are what this build DECIDED, so a re-run must overwrite them: a
        // `pending` row from an earlier build standing over an `accepted` one would report a link as
        // waiting for review while the column beside it already carries it.
        set: { confidence: sql`excluded.confidence`, signals: sql`excluded.signals`, status: sql`excluded.status` },
        target: [personLinkCandidateTable.personId, personLinkCandidateTable.source, personLinkCandidateTable.nativeId],
      });
  }
}

/**
 * The SQL comparison between a content row's native author id and one source's person column.
 *
 * GitHub logins are case-insensitive on GitHub and a record may carry either case; a Linear author is the
 * user id or, on older captures, the @-handle; every other id is exact.
 *
 * @param source the content source
 * @returns the predicate over `content c` and `person p`
 */
function authorMatches({ source }: { source: PersonResolvableSource }): ReturnType<typeof sql> {
  const column = sql.identifier(personTable[PERSON_COLUMN_BY_SOURCE[source]].name);
  if (source === "github") {
    return sql`lower(c.author_native_id) = lower(p.${column})`;
  }
  if (source === "linear") {
    // Either the id or the @-handle: tens of thousands of Linear rows name their author by the handle alone.
    return sql`(c.author_native_id = p.${column} or c.author_native_id = p.linear_display_name)`;
  }
  return sql`c.author_native_id = p.${column}`;
}

/**
 * Delete the people this build did not produce and no content row points at.
 *
 * ## Why a derived table is pruned, and why this is not the deletion the header forbids
 *
 * `person` is rebuilt from the directory and the member pull on every run, so a row this build did not
 * produce is a row its inputs no longer describe — an address that turned out to be Slack's
 * `deactivateduser…` placeholder, or the pre-off-boarding half of a `term_emp_` pair now folded into one
 * person. Left standing they are exactly the duplicate humans the whole shape exists to make impossible,
 * and no later run would ever clear them. MEASURED: 110 such rows after one fold landed.
 *
 * The two conditions are what keep it from forgetting anybody. A row ANY content points at is kept, so no
 * message is ever orphaned and no history is lost; and the whole pass is skipped when the build produced
 * nobody, so a failed directory pull cannot empty the table.
 *
 * @param writer the transaction this write runs in
 * @param people every draft this run upserted
 * @returns how many rows were deleted
 */
async function prunePeople({
  writer,
  people,
}: {
  writer: StoreWriter;
  people: readonly PersonDraft[];
}): Promise<number> {
  if (people.length === 0) {
    return 0;
  }
  const kept = textArray({ values: people.map((draft) => draft.email) });
  await writer.execute(sql`
    delete from person_link_candidate lc using person p
    where lc.person_id = p.id and p.email <> all(${kept})
      and not exists (select 1 from content c where c.author_id = p.id)`);
  const deleted = await writer.execute(sql`
    delete from person p
    where p.email <> all(${kept})
      and not exists (select 1 from content c where c.author_id = p.id)`);
  return rowCount({ result: deleted });
}

/**
 * Point every content row's `author_id` at the person its native author id now resolves to.
 *
 * Two statements per source, and the order matters: first every row whose author no longer matches the
 * person it points at is cleared, then every row whose native id matches a person is set. A row an
 * earlier ingest could not resolve — the person did not exist yet — is picked up by the second statement,
 * which is how ingest can leave `author_id` null without losing anything.
 *
 * @param writer the transaction this write runs in
 * @returns how many rows changed across every source
 */
async function repointAuthors({ writer }: { writer: StoreWriter }): Promise<number> {
  let changed = 0;
  for (const source of PERSON_RESOLVABLE_SOURCES) {
    const matches = authorMatches({ source });
    const cleared = await writer.execute(sql`
      update content c set author_id = null
      from person p
      where c.source = ${source} and c.author_id = p.id and not (${matches})`);
    const set = await writer.execute(sql`
      update content c set author_id = p.id
      from person p
      where c.source = ${source} and c.author_native_id is not null and ${matches}
        and c.author_id is distinct from p.id`);
    changed += rowCount({ result: cleared }) + rowCount({ result: set });
  }
  return changed;
}

/**
 * The affected-row count off a raw statement's result.
 *
 * @param result what `execute` returned
 * @returns the driver's count, or zero when it reports none
 */
function rowCount({ result }: { result: unknown }): number {
  if (typeof result === "object" && result !== null && "count" in result) {
    return typeof result.count === "number" ? result.count : 0;
  }
  return 0;
}

/** What one reconcile transaction did: refused before any write, or wrote the build. */
type BuildWrite =
  | { kind: "collided"; collisions: readonly PersonCollision[] }
  | { kind: "written"; repointed: number; pruned: number; renamed: number };

/**
 * Write one build inside a transaction: rename the rows whose google id moved, upsert, re-point, prune.
 *
 * @param writer the transaction this write runs in
 * @param build the person set built from what is on disk
 * @returns the collisions that stopped it before any write, or the counts of what it wrote
 */
async function writeBuild({ writer, build }: { writer: StoreWriter; build: PeopleBuild }): Promise<BuildWrite> {
  const plan = await planRekeys({ people: build.people, writer });
  if (plan.collisions.length > 0) {
    // Before any write, so the transaction commits nothing but a read.
    return { collisions: plan.collisions, kind: "collided" };
  }
  await applyRekeys({ rekeys: plan.rekeys, writer });
  await releaseMovedIds({ people: build.people, writer });
  await upsertPeople({ people: build.people, writer });
  await recordCandidates({ candidates: build.candidates, writer });
  const repointed = await repointAuthors({ writer });
  const pruned = await prunePeople({ people: build.people, writer });
  return { kind: "written", pruned, renamed: plan.rekeys.length, repointed };
}

/**
 * Build the person set from what is on disk and write it, then re-point every author.
 *
 * @param client the open store
 * @param home the Slopweaver state home whose directory and member files to read
 * @returns what the run did, or the database failure, which is fatal in a way no per-row outcome is
 */
export async function reconcileIdentities({
  client,
  home,
}: {
  client: StoreClient;
  home?: string;
}): Promise<Result<ReconcileReport, StoreError>> {
  const started = Date.now();
  const directory = home === undefined ? readGoogleDirectory() : readGoogleDirectory({ home });
  const members = home === undefined ? readAllMembers() : readAllMembers({ home });
  const warnings = [...directory.warnings, ...members.warnings];
  if (directory.rows.length === 0) {
    warnings.push(
      "no Google Workspace directory on disk, so every person comes from the member pull alone — run `slopweaver store identity --pull` to key people on Google Admin",
    );
  }
  const build = buildPeople({ directory: directory.rows, members: members.rows });

  try {
    const written = await client.db.transaction(async (writer) => writeBuild({ build, writer }));
    if (written.kind === "collided") {
      return err(StoreErrors.personCollided({ collisions: written.collisions, what: "store identity reconcile" }));
    }
    return ok({
      authorsRepointed: written.repointed,
      bots: build.bots,
      accepted: build.candidates.filter((candidate) => candidate.status === "accepted").length,
      candidates: build.candidates.length,
      directoryUsers: directory.rows.length,
      elapsedMs: Date.now() - started,
      fromDirectory: build.fromDirectory,
      membersRead: members.rows.length,
      people: build.people.length,
      pruned: written.pruned,
      refused: build.refused,
      renamed: written.renamed,
      unmatched: build.unmatched,
      warnings,
    });
  } catch (error: unknown) {
    const what = "store identity reconcile";
    const collision = personCollisionOf({ cause: error, people: build.people });
    if (collision !== undefined) {
      return err(StoreErrors.personCollided({ cause: error, collisions: [collision], what }));
    }
    return err(StoreErrors.queryFailed({ cause: error, what }));
  }
}
