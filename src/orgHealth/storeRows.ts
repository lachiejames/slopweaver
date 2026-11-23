/**
 * The Postgres half of the store-backed organisation-health lane. `./storePort.ts` and `./storeAcknowledgements.ts`
 * own every decision; this module only speaks SQL.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore` — the
 * checked entrance that refuses a missing selection, a remote host and a stale database — and every failure becomes
 * `STORE_UNAVAILABLE`, never an empty answer. A message here never carries the connection string: `connectStore`'s
 * own refusals are written to be printed, and a driver error is reduced to its own message.
 *
 * What is worth proving about the statements themselves — the two transactions, the compare-and-set, the CHECKs —
 * only a real database can prove. `src/__tests__/integration/orgHealthStore.test.ts` does, against a throwaway one.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import {
  ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID,
  ORG_HEALTH_INCIDENT_ID,
  ORG_HEALTH_SIGHTING_ID,
  orgHealthAcknowledgementTable,
  orgHealthIncidentTable,
  orgHealthSightingTable,
} from "../store/schema/orgHealth.js";
import { OrgHealthErrors, type OrgHealthStoreUnavailableError } from "./errors.js";
import { readAcknowledgementsImportFile, readSightingsImportFile, readSnapshotImportFile } from "./importFiles.js";
import { causeReason, type OrgHealthDocumentName, type OrgHealthRows, type OrgHealthStoreSeams } from "./storeSeams.js";

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not …"
 * @param statement the statement to run
 * @returns what it answered, or the refusal
 */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, OrgHealthStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    return err(OrgHealthErrors.storeUnavailable({ doing, reason: causeReason({ cause }) }));
  }
}

/** How a refusal names one singleton. */
function documentLabel({ name }: { name: OrgHealthDocumentName }): string {
  return name === "incident" ? "the incident snapshot" : "the incident sightings";
}

/** The singletons' import-insert over one open client: revision 1 unless a row already exists. */
function insertDocumentOver({ client }: { client: StoreClient }): OrgHealthRows["insertDocument"] {
  const incident = orgHealthIncidentTable;
  return ({ document, name }) =>
    attempt({
      doing: `import ${documentLabel({ name })}`,
      statement: async () => {
        if (name === "incident") {
          const rows = await client.db
            .insert(incident)
            .values({ document, id: ORG_HEALTH_INCIDENT_ID, revision: 1 })
            .onConflictDoNothing({ target: incident.id })
            .returning({ revision: incident.revision });
          return rows[0]?.revision;
        }
        const rows = await client.db
          .insert(orgHealthSightingTable)
          .values({ document, id: ORG_HEALTH_SIGHTING_ID, revision: 1 })
          .onConflictDoNothing({ target: orgHealthSightingTable.id })
          .returning({ revision: orgHealthSightingTable.revision });
        return rows[0]?.revision;
      },
    });
}

/** The measured publication over one open client: the snapshot's compare-and-set and the sightings, in ONE transaction. */
function publishMeasuredOver({ client }: { client: StoreClient }): OrgHealthRows["publishMeasured"] {
  const incident = orgHealthIncidentTable;
  return ({ expectedRevision, sightings, snapshot }) =>
    attempt({
      doing: "publish the measured incident snapshot and its sightings",
      statement: () =>
        client.db.transaction(async (tx) => {
          const moved = await tx
            .update(incident)
            .set({ document: snapshot, revision: sql`${incident.revision} + 1`, updatedAt: sql`now()` })
            .where(and(eq(incident.id, ORG_HEALTH_INCIDENT_ID), eq(incident.revision, expectedRevision)))
            .returning({ revision: incident.revision });
          const revision = moved[0]?.revision;
          if (revision === undefined) {
            return undefined;
          }
          // Upserted, so a sightings row whose import never ran still lands with the snapshot it belongs to.
          await tx
            .insert(orgHealthSightingTable)
            .values({ document: sightings, id: ORG_HEALTH_SIGHTING_ID, revision: 1 })
            .onConflictDoUpdate({
              set: {
                document: sightings,
                revision: sql`${orgHealthSightingTable.revision} + 1`,
                updatedAt: sql`now()`,
              },
              target: orgHealthSightingTable.id,
            });
          return revision;
        }),
    });
}

