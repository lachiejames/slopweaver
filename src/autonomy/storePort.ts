/**
 * The store-backed autonomy ledger: every record read from, and written once into, `autonomy_event`. This module
 * is the ORCHESTRATION; every effect arrives through {@link AutonomyStoreSeams}, so a unit test drives every branch
 * over a plain in-memory fake (a seam, not a mock: `.claude/rules/testing.md`). The Postgres half is
 * `./storeRows.ts`; what only a real database can prove — the partial unique index, the sequence — is the opt-in
 * `src/__tests__/integration/autonomyLedgerStore.test.ts`.
 *
 * Every operation opens one connection and always closes it, and asks first whether the store can answer at all:
 * a store with no import record beside a register file still in the home is `AUTONOMY_NOT_IMPORTED`. A seam that
 * rejects rather than answering a Result is still a step that did not finish, so it is
 * `AUTONOMY_STORE_UNAVAILABLE` — never an empty ledger standing in for "the rows are unknown".
 */
import { err, ok, type Result } from "#lib/result.js";

import type { NewAutonomyEventRecord } from "../store/schema/ledgers.js";
import { withStoreConnection } from "../store/withConnection.js";
import { isClassSteerRecord } from "./classSteer.js";
import { validateAutonomyRecord } from "./decode.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";
import type { AutonomyLedgerPort } from "./port.js";
import { conflictingField } from "./query.js";
import { isSteerRecord } from "./row.js";
import { type AutonomyStoreError, AutonomyStoreErrors, type AutonomyStoreUnavailableError } from "./storeErrors.js";
import { validatedAutonomyEventRow } from "./storeRecord.js";
import type { AutonomyActionRow, AutonomyAppendReceipt, AutonomyRecord } from "./types.js";

