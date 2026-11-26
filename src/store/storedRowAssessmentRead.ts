/**
 * The store reads behind the stored-row assessment that name rows by key: a row's current facts and the digest of its
 * words, and — only for the day's bounded slice — the words themselves. The newest-first walk that builds the slice is
 * `./storedRowAssessmentSlice.ts`; the pure half is `./storedRowAssessment.ts`.
 *
 * ## One digest, computed by the store
 *
 * A verdict is bound to the exact words it was made over. `owner_capture` and `owner_turn` already carry the SHA-256 of
 * their body (`body_sha256`, the very key of `owner_turn`). A `content` row's words are its title AND its body, so its
 * digest is {@link contentAssessmentDigest}: lower-case hex SHA-256 over the UTF-8 text of
 * `jsonb_build_array(1, title, body)`. The array keeps a null title distinct from an empty one and the two fields'
 * boundary unambiguous; the leading `1` versions the shape. It is ONE expression, used by the due list, the recording
 * verb's re-read and `store classify`, and computed only ever in Postgres, so no two readers can serialise the same
 * row two ways. Every function in it is `pg_catalog`'s, named so a lookalike earlier on the `search_path` cannot stand
 * in; `pg_catalog.sha256` is core Postgres, so no extension is needed.
 *
 * ## A check and the act it licenses hold one lock
 *
 * {@link readStoredRowsCurrent} reads `FOR UPDATE` when its caller acts on the answer. Inside a transaction the rows
 * it returns cannot change or go away until that transaction ends, so a recorded verdict or a written class is checked
 * against the very facts and digest the store still holds when it lands. A dry run asks for no lock and takes none.
 *
 * ## What leaves the store, and when
 *
 * The words are selected only by {@link readDueStoredRowTexts}, for at most the day's slice, and the digest is selected
 * beside them in the same statement so the words printed are exactly the words the digest names. Every other read
 * here selects a key, facts and a digest, never a title or body.
 */
import { asc, eq, inArray, type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader } from "./client.js";
import {
  contentDataClassFactsFromFields,
  ownerCaptureDataClassFacts,
  ownerTurnDataClassFacts,
} from "./dataClassIntake.js";
import { DATA_CLASS_RULE_TABLES, type DataClassFacts, type DataClassRuleTable } from "./dataClassRules.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { containerTable } from "./schema/container.js";
import { contentTable } from "./schema/content.js";
import { ownerCaptureTable } from "./schema/ownerCapture.js";
import { ownerTurnTable } from "./schema/ownerTurn.js";
import type { DueStoredRow } from "./storedRowAssessment.js";

/**
 * The digest of a `content` row's words, as the store computes it: see the module header.
 *
 * @internal — exported so the slice walk and the test read the one expression.
 */