/** The singletons' statements over one open client: read, import-insert, compare-and-set and the publication. */
function documentRowsOver({
  client,
}: {
  client: StoreClient;
}): Pick<OrgHealthRows, "insertDocument" | "publishMeasured" | "readDocument" | "replaceIncident"> {
  const incident = orgHealthIncidentTable;
  const isTheSnapshot = eq(incident.id, ORG_HEALTH_INCIDENT_ID);
  return {
    insertDocument: insertDocumentOver({ client }),
    publishMeasured: publishMeasuredOver({ client }),
    readDocument: ({ name }) =>
      attempt({
        doing: `read ${documentLabel({ name })}`,
        statement: async () => {
          if (name === "incident") {
            const rows = await client.db
              .select({ document: incident.document, revision: incident.revision })
              .from(incident)
              .where(isTheSnapshot)
              .limit(1);
            return rows[0];
          }
          const rows = await client.db
            .select({ document: orgHealthSightingTable.document, revision: orgHealthSightingTable.revision })
            .from(orgHealthSightingTable)
            .where(eq(orgHealthSightingTable.id, ORG_HEALTH_SIGHTING_ID))
            .limit(1);
          return rows[0];
        },
      }),
    replaceIncident: ({ document, expectedRevision }) =>
      attempt({
        doing: "write the incident snapshot",
        statement: async () => {
          const rows = await client.db
            .update(incident)
            .set({ document, revision: sql`${incident.revision} + 1`, updatedAt: sql`now()` })
            .where(and(isTheSnapshot, eq(incident.revision, expectedRevision)))
            .returning({ revision: incident.revision });
          return rows[0]?.revision;
        },
      }),
  };
}

/** The ledger's import over one open client: the marker and, iff its insert landed, every press, in ONE transaction. */
function importAcknowledgementsOver({ client }: { client: StoreClient }): OrgHealthRows["importAcknowledgements"] {
  const ledger = orgHealthAcknowledgementTable;
  return ({ entries }) =>
    attempt({
      doing: "import the incident acknowledgements",
      statement: () =>
        client.db.transaction(async (tx) => {
          const claimed = await tx
            .insert(ledger)
            .values({ document: null, id: ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID, kind: "legacy-import" })
            .onConflictDoNothing({ target: ledger.id })
            .returning({ id: ledger.id });
          // No row back: another importer's marker is committed, and ITS rows are the ledger.
          if (claimed.length === 0 || entries.length === 0) {
            return undefined;
          }
          await tx
            .insert(ledger)
            .values(entries.map((entry) => ({ document: entry.row, id: entry.id, kind: "acknowledgement" })));
          return undefined;
        }),
    });
}

/** The ledger's statements over one open client: the marker, the import, the ordered read and one press. */
function acknowledgementRowsOver({
  client,
}: {
  client: StoreClient;
}): Pick<
  OrgHealthRows,
  "acknowledgementDocuments" | "acknowledgementsImported" | "importAcknowledgements" | "insertAcknowledgement"
> {
  const ledger = orgHealthAcknowledgementTable;
  return {
    acknowledgementDocuments: () =>
      attempt({
        doing: "read the incident acknowledgements",
        statement: async () => {
          const rows = await client.db
            .select({ document: ledger.document })
            .from(ledger)
            .where(eq(ledger.kind, "acknowledgement"))
            .orderBy(asc(ledger.position));
          return rows.map((row) => row.document);
        },
      }),
    acknowledgementsImported: () =>
      attempt({
        doing: "read the incident acknowledgements",
        statement: async () => {
          const rows = await client.db
            .select({ id: ledger.id })
            .from(ledger)
            .where(eq(ledger.id, ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID))
            .limit(1);
          return rows.length > 0;
        },
      }),
    importAcknowledgements: importAcknowledgementsOver({ client }),
    insertAcknowledgement: ({ document, id }) =>
      attempt({
        doing: "record the incident acknowledgement",
        statement: async () => {
          await client.db.insert(ledger).values({ document, id, kind: "acknowledgement" });
          return undefined;
        },
      }),
  };
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function orgHealthRowsOver({ client }: { client: StoreClient }): OrgHealthRows {
  return {
    ...documentRowsOver({ client }),
    ...acknowledgementRowsOver({ client }),
    close: () => client.close(),
  };
}

/**
 * Open the store a home selects, as the lane's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectOrgHealthRows({
  home,
}: {
  home: string;
}): Promise<Result<OrgHealthRows, OrgHealthStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(OrgHealthErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(orgHealthRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store, the real legacy files, and a random id per press.
 *
 * @returns the seams `orgHealthPort()` runs over
 */
export function productionOrgHealthStoreSeams(): OrgHealthStoreSeams {
  return {
    connect: connectOrgHealthRows,
    newId: () => randomUUID(),
    readAcknowledgementsFile: readAcknowledgementsImportFile,
    readSightingsFile: readSightingsImportFile,
    readSnapshotFile: readSnapshotImportFile,
  };
}