/** One stored authority row as a read returns it: its key, for a refusal to name, and the record it decodes from. */
export interface StoredAutonomyRow {
  readonly importKey: string;
  readonly record: unknown;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface AutonomyRows {
  /** Whether the one-time import of a home register has completed. */
  readonly imported: () => Promise<Result<boolean, AutonomyStoreUnavailableError>>;
  /** Every AUTHORITY row (a non-null `record`), in insert (`seq`) order — the order the register's lines had. */
  readonly readAll: () => Promise<Result<readonly StoredAutonomyRow[], AutonomyStoreUnavailableError>>;
  /** The authority act stored under one id, or undefined when none is. */
  readonly readAction: (request: {
    readonly actionId: string;
  }) => Promise<Result<StoredAutonomyRow | undefined, AutonomyStoreUnavailableError>>;
  /** Insert unless ANY unique index already holds it; false when one did, which this writer then lost. */
  readonly insert: (request: {
    readonly row: NewAutonomyEventRecord;
  }) => Promise<Result<boolean, AutonomyStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/**
 * The rows plus the ONE in-place write the ledger allows: `./reviseStore.ts`'s qualification of an act's bare
 * references. A compare-and-swap rather than an update by id, so a row that changed after it was read is never
 * overwritten with a revision of what it used to say.
 */
export interface AutonomyRevisableRows extends AutonomyRows {
  /** Replace one authority act's `why`, `witness` and `record` iff its record still equals `expected`; false when not. */
  readonly revise: (request: {
    readonly actionId: string;
    /** The record as read; serialised through `autonomyRecordJson`, so an inherited `toJSON` cannot reshape it. */
    readonly expected: Readonly<Record<string, unknown>>;
    readonly row: {
      readonly why: string;
      readonly witness: string;
      readonly record: Readonly<Record<string, unknown>>;
    };
  }) => Promise<Result<boolean, AutonomyStoreUnavailableError>>;
}

/** Whether the home's register file is there: `present`, `absent`, or a reason it could not be told. */
export type AutonomySourcePresence =
  { readonly kind: "present" } | { readonly kind: "absent" } | { readonly kind: "unknown"; readonly reason: string };

/** Every effect the store-backed ledger performs, injected so the orchestration is testable without one. */
export interface AutonomyStoreSeams {
  /** Open the store for one home, refusing with `AUTONOMY_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<AutonomyRows, AutonomyStoreUnavailableError>>;
  /** Where the home's register file would be, and whether it is there — read only while the store has no import. */
  readonly source: (request: { readonly home: string }) => {
    readonly path: string;
    readonly presence: AutonomySourcePresence;
  };
  /** A fresh token for a steer's key — the owner may say the same thing twice, so a steer's is the one key not derived. */
  readonly steerNonce: () => string;
}

/** The seams whose connection also offers {@link AutonomyRevisableRows.revise} — what production's are. */
export type AutonomyRevisableSeams = Omit<AutonomyStoreSeams, "connect"> & {
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<AutonomyRevisableRows, AutonomyStoreUnavailableError>>;
};

/** The store refusal for a seam that rejected rather than answering a Result. */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): AutonomyStoreUnavailableError {
  const reason = cause instanceof Error ? cause.message : "unknown failure";
  return AutonomyStoreErrors.storeUnavailable({ doing, reason });
}

/**
 * Whether the store can answer for this home: it has imported the register, or there is no register to import.
 *
 * The file is stat-ed, never read, and only while the store holds no import record — so once the import has run
 * the file may be deleted, edited or restored and nothing here notices.
 */
async function ready({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: AutonomyRows;
  seams: Pick<AutonomyStoreSeams, "source">;
}): Promise<Result<true, AutonomyStoreError>> {
  const imported = await rows.imported();
  if (imported.isErr()) {
    return err(imported.error);
  }
  if (imported.value) {
    return ok(true);
  }
  const { path, presence } = seams.source({ home });
  switch (presence.kind) {
    case "absent":
      return ok(true);
    case "present":
      return err(AutonomyStoreErrors.notImported({ sourcePath: path }));
    case "unknown":
      return err(AutonomyStoreErrors.importStateUnavailable({ reason: presence.reason, sourcePath: path }));
  }
}

/**
 * Run one operation over a connection this function opens, gates and always closes.
 *
 * Generic over the rows a connection offers, so a writer with an operation the port does not carry
 * (`./reviseStore.ts`'s one compare-and-swap) is gated by the same import check as every reader.
 *
 * @param body the operation, run only once the store can answer for this home
 * @param home the state home whose store is opened
 * @param seams the effects, its `connect` handing back the rows `body` needs
 * @returns what `body` answered, or the store's refusal
 */
export async function withReadyRows<T, E, Rows extends AutonomyRows = AutonomyRows>({
  body,
  home,
  seams,
}: {
  body: (rows: Rows) => Promise<Result<T, E | AutonomyStoreError>>;
  home: string;
  seams: Omit<AutonomyStoreSeams, "connect"> & {
    readonly connect: (request: { readonly home: string }) => Promise<Result<Rows, AutonomyStoreUnavailableError>>;
  };
}): Promise<Result<T, E | AutonomyStoreError>> {
  return withStoreConnection<Rows, T, E | AutonomyStoreError>({
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
 * Decode one stored row, naming its key when it is not a record.
 *
 * @param stored the row as a read returned it
 * @returns the record, or the store's refusal naming the row's key
 */
export function decodeStored({ stored }: { stored: StoredAutonomyRow }): Result<AutonomyRecord, AutonomyStoreError> {
  const decoded = validateAutonomyRecord({ value: stored.record });
  if (decoded.isErr()) {
    return err(AutonomyStoreErrors.rowUnreadable({ importKey: stored.importKey, why: decoded.error.message }));
  }
  return ok(decoded.value);
}

/** Decode every stored row, refusing the whole read on the first one that is not a record. */
function decodeAll({
  rows,
}: {
  rows: readonly StoredAutonomyRow[];
}): Result<readonly AutonomyRecord[], AutonomyStoreError> {
  const records: AutonomyRecord[] = [];
  for (const stored of rows) {
    const decoded = decodeStored({ stored });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    records.push(decoded.value);
  }
  return ok(records);
}

/** The act stored under an id, decoded, or undefined when none is. */
async function heldAction({
  actionId,
  rows,
}: {
  actionId: string;
  rows: AutonomyRows;
}): Promise<Result<AutonomyActionRow | undefined, AutonomyStoreError>> {
  const held = await rows.readAction({ actionId });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value === undefined) {
    return ok(undefined);
  }
  const decoded = decodeStored({ stored: held.value });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  if (isSteerRecord(decoded.value)) {
    return err(
      AutonomyStoreErrors.rowUnreadable({ importKey: held.value.importKey, why: "an action row decodes as a steer" }),
    );
  }
  return ok(decoded.value);
}

/**
 * Write one act: one insert attempt, and on a loss the act the winner stored decides — the same act is an
 * idempotent no-op, a different one under the same id is `ACTION_ID_CONFLICT`.
 */
async function appendAction({
  action,
  row,
  rows,
}: {
  action: AutonomyActionRow;
  row: NewAutonomyEventRecord;
  rows: AutonomyRows;
}): Promise<Result<AutonomyAppendReceipt, AutonomyError | AutonomyStoreError>> {
  const inserted = await rows.insert({ row });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  if (inserted.value) {
    return ok({ actionId: action.actionId, appended: true });
  }
  const held = await heldAction({ actionId: action.actionId, rows });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value === undefined) {
    return err(AutonomyStoreErrors.writeKeyTaken({ actionId: action.actionId }));
  }
  const field = conflictingField({ first: held.value, second: action });
  if (field !== undefined) {
    return err(AutonomyErrors.actionIdConflict({ actionId: action.actionId, field }));
  }
  return ok({ actionId: action.actionId, appended: false });
}

/**
 * Write one steer. A per-act steer names an act that must already be stored — acts are never deleted, so the
 * check and the insert need no transaction between them. A class steer names a class, never an act, so the owner's
 * standing word is valid before the first act of its kind exists.
 */
async function appendSteer({
  record,
  row,
  rows,
}: {
  record: AutonomyRecord;
  row: NewAutonomyEventRecord;
  rows: AutonomyRows;
}): Promise<Result<AutonomyAppendReceipt, AutonomyError | AutonomyStoreError>> {
  if (!isClassSteerRecord(record)) {
    const held = await heldAction({ actionId: record.actionId, rows });
    if (held.isErr()) {
      return err(held.error);
    }
    if (held.value === undefined) {
      return err(AutonomyErrors.unknownAction({ actionId: record.actionId }));
    }
  }
  const inserted = await rows.insert({ row });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  if (!inserted.value) {
    return err(AutonomyStoreErrors.writeKeyTaken({ actionId: record.actionId }));
  }
  return ok({ actionId: record.actionId, appended: true });
}

/**
 * The derived key for a row written through the port. An act is one per id, so its key names the id and a
 * replayed write collides on it; a steer carries a nonce, because the owner may give the same word twice.
 */
function writtenKey({ record, nonce }: { record: AutonomyRecord; nonce: () => string }): string {
  if (isSteerRecord(record)) {
    return `written:steer:${record.actionId}:${nonce()}`;
  }
  return `written:action:${record.actionId}`;
}

/**
 * An autonomy ledger port whose authority is the `autonomy_event` rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionAutonomyStoreSeams`
 * @returns the port
 */
export function storeAutonomyLedgerPort({ seams }: { seams: AutonomyStoreSeams }): AutonomyLedgerPort {
  return {
    appendRecord: async ({ home, record }) => {
      // Re-validated before anything else, and only the validated copy is stored: `AutonomyRecord` is a TYPE,
      // and a type cannot say that `why` is non-empty or that `subject` is a URL the owner can open.
      const built = validatedAutonomyEventRow({
        importKey: ({ record: checked }) => writtenKey({ nonce: seams.steerNonce, record: checked }),
        value: record,
      });
      if (built.isErr()) {
        return err(built.error);
      }
      const { record: checked, row } = built.value;
      return withReadyRows<AutonomyAppendReceipt, AutonomyError>({
        body: (rows) =>
          isSteerRecord(checked)
            ? appendSteer({ record: checked, row, rows })
            : appendAction({ action: checked, row, rows }),
        home,
        seams,
      });
    },
    readRecords: ({ home }) =>
      withReadyRows<readonly AutonomyRecord[], never>({
        body: async (rows) => {
          const stored = await rows.readAll();
          if (stored.isErr()) {
            return err(stored.error);
          }
          return decodeAll({ rows: stored.value });
        },
        home,
        seams,
      }),
  };
}
