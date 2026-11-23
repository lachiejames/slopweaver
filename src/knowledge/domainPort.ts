/**
 * The one door this install's own knowledge domains are read and added through, and its orchestration over
 * injected seams.
 *
 * The `knowledge_domain` table is the authority (`../store/schema/knowledgeDomain.ts`). The retired
 * `knowledge/domains.json` is imported ONCE by the shared protocol in `../store/registerImport.ts`, on the first
 * operation of any connection, read or add. A store that cannot be reached is
 * `KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE`, never a file read and never "no install domains": an empty answer would
 * make every one of the install's own domains read as unconfigured, and a lesson about it unrecordable for a
 * reason nobody could see.
 *
 * What the import marker does NOT catch, stated rather than discovered: `confirmEmptyRead` refuses only a table
 * that has lost EVERY row since its import. It cannot compare the row count with the marker's, because the table
 * legitimately grows with every add, so one row deleted out of band after the import is simply the authority's
 * answer, which is the same rule as every register on the shared protocol. Catching that would need a removal
 * journal, and nothing deletes a domain today.
 *
 * Every effect arrives through {@link KnowledgeDomainSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/knowledgeDomainFixture.ts` — a seam, not a mock). The Postgres half and the
 * production factory are `./domainStoreRows.ts`; what only a real database can prove is the opt-in
 * `src/__tests__/integration/knowledgeDomainStore.test.ts`.
 *
 * ## One insert attempt, never retried
 *
 * An add reads the vocabulary, runs every check `./installDomains.ts` holds an addition to, then inserts the
 * domain and its aliases in ONE transaction that commits only if every row went in. The slug is the primary key
 * of domains and aliases alike, so another writer that took any of them first is `KNOWLEDGE_DOMAIN_ADD_CONFLICT`
 * with nothing written — and the port does not try again: the vocabulary changed under the check, so the check
 * is what has to run again, by the caller. Once the insert commits, no further statement runs: the answer is the
 * checked vocabulary plus what was written. The one step left is closing the connection, and a close that fails
 * still refuses, by `overConnection`'s shared rule — a retry then meets the slug as already configured, which is
 * visible, never a lost or doubled domain.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  confirmEmptyRead,
  ensureImported,
  type ImportOnceRows,
  type ImportSource,
  overConnection,
  type StoreStepFailure,
} from "../store/registerImport.js";
import { type KnowledgeDomainStoreError, KnowledgeDomainStoreErrors } from "./domainStoreErrors.js";
import type { KnowledgeDomainEntry } from "./domains.js";
import type { InstallKnowledgeDomains } from "./domainVocabulary.js";
import {
  addInstallKnowledgeDomain,
  type InstallDomainRecord,
  type InstallKnowledgeDomainsAddRefusedError,
  installDomainsFromRecords,
  withAddedInstallDomains,
} from "./installDomains.js";

/** The vocabulary's two operations, as one value a caller threads. */
export interface KnowledgeDomainPort {
  /** This install's own domains and aliases. */
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<InstallKnowledgeDomains, KnowledgeDomainStoreError>>;
  /** Add one domain and its aliases, in one insert attempt; answers the vocabulary as it now stands. */
  readonly add: (request: {
    readonly home: string;
    readonly entry: KnowledgeDomainEntry;
    readonly aliases: Readonly<Record<string, string>>;
  }) => Promise<Result<InstallKnowledgeDomains, KnowledgeDomainStoreError | InstallKnowledgeDomainsAddRefusedError>>;
}

/** One stored row as the store returned it, undecoded. */
export interface StoredKnowledgeDomain {
  readonly slug: string;
  readonly kind: string;
  readonly holds: string | null;
  readonly foldsInto: string | null;
}

/** What an all-or-nothing insert did: every row went in, or another writer held the slugs named and none did. */
export type InsertAllOutcome =
  { readonly inserted: true } | { readonly inserted: false; readonly taken: readonly string[] };

/** The row operations one open connection offers, and the handle that closes it. */
export interface KnowledgeDomainRows extends ImportOnceRows<InstallDomainRecord> {
  /** Every stored row, by slug. */
  readonly readAll: () => Promise<Result<readonly StoredKnowledgeDomain[], StoreStepFailure>>;
  /** Insert every record in one transaction that commits only if none of their slugs was already taken. */
  readonly insertAll: (request: {
    readonly records: readonly InstallDomainRecord[];
  }) => Promise<Result<InsertAllOutcome, StoreStepFailure>>;
  readonly close: () => Promise<void>;
}

/** Every effect the vocabulary's store half performs. */
export interface KnowledgeDomainSeams {
  /** Open the store for one home, refusing with `KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<KnowledgeDomainRows, KnowledgeDomainStoreError>>;
  /** The strict read of the retired file, consulted only when no import marker exists. */
  readonly readImportFile: (request: {
    readonly home: string;
  }) => Result<ImportSource<InstallDomainRecord>, KnowledgeDomainStoreError>;
}