export const contentAssessmentDigest: SQL<string> = sql<string>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(1, ${contentTable.title}, ${contentTable.body})::pg_catalog.text, 'UTF8')), 'hex')`;

/** One row's words and the digest read beside them. */
interface StoredRowText {
  readonly title: string | null;
  readonly body: string;
  readonly requestSha256: string;
}

/** One row's current facts and digest, never its words. */
export interface StoredRowCurrent {
  readonly facts: DataClassFacts;
  readonly requestSha256: string;
}

/**
 * The words of the named rows of one table, each with its digest from the same statement. Called only for the day's
 * bounded slice.
 *
 * @param ids the rows' keys
 * @returns each found row's words, by key
 */
async function readStoredRowTexts({
  client,
  table,
  ids,
}: {
  client: StoreClient;
  table: DataClassRuleTable;
  ids: readonly string[];
}): Promise<ReadonlyMap<string, StoredRowText>> {
  const found = new Map<string, StoredRowText>();
  if (ids.length === 0) {
    return found;
  }
  if (table === "content") {
    const rows = await client.db
      .select({
        body: contentTable.body,
        digest: contentAssessmentDigest,
        id: contentTable.id,
        title: contentTable.title,
      })
      .from(contentTable)
      .where(inArray(contentTable.id, [...ids]))
      .orderBy(asc(contentTable.id));
    for (const row of rows) {
      found.set(row.id, { body: row.body, requestSha256: row.digest, title: row.title });
    }
    return found;
  }
  if (table === "owner_capture") {
    const rows = await client.db
      .select({ body: ownerCaptureTable.body, digest: ownerCaptureTable.bodySha256, id: ownerCaptureTable.id })
      .from(ownerCaptureTable)
      .where(inArray(ownerCaptureTable.id, [...ids]));
    for (const row of rows) {
      found.set(row.id, { body: row.body, requestSha256: row.digest, title: null });
    }
    return found;
  }
  const rows = await client.db
    .select({ body: ownerTurnTable.body, id: ownerTurnTable.bodySha256 })
    .from(ownerTurnTable)
    .where(inArray(ownerTurnTable.bodySha256, [...ids]));
  for (const row of rows) {
    found.set(row.id, { body: row.body, requestSha256: row.id, title: null });
  }
  return found;
}

/**
 * The named `content` rows' current facts and digests, locked: see the module header.
 *
 * @param ids the rows' keys
 * @returns each found row's facts and digest, by key
 */
async function contentRowsCurrent({
  reader,
  ids,
  lock,
}: {
  reader: StoreReader;
  ids: readonly string[];
  lock: boolean;
}): Promise<ReadonlyMap<string, StoredRowCurrent>> {
  const query = reader.db
    .select({
      author: contentTable.authorNativeId,
      container: containerTable.nativeId,
      digest: contentAssessmentDigest,
      id: contentTable.id,
      kind: contentTable.kind,
      source: contentTable.source,
      visibility: contentTable.visibility,
    })
    .from(contentTable)
    .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
    .where(inArray(contentTable.id, [...ids]));
  const rows = lock ? await query.for("update", { of: contentTable }) : await query;
  const found = new Map<string, StoredRowCurrent>();
  for (const row of rows) {
    const facts = contentDataClassFactsFromFields({
      author: row.author,
      container: row.container,
      kind: row.kind,
      source: row.source,
      visibility: row.visibility,
    });
    found.set(row.id, { facts, requestSha256: row.digest });
  }
  return found;
}

/**
 * The named `owner_capture` rows' current facts and digests, locked.
 *
 * @param ids the rows' keys
 * @returns each found row's facts and digest, by key
 */
async function ownerCaptureRowsCurrent({
  reader,
  ids,
  lock,
}: {
  reader: StoreReader;
  ids: readonly string[];
  lock: boolean;
}): Promise<ReadonlyMap<string, StoredRowCurrent>> {
  const query = reader.db
    .select({ digest: ownerCaptureTable.bodySha256, id: ownerCaptureTable.id, source: ownerCaptureTable.source })
    .from(ownerCaptureTable)
    .where(inArray(ownerCaptureTable.id, [...ids]));
  const rows = lock ? await query.for("update") : await query;
  const found = new Map<string, StoredRowCurrent>();
  for (const row of rows) {
    found.set(row.id, { facts: ownerCaptureDataClassFacts({ source: row.source }), requestSha256: row.digest });
  }
  return found;
}

/**
 * The named `owner_turn` rows, locked: a key is its digest, so the read only asks which are held.
 *
 * @param ids the rows' keys
 * @returns each found row's facts and digest, by key
 */
async function ownerTurnRowsCurrent({
  reader,
  ids,
  lock,
}: {
  reader: StoreReader;
  ids: readonly string[];
  lock: boolean;
}): Promise<ReadonlyMap<string, StoredRowCurrent>> {
  const query = reader.db
    .select({ id: ownerTurnTable.bodySha256 })
    .from(ownerTurnTable)
    .where(inArray(ownerTurnTable.bodySha256, [...ids]));
  const rows = lock ? await query.for("update") : await query;
  const found = new Map<string, StoredRowCurrent>();
  for (const row of rows) {
    found.set(row.id, { facts: ownerTurnDataClassFacts(), requestSha256: row.id });
  }
  return found;
}

/**
 * The named rows' current facts and digests — what `store assessment-record` checks a verdict against and
 * `store classify` asks the port with. Never the words.
 *
 * @param reader the pool, or the transaction the check and its act share
 * @param table which classified table holds the rows
 * @param ids the rows' keys
 * @param lock read `FOR UPDATE`, for a check whose act follows in the same transaction; a dry run locks nothing
 * @returns each found row's facts and digest, by key; a row the store does not hold is absent
 */
export async function readStoredRowsCurrent({
  reader,
  table,
  ids,
  lock,
}: {
  reader: StoreReader;
  table: DataClassRuleTable;
  ids: readonly string[];
  lock: boolean;
}): Promise<ReadonlyMap<string, StoredRowCurrent>> {
  if (ids.length === 0) {
    return new Map();
  }
  if (table === "content") {
    return contentRowsCurrent({ ids, lock, reader });
  }
  if (table === "owner_capture") {
    return ownerCaptureRowsCurrent({ ids, lock, reader });
  }
  return ownerTurnRowsCurrent({ ids, lock, reader });
}

/** One due row with its words, for the visible session to classify. */
export interface DueStoredRowWithText extends DueStoredRow {
  readonly title: string | null;
  readonly body: string;
}

/**
 * The words of every row in a slice, each checked against the digest the slice was built over: a row whose words
 * moved between the two reads, or that is gone, refuses the whole read rather than pairing a digest with other words.
 *
 * @param due the slice's rows
 * @returns each row with its words, in the slice's order, or why they could not be paired
 */
export async function readDueStoredRowTexts({
  client,
  due,
}: {
  client: StoreClient;
  due: readonly DueStoredRow[];
}): Promise<Result<readonly DueStoredRowWithText[], StoreError>> {
  try {
    const texts = new Map<DataClassRuleTable, ReadonlyMap<string, StoredRowText>>();
    for (const table of DATA_CLASS_RULE_TABLES) {
      const ids = due.filter((row) => row.table === table).map((row) => row.rowId);
      texts.set(table, await readStoredRowTexts({ client, ids, table }));
    }
    const withText: DueStoredRowWithText[] = [];
    for (const row of due) {
      const text = texts.get(row.table)?.get(row.rowId);
      if (text?.requestSha256 !== row.requestSha256) {
        return err(
          StoreErrors.queryFailed({
            cause: `${row.table}/${row.rowId} changed or went away while it was read; run store assessment-due again`,
            what: "store assessment-due",
          }),
        );
      }
      withText.push({ ...row, body: text.body, title: text.title });
    }
    return ok(withText);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "store assessment-due" }));
  }
}
