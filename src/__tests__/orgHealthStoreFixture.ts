/**
 * An in-memory organisation-health store for unit tests: the REAL store-backed port (`src/orgHealth/storePort.ts`)
 * over plain objects standing in for the `org_health_incident`, `org_health_sighting` and
 * `org_health_acknowledgement` rows, with the real legacy-file reads. A seam, not a mock (`.claude/rules/testing.md`):
 * nothing is stubbed out of a module, a plain object of functions is passed where the production one would be.
 *
 * Because the legacy reads are the real file edge, a test that seeds `org-health/incidents.json`, `sightings.json` or
 * `acknowledgements.jsonl` under its throwaway home sees exactly what an install with an empty store sees: the first
 * read imports it once. What this cannot prove is anything Postgres decides — the opt-in
 * `integration/orgHealthStore.test.ts` covers that.
 */
import { randomUUID } from "node:crypto";

import { err, ok } from "../lib/result.js";
import { AcknowledgementErrors } from "../orgHealth/acknowledgementErrors.js";
import { OrgHealthErrors } from "../orgHealth/errors.js";
import {
  readAcknowledgementsImportFile,
  readSightingsImportFile,
  readSnapshotImportFile,
} from "../orgHealth/importFiles.js";
import type { OrgHealthPort } from "../orgHealth/port.js";
import type { IncidentSightings } from "../orgHealth/sightings.js";
import { sightingsDocument, storeOrgHealthPort } from "../orgHealth/storePort.js";
import type { OrgHealthRows, OrgHealthStoreSeams, StoredOrgHealthDocument } from "../orgHealth/storeSeams.js";
import type { IncidentSnapshot } from "../orgHealth/types.js";

/**
 * One home's rows. `acknowledgements` holds the ledger in position order, the marker row included.
 *
 * @internal — reached as {@link MemoryOrgHealthStore.homes}.
 */
export interface MemoryOrgHealthHome {
  incident: StoredOrgHealthDocument | undefined;
  sightings: StoredOrgHealthDocument | undefined;
  readonly acknowledgements: { readonly id: string; readonly kind: string; readonly document: unknown }[];
}

/** The in-memory store: one slot per home, a count of the connections opened and closed, and an injected failure. */
export interface MemoryOrgHealthStore {
  readonly homes: Map<string, MemoryOrgHealthHome>;
  opened: number;
  closed: number;
  /** When set, the next measured publication fails AFTER its snapshot update, so its transaction rolls back whole. */
  failNextPublish: boolean;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for any home
 */
export function memoryOrgHealthStore(): MemoryOrgHealthStore {
  return { closed: 0, failNextPublish: false, homes: new Map(), opened: 0 };
}

/** One home's slot, made empty on first use. */
function slotOf({ home, store }: { home: string; store: MemoryOrgHealthStore }): MemoryOrgHealthHome {
  const existing = store.homes.get(home);
  if (existing !== undefined) {
    return existing;
  }
  const made: MemoryOrgHealthHome = { acknowledgements: [], incident: undefined, sightings: undefined };
  store.homes.set(home, made);
  return made;
}

/** The marker row's id, as the schema names it. */
const MARKER_ID = "legacy-v1";

/**
 * The row operations over one home's slot, with the same insert-if-absent, compare-and-set, one-transaction and
 * marker-gated semantics the Postgres statements have.
 *
 * @param home which slot this connection addresses
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ home, store }: { home: string; store: MemoryOrgHealthStore }): OrgHealthRows {
  const slot = slotOf({ home, store });
  return {
    ...memoryLedgerRows({ slot }),
    ...memoryDocumentRows({ slot, store }),
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
  };
}

/** The ledger's operations over one home's slot: marker-gated import, the ordered read and one press. */
function memoryLedgerRows({
  slot,
}: {
  slot: MemoryOrgHealthHome;
}): Pick<
  OrgHealthRows,
  "acknowledgementDocuments" | "acknowledgementsImported" | "importAcknowledgements" | "insertAcknowledgement"
> {
  return {
    acknowledgementDocuments: () =>
      Promise.resolve(
        ok(
          structuredClone(
            slot.acknowledgements.filter((row) => row.kind === "acknowledgement").map((row) => row.document),
          ),
        ),
      ),
    acknowledgementsImported: () => Promise.resolve(ok(slot.acknowledgements.some((row) => row.id === MARKER_ID))),
    importAcknowledgements: ({ entries }) => {
      if (!slot.acknowledgements.some((row) => row.id === MARKER_ID)) {
        slot.acknowledgements.push({ document: null, id: MARKER_ID, kind: "legacy-import" });
        for (const entry of entries) {
          slot.acknowledgements.push({ document: structuredClone(entry.row), id: entry.id, kind: "acknowledgement" });
        }
      }
      return Promise.resolve(ok(undefined));
    },
    insertAcknowledgement: ({ document, id }) => {
      slot.acknowledgements.push({ document: structuredClone(document), id, kind: "acknowledgement" });
      return Promise.resolve(ok(undefined));
    },
  };
}

/** The singletons' operations over one home's slot: insert-if-absent, compare-and-set and the one-transaction publish. */
function memoryDocumentRows({
  slot,
  store,
}: {
  slot: MemoryOrgHealthHome;
  store: MemoryOrgHealthStore;
}): Pick<OrgHealthRows, "insertDocument" | "publishMeasured" | "readDocument" | "replaceIncident"> {
  return {
    insertDocument: ({ document, name }) => {
      const current = name === "incident" ? slot.incident : slot.sightings;
      if (current !== undefined) {
        return Promise.resolve(ok(undefined));
      }
      const row = { document: structuredClone(document), revision: 1 };
      if (name === "incident") {
        slot.incident = row;
      } else {
        slot.sightings = row;
      }
      return Promise.resolve(ok(1));
    },
    publishMeasured: ({ expectedRevision, sightings, snapshot }) => {
      if (slot.incident?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      if (store.failNextPublish) {
        store.failNextPublish = false;
        return Promise.resolve(
          err(OrgHealthErrors.storeUnavailable({ doing: "publish", reason: "a fixture failure mid-transaction" })),
        );
      }
      slot.incident = { document: structuredClone(snapshot), revision: expectedRevision + 1 };
      let sightingsRevision = 1;
      if (slot.sightings !== undefined) {
        sightingsRevision = slot.sightings.revision + 1;
      }
      slot.sightings = { document: structuredClone(sightings), revision: sightingsRevision };
      return Promise.resolve(ok(slot.incident.revision));
    },
    readDocument: ({ name }) => {
      let row = slot.sightings;
      if (name === "incident") {
        row = slot.incident;
      }
      return Promise.resolve(ok(structuredClone(row)));
    },
    replaceIncident: ({ document, expectedRevision }) => {
      if (slot.incident?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      slot.incident = { document: structuredClone(document), revision: expectedRevision + 1 };
      return Promise.resolve(ok(slot.incident.revision));
    },
  };
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @returns the seams
 */
export function memoryOrgHealthSeams({ store }: { store: MemoryOrgHealthStore }): OrgHealthStoreSeams {
  return {
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ home, store })));
    },
    newId: () => randomUUID(),
    readAcknowledgementsFile: readAcknowledgementsImportFile,
    readSightingsFile: readSightingsImportFile,
    readSnapshotFile: readSnapshotImportFile,
  };
}

