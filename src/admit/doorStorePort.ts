/**
 * The store-backed door ledger: every decision and pre-door refusal written once into `door_event`, and read back
 * from it. This module is the ORCHESTRATION; every effect arrives through {@link DoorStoreSeams}, so a unit test
 * drives every branch over a plain in-memory fake (a seam, not a mock: `.claude/rules/testing.md`). The Postgres
 * half is `./doorStoreRows.ts`; what only a real database can prove — the unique indexes, the sequence, the window
 * query — is the opt-in `src/__tests__/integration/doorLedgerStore.test.ts`.
 *
 * Every operation opens one connection and always closes it, and asks first whether the store can answer at all:
 * a store with no import record is `DOOR_NOT_IMPORTED` while a legacy `door.jsonl` stands in the home, or while a
 * mirror row the import never filled in is still in the table — a populated table alone is not the whole trail.
 * A seam that rejects rather than answering a Result is still a step that did not finish, so it is
 * `DOOR_STORE_UNAVAILABLE` — never an empty trail standing in for "the rows are unknown".
 */
import { err, ok, type Result } from "#lib/result.js";

import { doorEventFields } from "../store/fleet/doorEvent.js";
import { DOOR_WRITTEN_KEY_PREFIX, holdsNul } from "../store/fleet/doorImport.js";
import type { NewDoorEventRecord } from "../store/schema/ledgers.js";
import { withStoreConnection } from "../store/withConnection.js";
import type { DoorFrictionEntry, DoorLedgerPort } from "./doorLedgerPort.js";
import { type PreDoorRefusalEntry, preDoorRefusalOf } from "./doorRefusalRead.js";
import { type DoorStoreError, DoorStoreErrors, type DoorStoreUnavailableError } from "./doorStoreErrors.js";
import { doorDecisionRecord, preDoorRefusalRecord } from "./ledger.js";

/** One stored refusal row as a read returns it: its key, for a refusal to name, and the record it decodes from. */
export interface StoredDoorRecord {
  readonly importKey: string;
  readonly record: unknown;
}

/** One stored friction row, read from the scalar columns every row carries, imported or written. */
export interface StoredDoorFriction {
  readonly action: string;
  readonly status: string;
  readonly overridden: readonly string[];
  readonly occurredAt: Date;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface DoorRows {
  /** Whether the one-time import of a home ledger has completed. */
  readonly imported: () => Promise<Result<boolean, DoorStoreUnavailableError>>;
  /** Whether any mirror row still has no verbatim `record` — a projection the import has not filled in. */
  readonly unfilled: () => Promise<Result<boolean, DoorStoreUnavailableError>>;
  /** Insert unless ANY unique index already holds it; false when one did, which this writer then lost. */
  readonly insert: (request: {
    readonly row: NewDoorEventRecord;
  }) => Promise<Result<boolean, DoorStoreUnavailableError>>;
  /** The newest `limit` refused rows, NEWEST first. */
  readonly readRefusals: (request: {
    readonly limit: number;
  }) => Promise<Result<readonly StoredDoorRecord[], DoorStoreUnavailableError>>;
  /** Every attributed hold or override in the window, in `seq` order. */
  readonly readFriction: (request: {
    readonly from: Date;
    readonly to: Date;
  }) => Promise<Result<readonly StoredDoorFriction[], DoorStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Whether the home's legacy ledger file is there: `present`, `absent`, or a reason it could not be told. */
export type DoorSourcePresence =
  { readonly kind: "present" } | { readonly kind: "absent" } | { readonly kind: "unknown"; readonly reason: string };

/** Every effect the store-backed ledger performs, injected so the orchestration is testable without one. */
export interface DoorStoreSeams {
  /** Open the store for one home, refusing with `DOOR_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<DoorRows, DoorStoreUnavailableError>>;
  /** Where the home's legacy ledger would be, and whether it is there — read only while the store has no import. */
  readonly source: (request: { readonly home: string }) => {
    readonly path: string;
    readonly presence: DoorSourcePresence;
  };
  /** A fresh token for a written row's key — the door records many identical decisions, so none is derived. */
  readonly writeNonce: () => string;
}

/** The store refusal for a seam that rejected rather than answering a Result. */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): DoorStoreUnavailableError {
  const reason = cause instanceof Error ? cause.message : "unknown failure";
  return DoorStoreErrors.storeUnavailable({ doing, reason });
}

/**
 * Whether the store can answer for this home: it has imported the ledger, or there is nothing to import.
 *
 * The file is stat-ed, never read, and only while the store holds no import record — so once the import has run
 * the file may be deleted and nothing here notices. Without the record, a mirror row with no verbatim `record`
 * refuses even when the file is gone: the rows the mirror wrote are not proof its last lines landed.
 */
async function ready({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: DoorRows;
  seams: DoorStoreSeams;
}): Promise<Result<true, DoorStoreError>> {
  const imported = await rows.imported();
  if (imported.isErr()) {
    return err(imported.error);
  }
  if (imported.value) {
    return ok(true);
  }
  const unfilled = await rows.unfilled();
  if (unfilled.isErr()) {
    return err(unfilled.error);
  }
  // The file is stat-ed LAST, after every await, so a legacy writer creating it mid-gate is seen by the nearest
  // check to the body. Nothing locks it: a writer still running at the cutover is why every seat is stopped first.
  const { path, presence } = seams.source({ home });
  if (unfilled.value || presence.kind === "present") {
    return err(DoorStoreErrors.notImported({ sourcePath: path }));
  }
  if (presence.kind === "unknown") {
    return err(DoorStoreErrors.importStateUnavailable({ reason: presence.reason, sourcePath: path }));
  }
  return ok(true);
}

/** Run one operation over a connection this function opens, gates and always closes. */
async function withReadyRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: DoorRows) => Promise<Result<T, DoorStoreError>>;
  home: string;
  seams: DoorStoreSeams;
}): Promise<Result<T, DoorStoreError>> {
  return withStoreConnection<DoorRows, T, DoorStoreError>({
    body: async (rows) => {
      const gate = await ready({ home, rows, seams });
      if (gate.isErr()) {
        return err(gate.error);
      }
      return body(rows);
    },
    connect: () => seams.connect({ home }),
    unavailable,
  });
}

