/**
 * The reads and writes that carry a google-id rename into the people table — the effectful half of
 * `./rekey.ts`, whose pure planner decides every rename this file performs.
 *
 * `reconcile.ts` calls {@link planRekeys} and then {@link applyRekeys} inside its one transaction, before the
 * email-keyed upsert, so a person whose primary address changed is met by their own row rather than minting
 * a second one `uq_person_google_id` refuses. {@link textArray} lives here because both this file and the
 * reconciler bind lists of addresses and ids as one Postgres array.
 */
import { sql } from "drizzle-orm";

import type { StoreWriter } from "../client.js";
import { personTable } from "../schema/person.js";

import type { PersonDraft } from "./people.js";
import { type GoogleIdRekeyPlan, type PersonRekey, planGoogleIdRekeys, rekeyTemporaryEmail } from "./rekey.js";

/**
 * A list of strings as ONE Postgres text array literal, bound one parameter per element.
 *
 * Spelled out rather than passed as a JS array because the `sql` template expands an array value into a
 * tuple — `(a, b)` is a record, and `record` cannot be cast to `text[]`. MEASURED on the first
 * live run: `cannot cast type record to text[]`.
 *
 * @param values the strings
 * @returns the `array[...]::text[]` expression
 */
export function textArray({ values }: { values: readonly string[] }): ReturnType<typeof sql> {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Plan how every stored row holding a draft's google id under a different email follows that draft.
 *
 * Reads every row the plan has to see — a draft's google id, a draft's email, or a scratch address — and
 * locks them, so nothing else renames one between this read and the writes that rely on it. The decision is
 * {@link planGoogleIdRekeys}'s.
 *
 * @param writer the transaction this read runs in
 * @param people every draft this run will upsert
 * @returns the renames, and the collisions that forbid writing at all
 */
export async function planRekeys({
  writer,
  people,
}: {
  writer: StoreWriter;
  people: readonly PersonDraft[];
}): Promise<GoogleIdRekeyPlan> {
  const googleIds = people.flatMap((draft) => (draft.googleId === null ? [] : [draft.googleId]));
  if (googleIds.length === 0) {
    // No rename is possible, and no check the planner makes without a google id reads a stored row — but its
    // reserved-namespace refusal still applies to every draft, so the planner decides, over no rows.
    return planGoogleIdRekeys({ held: [], people });
  }
  const emails = [
    ...people.map((draft) => draft.email),
    ...googleIds.map((googleId) => rekeyTemporaryEmail({ googleId })),
  ];
  const held = await writer
    .select({ email: personTable.email, googleId: personTable.googleId, id: personTable.id })
    .from(personTable)
    .where(
      sql`${personTable.googleId} = any(${textArray({ values: googleIds })}) or ${personTable.email} = any(${textArray({ values: emails })})`,
    )
    .for("update");
  return planGoogleIdRekeys({ held, people });
}

/**
 * Move one stored row from one address to another, by its uuid, and refuse if it was not where the plan saw it.
 *
 * @param writer the transaction this write runs in
 * @param personId the row's uuid
 * @param from the address the row must currently hold
 * @param to the address it moves to
 */
async function moveEmail({
  writer,
  personId,
  from,
  to,
}: {
  writer: StoreWriter;
  personId: string;
  from: string;
  to: string;
}): Promise<void> {
  const moved = await writer
    .update(personTable)
    .set({ email: to, updatedAt: new Date() })
    .where(sql`${personTable.id} = ${personId} and ${personTable.email} = ${from}`)
    .returning({ id: personTable.id });
  if (moved.length !== 1) {
    // An invariant, not a domain failure: the row was locked by `planRekeys`, so a miss here means the plan
    // and the table disagree, and the whole transaction must roll back rather than fall through to an insert.
    throw new Error(`person ${personId} was not at ${from} when renaming it to ${to}`);
  }
}

/**
 * Rename every planned row in place, so the email upsert after it meets the person rather than minting a
 * second row the google id index refuses.
 *
 * Two phases: every row out to its scratch address, then every row into its new one, because
 * `uq_person_email` is checked per statement and a swap or a chain has no safe one-step order. Runs before
 * the reconciler's `releaseMovedIds`, which keys on the email and so must see the renamed address.
 *
 * @param writer the transaction this write runs in
 * @param rekeys the renames {@link planRekeys} decided, collision-free
 */
export async function applyRekeys({
  writer,
  rekeys,
}: {
  writer: StoreWriter;
  rekeys: readonly PersonRekey[];
}): Promise<void> {
  for (const rekey of rekeys) {
    await moveEmail({ from: rekey.fromEmail, personId: rekey.personId, to: rekey.temporaryEmail, writer });
  }
  for (const rekey of rekeys) {
    await moveEmail({ from: rekey.temporaryEmail, personId: rekey.personId, to: rekey.toEmail, writer });
  }
}
