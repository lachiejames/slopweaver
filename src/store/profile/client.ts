/**
 * The effectful edge of profile curation: reading and writing the owner row, the judgement column and the
 * voice register.
 *
 * Every function here takes an already-open {@link ../client.StoreClient} rather than opening one, so a
 * caller that needs three reads pays for one connection — which is what lets the session-start hook do
 * all of its work inside one round trip. The pure half is {@link ./core}.
 *
 * ## Writes are optimistic, never locked
 *
 * Each write pins to the revision the caller read and refuses when the row has moved. That is the same
 * choice the handover board made and for the same reason: a lock held by a session that dies blocks every
 * other session, while a refused write costs one re-read and shows the curator what the other writer
 * actually said. `REVISION_CONFLICT` is therefore a normal outcome, not an error path nobody expects.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader } from "../client.js";
import { StoreErrors } from "../errors.js";
import { OWNER_PROFILE_ID, type OwnerProfileRow, ownerProfileTable } from "../schema/ownerProfile.js";
import { ownerVoiceRegisterTable } from "../schema/ownerVoice.js";
import { personTable } from "../schema/person.js";

import { parseOwnerSelfDescription, parsePersonJudgement } from "./core.js";
import { type ProfileError, ProfileErrors } from "./errors.js";
import type { OwnerSelfDescription, PersonJudgement, VoiceCohort } from "./types.js";

/** The owner row with its payload already validated, which is the only shape a reader should see. */
export interface OwnerProfile {
  readonly displayName: string;
  readonly personId: string | null;
  readonly selfDescription: OwnerSelfDescription;
  readonly revision: number;
  readonly updatedAt: Date;
}

/** Turn a thrown driver error into this domain's boundary variant, with the store's own capped message. */
function queryFailure({ what, cause }: { what: string; cause: unknown }): ProfileError {
  return ProfileErrors.queryFailed({ cause: StoreErrors.queryFailed({ cause, what }) });
}

/**
 * Read the one owner row, or say it has never been written.
 *
 * @param client an open store connection
 * @returns the owner profile with its payload validated, or the typed refusal
 */
export async function readOwnerProfile({
  client,
}: {
  client: StoreReader;
}): Promise<Result<OwnerProfile, ProfileError>> {
  let rows: OwnerProfileRow[];
  try {
    rows = await client.db.select().from(ownerProfileTable).where(eq(ownerProfileTable.id, OWNER_PROFILE_ID)).limit(1);
  } catch (error) {
    return err(queryFailure({ cause: error, what: "owner profile read" }));
  }
  const row = rows[0];
  if (row === undefined) {
    return err(ProfileErrors.absent({ subject: OWNER_PROFILE_ID }));
  }
  const payload = parseOwnerSelfDescription({ value: row.selfDescription });
  if (payload.isErr()) {
    return err(payload.error);
  }
  return ok({
    displayName: row.displayName,
    personId: row.personId,
    revision: row.revision,
    selfDescription: payload.value,
    updatedAt: row.updatedAt,
  });
}

/**
 * Write the owner row, creating it on a fresh install and pinning to a revision on every later write.
 *
 * `expectedRevision` of 0 means "this row should not exist yet" and inserts; any other value updates only
 * when the stored revision still matches. Spelling the create case as a revision rather than a separate
 * verb keeps one code path for the curator and makes the race visible: two sessions seeding at once, both
 * pinned to 0, produce one insert and one primary-key failure rather than a silent overwrite.
 *
 * @param client an open store connection
 * @param displayName what to call the owner in output a human reads
 * @param selfDescription the validated payload to store
 * @param personId the owner's own `person.id` when identity resolution has placed them, null before that
 * @param expectedRevision the revision the caller read, or 0 to create
 * @returns the revision now stored, or the typed refusal
 */
