/**
 * The store-backed organisation-health lane: the `org_health_incident` and `org_health_sighting` singletons and the
 * `org_health_acknowledgement` ledger are the authority, each imported ONCE from its legacy file under
 * `$SLOPWEAVER_HOME/org-health/`, and never read from a file again.
 *
 * This module is the ORCHESTRATION and nothing else — the shape `../fleet/storePort.ts` established. Every effect
 * arrives through `./storeSeams.ts`, so a unit test drives every branch over a plain in-memory fake
 * (`src/__tests__/orgHealthStoreFixture.ts`; a seam, not a mock). The Postgres half is `./storeRows.ts`; what only a
 * real database can prove — the CHECKs, the transactions and the compare-and-set — is the opt-in
 * `src/__tests__/integration/orgHealthStore.test.ts`. The ledger's half is `./storeAcknowledgements.ts`.
 *
 * ## A store outage is a refusal, never a file
 *
 * No selection, a stale database, an unreachable one, a failed statement: every one is `STORE_UNAVAILABLE`, and NONE
 * of them falls back to the legacy files. A snapshot read off a file that stopped being the authority is how the
 * monitor would call an outage quiet.
 *
 * ## The one-time imports
 *
 * A read finding no row consults the legacy file, and only then. Its value — or `null` when there is no file — is
 * inserted at revision 1 with `ON CONFLICT DO NOTHING` and the row read back, so a concurrent importer's row wins and
 * a file that appears later is never consulted. A damaged file inserts nothing and is refused, so it can be repaired.
 *
 * {@link beginRead} finding no snapshot row inserts its marker and never consults `incidents.json`: a read starting
 * supersedes whatever the file held, which is also how a damaged one stops mattering.
 *
 * ## Compare-and-set, never a retry
 *
 * A read's generation is the revision its marker committed at. Its outcome replaces the snapshot `WHERE revision = N`,
 * and a measured one replaces the sightings in that same transaction. No row back is `REVISION_CONFLICT`: a newer
 * read has started, its outcome is the one that counts, and nothing replays this one.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type OrgHealthError, OrgHealthErrors, type OrgHealthStoreUnavailableError } from "./errors.js";
import type { IncidentReadGeneration, IncidentReadOutcome, OrgHealthPort } from "./port.js";
import type { IncidentSightings } from "./sightings.js";
import { decodeIncidentSightings, decodeIncidentSnapshot } from "./snapshot.js";
import { appendAcknowledgementWith, readAcknowledgementsWith } from "./storeAcknowledgements.js";
import {
  type OrgHealthDocumentName,
  type OrgHealthRows,
  type OrgHealthStoreSeams,
  type StoredOrgHealthDocument,
  withOrgHealthRows,
} from "./storeSeams.js";
import type { IncidentSnapshot, UnmeasurableIncidentSnapshot } from "./types.js";

/** How each document is named in a refusal. */
const DOCUMENT_LABEL: Readonly<Record<OrgHealthDocumentName, string>> = {
  incident: "incident snapshot",
  sightings: "incident sightings",
};

/**
 * The sightings as stored: the same versioned envelope the file held, so one codec reads both.
 *
 * @param sightings the memory a complete read leaves
 * @returns the document
 */
export function sightingsDocument({ sightings }: { sightings: IncidentSightings }): unknown {
  return { schemaVersion: 1, sightings };
}

/**
 * The value a document's one-time import stores: the legacy file's, or `null` when there is no file.
 *
 * @param home the Slopweaver home
 * @param name which document
 * @param seams the legacy file reads
 * @returns the value to insert, or why the file there cannot be trusted
 */
function fileDocument({
  home,
  name,
  seams,
}: {
  home: string;
  name: OrgHealthDocumentName;
  seams: OrgHealthStoreSeams;
}): Result<unknown, OrgHealthError> {
  if (name === "incident") {
    return seams.readSnapshotFile({ home }).map((snapshot) => {
      if (snapshot === undefined) {
        return null;
      }
      return snapshot;
    });
  }
  return seams
    .readSightingsFile({ home })
    .map((sightings) => (sightings === undefined ? null : sightingsDocument({ sightings })));
}

/**
 * One singleton row as it stands, importing its legacy file first when the store holds no row.
 *
 * @param home the Slopweaver home
 * @param name which document
 * @param rows the open connection's row operations
 * @param seams the legacy file reads
 * @returns the committed row, or the refusal
 */