/**
 * Decode one stored row strictly: a kind the table's CHECK should have refused, or a domain with no `holds`, is
 * a corrupt row named rather than skipped.
 *
 * @param row the row
 * @returns the record, or the sentence naming what is wrong with it
 */
function decodeStored({ row }: { row: StoredKnowledgeDomain }): Result<InstallDomainRecord, string> {
  if (row.kind === "domain" && row.holds !== null && row.foldsInto === null) {
    return ok({ holds: row.holds, kind: "domain", slug: row.slug });
  }
  if (row.kind === "alias" && row.foldsInto !== null && row.holds === null) {
    return ok({ foldsInto: row.foldsInto, kind: "alias", slug: row.slug });
  }
  return err(`stored row "${row.slug}" is neither a domain with what it holds nor an alias with its target`);
}

/**
 * Read and assemble the vocabulary over an open connection, the import already run.
 *
 * @param home the state home whose store is meant
 * @param rows the open connection
 * @returns the vocabulary, or the refusal
 */
async function readVocabulary({
  home,
  rows,
}: {
  home: string;
  rows: KnowledgeDomainRows;
}): Promise<Result<InstallKnowledgeDomains, KnowledgeDomainStoreError>> {
  const stored = await rows.readAll();
  if (stored.isErr()) {
    return err(KnowledgeDomainStoreErrors.storeUnavailable(stored.error));
  }
  const held = await confirmEmptyRead({
    rowCount: stored.value.length,
    rows,
    unavailable: KnowledgeDomainStoreErrors.storeUnavailable,
  });
  if (held.isErr()) {
    return err(held.error);
  }
  const records: InstallDomainRecord[] = [];
  const problems: string[] = [];
  stored.value.forEach((row) => {
    const decoded = decodeStored({ row });
    if (decoded.isErr()) {
      problems.push(decoded.error);
      return;
    }
    records.push(decoded.value);
  });
  if (problems.length > 0) {
    return err(KnowledgeDomainStoreErrors.rowsInvalid({ problems }));
  }
  return installDomainsFromRecords({ home, records }).mapErr((found) =>
    KnowledgeDomainStoreErrors.rowsInvalid({ problems: found }),
  );
}

/**
 * Run the one-time import, then read the vocabulary.
 *
 * @param home the state home whose store and retired file are meant
 * @param rows the open connection
 * @param seams where the file read comes from
 * @returns the vocabulary, or the refusal
 */
async function importedVocabulary({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: KnowledgeDomainRows;
  seams: KnowledgeDomainSeams;
}): Promise<Result<InstallKnowledgeDomains, KnowledgeDomainStoreError>> {
  const ready = await ensureImported({
    readSource: () => seams.readImportFile({ home }),
    rows,
    unavailable: KnowledgeDomainStoreErrors.storeUnavailable,
  });
  if (ready.isErr()) {
    return err(ready.error);
  }
  return readVocabulary({ home, rows });
}

/**
 * Add one domain and its aliases over an open connection, in one insert attempt.
 *
 * @param home the state home whose store and retired file are meant
 * @param entry the new domain
 * @param aliases the retired spellings to fold into a domain, keyed by spelling
 * @param rows the open connection
 * @param seams where the file read comes from
 * @returns the vocabulary as it now stands, or the refusal
 */
async function addWith({
  aliases,
  entry,
  home,
  rows,
  seams,
}: {
  aliases: Readonly<Record<string, string>>;
  entry: KnowledgeDomainEntry;
  home: string;
  rows: KnowledgeDomainRows;
  seams: KnowledgeDomainSeams;
}): Promise<Result<InstallKnowledgeDomains, KnowledgeDomainStoreError | InstallKnowledgeDomainsAddRefusedError>> {
  const current = await importedVocabulary({ home, rows, seams });
  if (current.isErr()) {
    return err(current.error);
  }
  const records = addInstallKnowledgeDomain({ aliases, entry, installDomains: current.value });
  if (records.isErr()) {
    return err(records.error);
  }
  const written = await rows.insertAll({ records: records.value });
  if (written.isErr()) {
    return err(KnowledgeDomainStoreErrors.storeUnavailable(written.error));
  }
  if (!written.value.inserted) {
    return err(KnowledgeDomainStoreErrors.addConflict({ taken: written.value.taken }));
  }
  // No re-read: a statement after the commit could fail and report a refusal for rows that landed.
  return ok(withAddedInstallDomains({ installDomains: current.value, records: records.value }));
}

/**
 * A domain port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./domainStoreRows.ts`'s
 * @returns the port
 */
export function storeKnowledgeDomainPort({ seams }: { seams: KnowledgeDomainSeams }): KnowledgeDomainPort {
  return {
    add: ({ aliases, entry, home }) =>
      overConnection({
        body: (rows) => addWith({ aliases, entry, home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: KnowledgeDomainStoreErrors.storeUnavailable,
      }),
    read: ({ home }) =>
      overConnection({
        body: (rows) => importedVocabulary({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: KnowledgeDomainStoreErrors.storeUnavailable,
      }),
  };
}