export async function writeOwnerProfile({
  client,
  displayName,
  selfDescription,
  personId,
  expectedRevision,
}: {
  client: StoreClient;
  displayName: string;
  selfDescription: OwnerSelfDescription;
  personId: string | null;
  expectedRevision: number;
}): Promise<Result<number, ProfileError>> {
  if (expectedRevision === 0) {
    try {
      await client.db
        .insert(ownerProfileTable)
        .values({ displayName, id: OWNER_PROFILE_ID, personId, revision: 1, selfDescription });
    } catch (error) {
      return err(queryFailure({ cause: error, what: "owner profile create" }));
    }
    return ok(1);
  }
  const next = expectedRevision + 1;
  let updated: { revision: number }[];
  try {
    updated = await client.db
      .update(ownerProfileTable)
      .set({ displayName, personId, revision: next, selfDescription, updatedAt: new Date() })
      .where(and(eq(ownerProfileTable.id, OWNER_PROFILE_ID), eq(ownerProfileTable.revision, expectedRevision)))
      .returning({ revision: ownerProfileTable.revision });
  } catch (error) {
    return err(queryFailure({ cause: error, what: "owner profile write" }));
  }
  if (updated.length === 0) {
    const current = await readOwnerProfile({ client });
    const actual = current.isOk() ? current.value.revision : 0;
    return err(ProfileErrors.conflict({ actual, expected: expectedRevision, subject: OWNER_PROFILE_ID }));
  }
  return ok(next);
}

/**
 * Read one person's judgement column, distinguishing "uncurated" from "not a person we hold".
 *
 * Both answers are refusals and they are different refusals on purpose: `PROFILE_ABSENT` names a person
 * who is in the register with nothing curated, and a `PROFILE_QUERY_FAILED` carrying no rows at all would
 * be a different problem. An uncurated person is the overwhelmingly common case — of the people the
 * member pull places, roughly ten are briefed — so it must not read as an error anybody chases.
 *
 * @param client an open store connection
 * @returns the validated judgement, or the typed refusal
 */
export async function readPersonJudgement({
  client,
  personId,
}: {
  client: StoreClient;
  personId: string;
}): Promise<Result<PersonJudgement, ProfileError>> {
  let rows: { judgement: PersonJudgement | null }[];
  try {
    rows = await client.db
      .select({ judgement: personTable.judgement })
      .from(personTable)
      .where(eq(personTable.id, personId))
      .limit(1);
  } catch (error) {
    return err(queryFailure({ cause: error, what: "person judgement read" }));
  }
  const stored = rows[0]?.judgement;
  if (stored === undefined || stored === null) {
    return err(ProfileErrors.absent({ subject: personId }));
  }
  return parsePersonJudgement({ value: stored });
}

/**
 * Write one person's judgement column, pinned to the revision inside the payload that was read.
 *
 * The predicate reads the revision out of the stored JSON rather than a column, because the revision is
 * part of the payload — which is what makes a hand-edited file round-trip: export the judgement, edit it,
 * write it back, and the revision it carries is the one it was exported at. `expectedRevision` of 0 means
 * the column is expected to be null, which is how a first curation is spelled.
 *
 * @param client an open store connection
 * @param judgement the payload to store, already carrying its NEXT revision
 * @param expectedRevision the revision the caller read, or 0 when the column was null
 * @returns the revision now stored, or the typed refusal
 */
export async function writePersonJudgement({
  client,
  personId,
  judgement,
  expectedRevision,
}: {
  client: StoreClient;
  personId: string;
  judgement: PersonJudgement;
  expectedRevision: number;
}): Promise<Result<number, ProfileError>> {
  const pinned =
    expectedRevision === 0
      ? sql`${personTable.judgement} is null`
      : sql`(${personTable.judgement} ->> 'revision')::int = ${expectedRevision}`;
  let updated: { id: string }[];
  try {
    updated = await client.db
      .update(personTable)
      .set({ judgement, updatedAt: new Date() })
      .where(and(eq(personTable.id, personId), pinned))
      .returning({ id: personTable.id });
  } catch (error) {
    return err(queryFailure({ cause: error, what: "person judgement write" }));
  }
  if (updated.length === 0) {
    // Zero rows means the WHERE did not match, and THREE different things produce that: the revision moved,
    // the person row is not there at all, or the read that diagnoses it failed too. Reporting all three as a
    // conflict tells a curator to re-read and redo an edit that would fail the same way — so each says what
    // it is. Only the genuine move is a conflict.
    const current = await readPersonJudgement({ client, personId });
    if (current.isErr() && current.error.code === "PROFILE_QUERY_FAILED") {
      return err(current.error);
    }
    if (current.isErr() && current.error.code === "PROFILE_ABSENT" && expectedRevision === 0) {
      // The pin was `judgement is null` and the column IS null, so what did not match is the id: no such
      // person. A conflict message here would name a revision nobody ever wrote.
      return err(ProfileErrors.absent({ subject: personId }));
    }
    let actual = 0;
    if (current.isOk()) {
      actual = current.value.revision;
    }
    return err(ProfileErrors.conflict({ actual, expected: expectedRevision, subject: personId }));
  }
  return ok(judgement.revision);
}