/**
 * The store-backed port over a fresh in-memory store — the drop-in for `orgHealthPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect it; a fresh one otherwise
 * @returns the port
 */
export function memoryOrgHealthPort({
  store = memoryOrgHealthStore(),
}: { store?: MemoryOrgHealthStore } = {}): OrgHealthPort {
  return storeOrgHealthPort({ seams: memoryOrgHealthSeams({ store }) });
}

/**
 * Seed one home's snapshot row directly, as a read before this test would have published it.
 *
 * @param home the home whose row is seeded
 * @param snapshot the snapshot to hold
 * @param store the in-memory store
 */
export function seedOrgHealthSnapshot({
  home,
  snapshot,
  store,
}: {
  home: string;
  snapshot: IncidentSnapshot;
  store: MemoryOrgHealthStore;
}): void {
  const slot = slotOf({ home, store });
  let revision = 1;
  if (slot.incident !== undefined) {
    revision = slot.incident.revision + 1;
  }
  slot.incident = { document: structuredClone(snapshot), revision };
}

/**
 * Seed one home's sightings row directly, as a complete read before this test would have left it.
 *
 * @param home the home whose row is seeded
 * @param sightings the memory to hold
 * @param store the in-memory store
 */
export function seedOrgHealthSightings({
  home,
  sightings,
  store,
}: {
  home: string;
  sightings: IncidentSightings;
  store: MemoryOrgHealthStore;
}): void {
  slotOf({ home, store }).sightings = { document: sightingsDocument({ sightings }), revision: 1 };
}

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableOrgHealthPort(): OrgHealthPort {
  const doing = "be opened";
  const reason = "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)";
  const outage = OrgHealthErrors.storeUnavailable({ doing, reason });
  const ledgerOutage = AcknowledgementErrors.storeUnavailable({ doing, reason });
  return {
    appendAcknowledgement: () => Promise.resolve(err(ledgerOutage)),
    beginRead: () => Promise.resolve(err(outage)),
    finishRead: () => Promise.resolve(err(outage)),
    readAcknowledgements: () => Promise.resolve(err(ledgerOutage)),
    readSightings: () => Promise.resolve(err(outage)),
    readSnapshot: () => Promise.resolve(err(outage)),
  };
}