async function importedDocument({
  home,
  name,
  rows,
  seams,
}: {
  home: string;
  name: OrgHealthDocumentName;
  rows: OrgHealthRows;
  seams: OrgHealthStoreSeams;
}): Promise<Result<StoredOrgHealthDocument, OrgHealthError>> {
  const stored = await rows.readDocument({ name });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return ok(stored.value);
  }
  const document = fileDocument({ home, name, seams });
  if (document.isErr()) {
    // A concurrent importer may have committed between the first read and this file's, and then its row is the
    // document and the file's damage is no longer this read's business.
    const committed = await rows.readDocument({ name });
    if (committed.isErr()) {
      return err(committed.error);
    }
    if (committed.value !== undefined) {
      return ok(committed.value);
    }
    return err(document.error);
  }
  const inserted = await rows.insertDocument({ document: document.value, name });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  // Re-read whether or not this insert won: a lost one means another importer's row is the document, and a won one
  // may already have been overtaken by a read's marker, so the committed row answers either way.
  const winner = await rows.readDocument({ name });
  if (winner.isErr()) {
    return err(winner.error);
  }
  if (winner.value === undefined) {
    return err(
      OrgHealthErrors.storeUnavailable({
        doing: `import the ${DOCUMENT_LABEL[name]}`,
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return ok(winner.value);
}

/**
 * Decode a stored snapshot row.
 *
 * @param row the row as stored
 * @returns the snapshot, `null` when the row holds none, or why the row is unusable
 */
function snapshotOfRow({ row }: { row: StoredOrgHealthDocument }): Result<IncidentSnapshot | null, OrgHealthError> {
  if (row.document === null) {
    return ok(null);
  }
  return decodeIncidentSnapshot({ value: row.document }).mapErr((issues) =>
    OrgHealthErrors.storedInvalid({ detail: issues.join("; "), what: DOCUMENT_LABEL.incident }),
  );
}

/**
 * Decode a stored sightings row.
 *
 * @param row the row as stored
 * @returns the sightings, `undefined` when the row holds none, or why the row is unusable
 */
function sightingsOfRow({
  row,
}: {
  row: StoredOrgHealthDocument;
}): Result<IncidentSightings | undefined, OrgHealthError> {
  if (row.document === null) {
    return ok(undefined);
  }
  return decodeIncidentSightings({ value: row.document }).mapErr((issues) =>
    OrgHealthErrors.storedInvalid({ detail: issues.join("; "), what: DOCUMENT_LABEL.sightings }),
  );
}

/**
 * Compare-and-set the marker over the snapshot, inserting it when there is no row at all.
 *
 * @param marker the under-way snapshot
 * @param rows the open connection's row operations
 * @returns the generation the marker committed at, or the conflict that stopped it
 */
async function beginRead({
  marker,
  rows,
}: {
  marker: UnmeasurableIncidentSnapshot;
  rows: OrgHealthRows;
}): Promise<Result<IncidentReadGeneration, OrgHealthError>> {
  let stored = await rows.readDocument({ name: "incident" });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value === undefined) {
    const inserted = await rows.insertDocument({ document: marker, name: "incident" });
    if (inserted.isErr()) {
      return err(inserted.error);
    }
    if (inserted.value !== undefined) {
      return ok({ revision: inserted.value });
    }
    // Another writer's row landed first: the marker goes over it by compare-and-set, once.
    stored = await rows.readDocument({ name: "incident" });
    if (stored.isErr()) {
      return err(stored.error);
    }
  }
  // `0` names "expected a row that is not there" — never a real revision, which starts at 1.
  let expectedRevision = 0;
  if (stored.value !== undefined) {
    expectedRevision = stored.value.revision;
  }
  const replaced = await rows.replaceIncident({ document: marker, expectedRevision });
  if (replaced.isErr()) {
    return err(replaced.error);
  }
  if (replaced.value === undefined) {
    return err(OrgHealthErrors.revisionConflict({ expectedRevision }));
  }
  return ok({ revision: replaced.value });
}

/**
 * Publish one read's outcome against the generation it holds.
 *
 * @param generation the revision its marker committed at
 * @param outcome how the read ended
 * @param rows the open connection's row operations
 * @returns nothing once committed, or the conflict that stopped it
 */
async function finishRead({
  generation,
  outcome,
  rows,
}: {
  generation: IncidentReadGeneration;
  outcome: IncidentReadOutcome;
  rows: OrgHealthRows;
}): Promise<Result<void, OrgHealthError>> {
  const expectedRevision = generation.revision;
  let committed: Result<number | undefined, OrgHealthStoreUnavailableError>;
  if (outcome.state === "measured") {
    committed = await rows.publishMeasured({
      expectedRevision,
      sightings: sightingsDocument({ sightings: outcome.sightings }),
      snapshot: outcome.snapshot,
    });
  } else {
    committed = await rows.replaceIncident({ document: outcome.snapshot, expectedRevision });
  }
  if (committed.isErr()) {
    return err(committed.error);
  }
  if (committed.value === undefined) {
    return err(OrgHealthErrors.revisionConflict({ expectedRevision }));
  }
  return ok(undefined);
}

/**
 * An organisation-health port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionOrgHealthStoreSeams`
 * @returns the port
 */
export function storeOrgHealthPort({ seams }: { seams: OrgHealthStoreSeams }): OrgHealthPort {
  const over = <T>({
    home,
    body,
  }: {
    home: string;
    body: (rows: OrgHealthRows) => Promise<Result<T, OrgHealthError>>;
  }): Promise<Result<T, OrgHealthError>> =>
    withOrgHealthRows({ body, home, seams, unavailable: OrgHealthErrors.storeUnavailable });
  return {
    appendAcknowledgement: ({ home, row }) => appendAcknowledgementWith({ home, row, seams }),
    beginRead: ({ home, marker }) => over({ body: (rows) => beginRead({ marker, rows }), home }),
    finishRead: ({ generation, home, outcome }) =>
      over({ body: (rows) => finishRead({ generation, outcome, rows }), home }),
    readAcknowledgements: ({ home }) => readAcknowledgementsWith({ home, seams }),
    readSightings: ({ home }) =>
      over({
        body: async (rows) =>
          (await importedDocument({ home, name: "sightings", rows, seams })).andThen((row) => sightingsOfRow({ row })),
        home,
      }),
    readSnapshot: ({ home }) =>
      over({
        body: async (rows) =>
          (await importedDocument({ home, name: "incident", rows, seams })).andThen((row) => snapshotOfRow({ row })),
        home,
      }),
  };
}