/**
 * The row a live record becomes, or why the store cannot hold it verbatim. Postgres `text` and `jsonb` both refuse
 * a NUL byte, and stripping one would change what the audit trail says was decided.
 */
function writtenRow({
  record,
  nonce,
}: {
  record: Readonly<Record<string, unknown>>;
  nonce: () => string;
}): Result<NewDoorEventRecord, DoorStoreError> {
  // Only ever a label inside the refusal's message; the record itself is never altered.
  const runId = typeof record["runId"] === "string" ? record["runId"] : "(a record with no runId)";
  if (holdsNul({ value: record })) {
    return err(DoorStoreErrors.eventUnstorable({ reason: "it holds a NUL byte", runId }));
  }
  const fields = doorEventFields({ decoded: record });
  if (fields.isErr()) {
    return err(DoorStoreErrors.eventUnstorable({ reason: fields.error, runId }));
  }
  // A row the door wrote itself is attributed by construction: the test-suite era the provenance column separates
  // ended before this table could be written live, and every lane now writes into its own sandbox.
  return ok({ ...fields.value, importKey: `${DOOR_WRITTEN_KEY_PREFIX}${nonce()}`, provenance: "attributed", record });
}

/** Insert one live record, once, naming the collision a lost insert means. */
async function appendRecord({
  home,
  record,
  seams,
}: {
  home: string;
  record: Readonly<Record<string, unknown>>;
  seams: DoorStoreSeams;
}): Promise<Result<undefined, DoorStoreError>> {
  const row = writtenRow({ nonce: seams.writeNonce, record });
  if (row.isErr()) {
    return err(row.error);
  }
  return withReadyRows({
    body: async (rows) => {
      const inserted = await rows.insert({ row: row.value });
      if (inserted.isErr()) {
        return err(inserted.error);
      }
      return inserted.value ? ok(undefined) : err(DoorStoreErrors.writeKeyTaken({ importKey: row.value.importKey }));
    },
    home,
    seams,
  });
}

/** Decode the refused rows a query selected, refusing the whole read on the first one that is not a refusal. */
function decodeRefusals({
  stored,
}: {
  stored: readonly StoredDoorRecord[];
}): Result<readonly PreDoorRefusalEntry[], DoorStoreError> {
  const entries: PreDoorRefusalEntry[] = [];
  for (const row of stored) {
    const entry = preDoorRefusalOf({ record: row.record });
    if (entry === undefined) {
      const reason = row.record === null ? "the import has not filled its record in" : "a field is missing";
      return err(DoorStoreErrors.rowUnreadable({ importKey: row.importKey, reason }));
    }
    entries.push(entry);
  }
  return ok(entries);
}

/** One window bound as an instant, or the refusal naming the bound that is not one. */
function instantOf({ iso }: { iso: string }): Result<Date, DoorStoreError> {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return err(
      DoorStoreErrors.storeUnavailable({ doing: "read the door friction", reason: `${iso} is not an instant` }),
    );
  }
  return ok(at);
}

/**
 * A door ledger port whose authority is the `door_event` rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./doorStoreRows.ts`'s `productionDoorStoreSeams`
 * @returns the port
 */
export function storeDoorLedgerPort({ seams }: { seams: DoorStoreSeams }): DoorLedgerPort {
  return {
    appendDecision: ({ decision, doorRequest, home, runId, tsIso }) =>
      appendRecord({ home, record: doorDecisionRecord({ decision, request: doorRequest, runId, tsIso }), seams }),
    appendPreDoorRefusal: ({ home, refusal }) =>
      appendRecord({ home, record: preDoorRefusalRecord({ refusal }), seams }),
    readDoorFriction: async ({ fromIso, home, toIso }) => {
      const from = instantOf({ iso: fromIso });
      if (from.isErr()) {
        return err(from.error);
      }
      const to = instantOf({ iso: toIso });
      if (to.isErr()) {
        return err(to.error);
      }
      return withReadyRows({
        body: async (rows) => {
          const stored = await rows.readFriction({ from: from.value, to: to.value });
          if (stored.isErr()) {
            return err(stored.error);
          }
          return ok(
            stored.value.map((row): DoorFrictionEntry => ({
              action: row.action,
              overridden: row.overridden,
              status: row.status,
              tsIso: row.occurredAt.toISOString(),
            })),
          );
        },
        home,
        seams,
      });
    },
    readRecentPreDoorRefusals: ({ home, limit }) =>
      withReadyRows({
        body: async (rows) => {
          if (limit <= 0) {
            return ok([]);
          }
          const stored = await rows.readRefusals({ limit });
          if (stored.isErr()) {
            return err(stored.error);
          }
          return decodeRefusals({ stored: stored.value.toReversed() });
        },
        home,
        seams,
      }),
  };
}
