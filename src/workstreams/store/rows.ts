/**
 * The Postgres half of the store-backed workstream register: open the store and run each operation in its own
 * transaction. `./port.ts` owns every decision.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote host
 * and a stale database — and every failure becomes `WORKSTREAM_STORE_UNAVAILABLE`, never an empty answer. A message
 * here never carries the connection string: `connectStore`'s refusals are written to be printed, and a driver error
 * is reduced to its own message.
 *
 * A read takes all six tables in ONE `read only`, `repeatable read` transaction, the shape
 * `src/store/transfer/bundleWrite.ts` proved: a writer replaces a workstream's children by deleting and reinserting
 * them, so a reader assembling across statements at the default isolation could see a parent from one revision and
 * children from another — a workstream that never existed. What only a real database can prove (the predicates, the
 * locks, the races) `src/__tests__/integration/workstreamStore.test.ts` does, against a throwaway one.
 */
import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../../store/client.js";
import {
  workstreamEntryTable,
  workstreamLinkTable,
  workstreamMilestoneAfterTable,
  workstreamMilestoneTable,
  workstreamRegisterMetaTable,
  workstreamTable,
} from "../../store/schema.js";

import { deleteWorkstreamIn, writeAggregateIn } from "./aggregateWrite.js";
import { applyWorkstreamBatch } from "./batchWrite.js";
import { WorkstreamStoreErrors, type WorkstreamStoreUnavailableError } from "./errors.js";
import { writeMetaIn } from "./metaWrite.js";
import { describeStoreCause, type WorkstreamRows, type WorkstreamStoreSeams } from "./port.js";

/**
 * Run one statement or transaction, turning a throw into the typed store refusal.
 *
 * @param doing what it was for, finishing "the store could not …"
 * @returns its answer, or the refusal
 */
async function attempt<Answer>({
  doing,
  run,
}: {
  doing: string;
  run: () => Promise<Answer>;
}): Promise<Result<Answer, WorkstreamStoreUnavailableError>> {
  try {
    return ok(await run());
  } catch (cause) {
    return err(WorkstreamStoreErrors.unavailable({ doing, reason: describeStoreCause({ cause }) }));
  }
}

/**
 * The register's statements over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function workstreamRowsOver({ client }: { client: StoreClient }): WorkstreamRows {
  return {
    applyBatch: (request) =>
      attempt({
        doing: "write the workstream batch",
        run: () => applyWorkstreamBatch({ db: client.db, request }),
      }),
    close: () => client.close(),
    deleteWorkstream: ({ expectedRevision, workstreamId }) =>
      attempt({
        doing: `delete workstream ${workstreamId}`,
        run: () => client.db.transaction((writer) => deleteWorkstreamIn({ expectedRevision, workstreamId, writer })),
      }),
    readAll: () =>
      attempt({
        doing: "read the workstream register",
        run: () =>
          client.db.transaction(
            async (reader) => ({
              edges: await reader.select().from(workstreamMilestoneAfterTable),
              entries: await reader.select().from(workstreamEntryTable),
              links: await reader.select().from(workstreamLinkTable),
              meta: await reader.select().from(workstreamRegisterMetaTable),
              milestones: await reader.select().from(workstreamMilestoneTable),
              workstreams: await reader.select().from(workstreamTable),
            }),
            { accessMode: "read only", isolationLevel: "repeatable read" },
          ),
      }),
    writeAggregate: ({ aggregate, expectedRevision }) =>
      attempt({
        doing: `write workstream ${aggregate.id}`,
        run: () => client.db.transaction((writer) => writeAggregateIn({ aggregate, expectedRevision, writer })),
      }),
    writeMeta: ({ document, expectedRevision }) =>
      attempt({
        doing: "write the workstream register document",
        run: () => writeMetaIn({ document, expectedRevision, writer: client.db }),
      }),
  };
}

/**
 * The production seams: the real store a home selects.
 *
 * @returns the seams `workstreamStore` runs over
 */
export function productionWorkstreamStoreSeams(): WorkstreamStoreSeams {
  return {
    connect: async ({ home }) => {
      const client = await connectStore({ home });
      if (client.isErr()) {
        return err(WorkstreamStoreErrors.unavailable({ doing: "be opened", reason: client.error.message }));
      }
      return ok(workstreamRowsOver({ client: client.value }));
    },
  };
}
