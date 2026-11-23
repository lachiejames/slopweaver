/**
 * An in-memory `knowledge_domain` store: the seams `storeKnowledgeDomainPort` runs over, kept as plain arrays so a
 * unit test drives every branch of the port — the one-time import, the marker, the all-or-nothing add and every
 * refusal — with no database and no mock. A seam, not a mock: the fake keeps the same invariants the Postgres half
 * keeps (the slug is unique across domains and aliases, an import skips a slug already held, an add commits every
 * row or none, the marker is claimed once), and what only a real database can prove is
 * `integration/knowledgeDomainStore.test.ts`.
 *
 * Every field of {@link KnowledgeDomainFakeState} is mutable on purpose: a test changes the retired file between
 * two calls, plants a corrupt row, takes a slug "between" an add's read and its insert, or switches the connection
 * to an outage, and asserts what the port does.
 */
import { err, ok, type Result } from "#lib/result.js";

import type {
  KnowledgeDomainPort,
  KnowledgeDomainRows,
  KnowledgeDomainSeams,
  StoredKnowledgeDomain,
} from "../knowledge/domainPort.js";
import { storeKnowledgeDomainPort } from "../knowledge/domainPort.js";
import { type KnowledgeDomainStoreError, KnowledgeDomainStoreErrors } from "../knowledge/domainStoreErrors.js";
import type { InstallDomainRecord } from "../knowledge/installDomains.js";
import type { ImportSource } from "../store/registerImport.js";

/** How the fake's `connect` answers. */
export type FakeDomainConnection = "open" | "unavailable";

/**
 * The fake's whole state — every field a test may read or move.
 *
 * @internal — named only through {@link KnowledgeDomainFake}'s `state`, which is how a test reaches it.
 */
export interface KnowledgeDomainFakeState {
  rows: StoredKnowledgeDomain[];
  /** The import marker's claimed record count, or undefined when no import has run. */
  marker: number | undefined;
  /** What the retired file read answers. */
  legacy: Result<ImportSource<InstallDomainRecord>, KnowledgeDomainStoreError>;
  connection: FakeDomainConnection;
  /** When set, `readAll` fails with this driver reason. */
  readFailure: string | undefined;
  /** What `readFailure` becomes the moment an all-or-nothing insert commits — the connection dropping after it. */
  readFailureAfterInsert: string | undefined;
  /** When set, closing a connection throws with this reason — after whatever the operation committed. */
  closeFailure: string | undefined;
  /** Rows another writer commits just before the next all-or-nothing insert runs. */
  raceBeforeInsert: StoredKnowledgeDomain[];
  legacyReads: number;
  closes: number;
}

/** A fake store and the port over it. */
export interface KnowledgeDomainFake {
  readonly state: KnowledgeDomainFakeState;
  readonly seams: KnowledgeDomainSeams;
  readonly port: KnowledgeDomainPort;
}

/**
 * One record as the table stores it.
 *
 * @param record the domain or alias
 * @returns the stored row
 */
function storedDomainOf({ record }: { record: InstallDomainRecord }): StoredKnowledgeDomain {
  if (record.kind === "domain") {
    return { foldsInto: null, holds: record.holds, kind: "domain", slug: record.slug };
  }
  return { foldsInto: record.foldsInto, holds: null, kind: "alias", slug: record.slug };
}

/**
 * Insert records, skipping any slug already held — the import's `ON CONFLICT DO NOTHING`.
 *
 * @param state the fake
 * @param records what to insert
 */
function insertSkipping({
  state,
  records,
}: {
  state: KnowledgeDomainFakeState;
  records: readonly InstallDomainRecord[];
}): void {
  records.forEach((record) => {
    if (!state.rows.some((row) => row.slug === record.slug)) {
      state.rows.push(storedDomainOf({ record }));
    }
  });
}

/**
 * The row operations over the fake's state.
 *
 * @param state the fake
 * @returns the rows one "connection" offers
 */
function rowsOver({ state }: { state: KnowledgeDomainFakeState }): KnowledgeDomainRows {
  return {
    claim: async ({ source }) => {
      if (state.marker !== undefined) {
        return ok(false);
      }
      const records = source.state === "present" ? source.records : [];
      state.marker = records.length;
      insertSkipping({ records, state });
      return ok(true);
    },
    close: async () => {
      state.closes += 1;
      if (state.closeFailure !== undefined) {
        throw new Error(state.closeFailure);
      }
    },
    insertAll: async ({ records }) => {
      state.rows.push(...state.raceBeforeInsert.splice(0));
      const taken = records.map((record) => record.slug).filter((slug) => state.rows.some((row) => row.slug === slug));
      if (taken.length > 0) {
        return ok({ inserted: false, taken });
      }
      state.rows.push(...records.map((record) => storedDomainOf({ record })));
      state.readFailure = state.readFailureAfterInsert;
      return ok({ inserted: true });
    },
    marker: async () => {
      if (state.marker === undefined) {
        return ok(undefined);
      }
      return ok({ records: state.marker, tableHasRows: state.rows.length > 0 });
    },
    readAll: async () => {
      if (state.readFailure !== undefined) {
        return err({ doing: "read this install's knowledge domains", reason: state.readFailure });
      }
      return ok(state.rows.toSorted((a, b) => a.slug.localeCompare(b.slug)));
    },
  };
}

/**
 * A fresh fake store, empty and open, whose retired file is absent unless a test says otherwise.
 *
 * @param legacy what the retired file read answers
 * @param connection how `connect` answers
 * @returns the state, the seams and the port over them
 */
export function knowledgeDomainFake({
  legacy = ok({ state: "absent" }),
  connection = "open",
}: {
  legacy?: Result<ImportSource<InstallDomainRecord>, KnowledgeDomainStoreError>;
  connection?: FakeDomainConnection;
} = {}): KnowledgeDomainFake {
  const state: KnowledgeDomainFakeState = {
    closeFailure: undefined,
    closes: 0,
    connection,
    legacy,
    legacyReads: 0,
    marker: undefined,
    raceBeforeInsert: [],
    readFailure: undefined,
    readFailureAfterInsert: undefined,
    rows: [],
  };
  const seams: KnowledgeDomainSeams = {
    connect: async () => {
      if (state.connection === "unavailable") {
        return err(KnowledgeDomainStoreErrors.storeUnavailable({ doing: "be opened", reason: "connection refused" }));
      }
      return ok(rowsOver({ state }));
    },
    readImportFile: () => {
      state.legacyReads += 1;
      return state.legacy;
    },
  };
  return { port: storeKnowledgeDomainPort({ seams }), seams, state };
}