/**
 * Read every measured voice cohort, ordered so a reader sees the same list twice.
 *
 * @param client an open store connection
 * @returns every cohort, which may legitimately be none on an install that has imported no measurement
 */
export async function readVoiceRegister({
  client,
}: {
  client: StoreReader;
}): Promise<Result<readonly VoiceCohort[], ProfileError>> {
  try {
    const rows = await client.db
      .select()
      .from(ownerVoiceRegisterTable)
      .where(eq(ownerVoiceRegisterTable.ownerId, OWNER_PROFILE_ID))
      .orderBy(ownerVoiceRegisterTable.surface, ownerVoiceRegisterTable.cohort);
    return ok(
      rows.map((row): VoiceCohort => ({
        ceilingWords: row.ceilingWords,
        cohort: row.cohort,
        measuredAt: row.measuredAt.toISOString(),
        medianWords: row.medianWords,
        p75Words: row.p75Words,
        p90Words: row.p90Words,
        qualification: row.qualification,
        sampleCount: row.sampleCount,
        source: row.source,
        surface: row.surface,
      })),
    );
  } catch (error) {
    return err(queryFailure({ cause: error, what: "voice register read" }));
  }
}

/**
 * Upsert one measured cohort.
 *
 * No revision pin here, and that is a deliberate difference from the two above: a cohort is a MEASUREMENT,
 * so re-importing the same source rewrites the same numbers and two importers racing produce the same row.
 * There is nothing a second writer could destroy that a re-run would not restore.
 *
 * @param client an open store connection
 * @param cohort the validated cohort to store
 * @returns nothing on success, or the typed refusal
 */
export async function writeVoiceCohort({
  client,
  cohort,
}: {
  client: StoreClient;
  cohort: VoiceCohort;
}): Promise<Result<true, ProfileError>> {
  return upsertVoiceCohort({ cohort, db: client.db });
}

/**
 * Upsert one measured cohort through any handle a write runs on — the pool, or a transaction an import already holds,
 * so one statement serves {@link writeVoiceCohort} and the import's writer alike.
 *
 * @param db the pool's database or an open transaction
 * @param cohort the validated cohort to store
 * @returns true once written, or the typed refusal
 */
export async function upsertVoiceCohort({
  db,
  cohort,
}: {
  db: StoreReader["db"];
  cohort: VoiceCohort;
}): Promise<Result<true, ProfileError>> {
  const measured = {
    ceilingWords: cohort.ceilingWords,
    measuredAt: new Date(cohort.measuredAt),
    medianWords: cohort.medianWords,
    p75Words: cohort.p75Words,
    p90Words: cohort.p90Words,
    qualification: cohort.qualification,
    sampleCount: cohort.sampleCount,
    source: cohort.source,
  };
  try {
    await db
      .insert(ownerVoiceRegisterTable)
      .values({ ...measured, cohort: cohort.cohort, ownerId: OWNER_PROFILE_ID, surface: cohort.surface })
      .onConflictDoUpdate({
        set: { ...measured, updatedAt: new Date() },
        target: [ownerVoiceRegisterTable.ownerId, ownerVoiceRegisterTable.surface, ownerVoiceRegisterTable.cohort],
      });
  } catch (error) {
    return err(queryFailure({ cause: error, what: "voice register write" }));
  }
  return ok(true);
}
