/**
 * The production edges of this install's own knowledge domains: the `knowledge_domain` statements, the strict
 * read of the retired `knowledge/domains.json` its one-time import consults, and the factory a composition root
 * calls. `./domainPort.ts` owns every decision; this module only speaks SQL and reads one file.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database — and every failure becomes `KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE`, never an empty
 * vocabulary. Only a composition root calls {@link knowledgeDomainPort}: `SLOPWEAVER_STORE_URL` overrides the
 * home's own selection, so a test that forgot to inject a port could otherwise reach a real store.
 */
import { asc } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient, type StoreWriter } from "../store/client.js";
import { type ImportSource, readJsonImportSource, storeStep } from "../store/registerImport.js";
import { importOnceRowsOver } from "../store/registerImportRows.js";
import { knowledgeDomainTable } from "../store/schema/knowledgeDomain.js";

import {
  type InsertAllOutcome,
  type KnowledgeDomainPort,
  type KnowledgeDomainRows,
  type KnowledgeDomainSeams,
  storeKnowledgeDomainPort,
} from "./domainPort.js";
import { type KnowledgeDomainStoreError, KnowledgeDomainStoreErrors } from "./domainStoreErrors.js";
import { decodeInstallDomainsDocument, type InstallDomainRecord } from "./installDomains.js";

/** The columns every read returns. */
const RETURNED = {
  foldsInto: knowledgeDomainTable.foldsInto,
  holds: knowledgeDomainTable.holds,
  kind: knowledgeDomainTable.kind,
  slug: knowledgeDomainTable.slug,
};

/**
 * One record as an insert takes it.
 *
 * @param record the domain or alias
 * @returns the row values
 */
function domainValues({ record }: { record: InstallDomainRecord }): typeof knowledgeDomainTable.$inferInsert {
  if (record.kind === "domain") {
    return { foldsInto: null, holds: record.holds, kind: "domain", slug: record.slug };
  }
  return { foldsInto: record.foldsInto, holds: null, kind: "alias", slug: record.slug };
}

/**
 * Records in code-point order of their slug: one fixed order every writer shares, independent of locale.
 *
 * @param records what an insert is about to write
 * @returns the same records, sorted by slug
 */
export function slugOrdered({ records }: { records: readonly InstallDomainRecord[] }): readonly InstallDomainRecord[] {
  return records.toSorted((left, right) => {
    if (left.slug === right.slug) {
      return 0;
    }
    return left.slug < right.slug ? -1 : 1;
  });
}

/**
 * Insert records, skipping any slug already held — in slug order, whatever order they arrive in.
 *
 * The order is what keeps two racing adds from deadlocking. A multi-row insert takes each slug's key lock in
 * VALUES order, and an add writes its domain before its aliases, so `foo` + alias `bar` racing `bar` + alias
 * `foo` would each hold one slug and wait on the other. Postgres would then abort one as a deadlock, which reads
 * as an outage rather than the conflict it is. Sorted, both take `bar` first: the later one waits, then finds
 * both slugs taken and refuses as a conflict naming them.
 *
 * @param tx the transaction
 * @param records what to insert
 * @returns the slugs that went in
 */
async function insertSkippingTaken({
  tx,
  records,
}: {
  tx: StoreWriter;
  records: readonly InstallDomainRecord[];
}): Promise<readonly string[]> {
  if (records.length === 0) {
    return [];
  }
  const inserted = await tx
    .insert(knowledgeDomainTable)
    .values(slugOrdered({ records }).map((record) => domainValues({ record })))
    .onConflictDoNothing({ target: knowledgeDomainTable.slug })
    .returning({ slug: knowledgeDomainTable.slug });
  return inserted.map((row) => row.slug);
}

/** Thrown inside the add's transaction to roll it back: a Drizzle callback that returns COMMITS. */
class SlugsTaken extends Error {
  readonly taken: readonly string[];

  constructor({ taken }: { taken: readonly string[] }) {
    super(`slugs already held: ${taken.join(", ")}`);
    this.taken = taken;
  }
}

/**
 * The add's compare-and-set: every record in one transaction, rolled back unless every slug went in.
 *
 * @param client the open store connection
 * @param records the domain and its aliases
 * @returns whether they went in, naming the slugs another writer held when they did not
 */
async function insertAllOrNone({
  client,
  records,
}: {
  client: StoreClient;
  records: readonly InstallDomainRecord[];
}): Promise<InsertAllOutcome> {
  try {
    await client.db.transaction(async (tx) => {
      const went = new Set(await insertSkippingTaken({ records, tx }));
      const taken = records.map((record) => record.slug).filter((slug) => !went.has(slug));
      if (taken.length > 0) {
        throw new SlugsTaken({ taken });
      }
    });
  } catch (cause) {
    if (cause instanceof SlugsTaken) {
      return { inserted: false, taken: cause.taken };
    }
    throw cause;
  }
  return { inserted: true };
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function knowledgeDomainRowsOver({ client }: { client: StoreClient }): KnowledgeDomainRows {
  return {
    ...importOnceRowsOver<InstallDomainRecord>({
      client,
      insertRecords: async ({ tx, records }) => {
        await insertSkippingTaken({ records, tx });
      },
      register: "knowledge-domains",
      table: knowledgeDomainTable,
    }),
    close: () => client.close(),
    insertAll: ({ records }) =>
      storeStep({ doing: "add a knowledge domain", statement: () => insertAllOrNone({ client, records }) }),
    readAll: () =>
      storeStep({
        doing: "read this install's knowledge domains",
        statement: () => client.db.select(RETURNED).from(knowledgeDomainTable).orderBy(asc(knowledgeDomainTable.slug)),
      }),
  };
}

/**
 * Open the store a home selects, as the vocabulary's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or the store's own refusal
 */
async function connectKnowledgeDomainRows({
  home,
}: {
  home: string;
}): Promise<Result<KnowledgeDomainRows, KnowledgeDomainStoreError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(KnowledgeDomainStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(knowledgeDomainRowsOver({ client: client.value }));
}

/**
 * The strict read of the retired `knowledge/domains.json`, for its one-time import.
 *
 * @param home the Slopweaver home it lived under
 * @returns one record per domain and alias, `absent`, or the refusal naming every problem
 */
function readKnowledgeDomainImportFile({
  home,
}: {
  home: string;
}): Result<ImportSource<InstallDomainRecord>, KnowledgeDomainStoreError> {
  return readJsonImportSource({
    decodeDocument: (value) => decodeInstallDomainsDocument({ value }),
    path: stateHomePaths({ home }).knowledgeDomainsJson,
  }).mapErr((problem) => KnowledgeDomainStoreErrors.importProblem({ problem }));
}

/**
 * The production seams: the real store and the real retired file.
 *
 * @returns the seams {@link knowledgeDomainPort} runs over
 */
export function productionKnowledgeDomainSeams(): KnowledgeDomainSeams {
  return { connect: connectKnowledgeDomainRows, readImportFile: readKnowledgeDomainImportFile };
}

/**
 * The port this install's own knowledge domains are reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function knowledgeDomainPort(): KnowledgeDomainPort {
  return storeKnowledgeDomainPort({ seams: productionKnowledgeDomainSeams() });
}
