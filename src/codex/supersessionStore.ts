/**
 * The production edges of the supersession register — the effectful half of {@link ./supersession}: the
 * `codex_supersession` statements, the strict read of the old `codex-supersessions.jsonl` its one-time import
 * consults, and the factory a composition root calls. `./supersessionPort.ts` owns every decision; this module
 * only speaks SQL and reads one file.
 *
 * Insert-only, and deliberately NOT an edit to the pass record it retires. Every run directory under
 * `orchestration/` is immutable and written by exactly one process, which is what makes the ledger safe to
 * scan while other sessions write; rewriting one to mark it retired would give that up for nothing. A row
 * beside them keeps both properties: the pass is still there to read, and the retirement is still there to see.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database — and every failure becomes `SUPERSESSION_STORE_UNAVAILABLE`, never an empty
 * answer. Only a composition root calls {@link supersessionPort}: `SLOPWEAVER_STORE_URL` overrides the home's
 * own selection, so a test that forgot to inject a port could otherwise reach a real store.
 */
import { asc, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import { type ImportSource, readJsonlImportSource, storeStep } from "../store/registerImport.js";
import { importOnceRowsOver } from "../store/registerImportRows.js";
import { codexSupersessionTable } from "../store/schema/codexSupersession.js";

import type { Supersession } from "./supersession.js";
import {
  type SupersessionStoreError,
  SupersessionStoreErrors,
  type SupersessionStoreUnavailableError,
} from "./supersessionErrors.js";
import {
  decodeSupersession,
  foldImportedSupersessions,
  type StoredSupersession,
  type SupersessionPort,
  type SupersessionRows,
  type SupersessionSeams,
  storeSupersessionPort,
  supersessionColumns,
} from "./supersessionPort.js";

/** The columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = {
  artifactId: codexSupersessionTable.artifactId,
  atIso: codexSupersessionTable.atIso,
  branch: codexSupersessionTable.branch,
  kind: codexSupersessionTable.kind,
  mode: codexSupersessionTable.mode,
  pass: codexSupersessionTable.pass,
  propertyId: codexSupersessionTable.propertyId,
  reason: codexSupersessionTable.reason,
  replacedBy: codexSupersessionTable.replacedBy,
};

/**
 * One retirement as an insert takes it.
 *
 * @param row the retirement
 * @returns the row values
 */
function supersessionValues({ row }: { row: Supersession }): typeof codexSupersessionTable.$inferInsert {
  const columns: StoredSupersession = supersessionColumns({ row });
  return {
    artifactId: columns.artifactId,
    atIso: columns.atIso,
    branch: columns.branch,
    kind: row.kind === "no-tree" ? "no-tree" : "wording",
    mode: row.kind === "no-tree" ? row.mode : null,
    pass: columns.pass,
    propertyId: columns.propertyId,
    reason: columns.reason,
    replacedBy: columns.replacedBy,
  };
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function supersessionRowsOver({ client }: { client: StoreClient }): SupersessionRows {
  return {
    ...importOnceRowsOver<Supersession>({
      client,
      insertRecords: async ({ tx, records }) => {
        const folded = foldImportedSupersessions({ records });
        if (folded.length === 0) {
          return;
        }
        await tx
          .insert(codexSupersessionTable)
          .values(folded.map((row) => supersessionValues({ row })))
          .onConflictDoNothing({ target: codexSupersessionTable.artifactId });
      },
      register: "codex-supersessions",
      table: codexSupersessionTable,
    }),
    close: () => client.close(),
    insert: ({ row }) =>
      storeStep({
        doing: "record a retirement",
        statement: async () => {
          const rows = await client.db
            .insert(codexSupersessionTable)
            .values(supersessionValues({ row }))
            .onConflictDoNothing({ target: codexSupersessionTable.artifactId })
            .returning(RETURNED);
          return rows[0];
        },
      }),
    readAll: () =>
      storeStep({
        doing: "read the supersession register",
        statement: () =>
          client.db.select(RETURNED).from(codexSupersessionTable).orderBy(asc(codexSupersessionTable.artifactId)),
      }),
    readArtifact: ({ artifactId }) =>
      storeStep({
        doing: "read a recorded retirement",
        statement: async () => {
          const rows = await client.db
            .select(RETURNED)
            .from(codexSupersessionTable)
            .where(eq(codexSupersessionTable.artifactId, artifactId))
            .limit(1);
          return rows[0];
        },
      }),
  };
}

/**
 * Open the store a home selects, as the register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or the store's own refusal
 */
async function connectSupersessionRows({
  home,
}: {
  home: string;
}): Promise<Result<SupersessionRows, SupersessionStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(SupersessionStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(supersessionRowsOver({ client: client.value }));
}

/**
 * The strict read of the old `codex-supersessions.jsonl`, for its one-time import.
 *
 * @param home the Slopweaver home it lived under
 * @returns its retirements in file order, `absent`, or the refusal naming the bad line
 */
export function readSupersessionImportFile({
  home,
}: {
  home: string;
}): Result<ImportSource<Supersession>, SupersessionStoreError> {
  return readJsonlImportSource({
    decodeLine: (value) => decodeSupersession({ value }).mapErr((problem) => problem.message),
    path: stateHomePaths({ home }).codexSupersessionsJsonl,
  }).mapErr((problem) => SupersessionStoreErrors.importProblem({ problem }));
}

/**
 * The production seams: the real store and the real old file.
 *
 * @returns the seams {@link supersessionPort} runs over
 */
export function productionSupersessionSeams(): SupersessionSeams {
  return { connect: connectSupersessionRows, readImportFile: readSupersessionImportFile };
}

/**
 * The port this install's supersession register is reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function supersessionPort(): SupersessionPort {
  return storeSupersessionPort({ seams: productionSupersessionSeams() });
}
