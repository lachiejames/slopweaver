/**
 * The one door the press register is read and written through, and its orchestration over injected seams.
 *
 * The `landing_press` table is the authority (`../store/schema/landingPress.ts`). The old
 * `landing-presses.jsonl` is imported ONCE by the shared protocol in `../store/registerImport.ts`, on the first
 * operation of any connection, read or write. A store that cannot be reached is `PRESS_STORE_UNAVAILABLE`,
 * never a file read: a file that stopped being the authority is how a register becomes confidently wrong.
 *
 * Every effect arrives through {@link PressJournalSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/landingRegistersFixture.ts` — a seam, not a mock). The Postgres half and the
 * production factory are `./pressJournalStoreRows.ts`; what only a real database can prove is the opt-in
 * `src/__tests__/integration/landingRegistersStore.test.ts`.
 *
 * ## Append-only, idempotent by key
 *
 * An append inserts under `pressKey` with `ON CONFLICT DO NOTHING`. A conflict re-reads the key: the same press
 * is the same act and succeeds, a different one is `PRESS_KEY_CONFLICT`. Nothing retries and nothing overwrites.
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

import type { RecordedPress } from "./landing.js";
import { decodePressRecord, latestPresses, type PressRecord, pressKey } from "./pressJournal.js";
import { type PressJournalError, PressJournalErrors, type PressStoreUnavailableError } from "./pressJournalErrors.js";

/** The press register's two operations, as one value a caller threads. */
export interface PressJournalPort {
  /** The latest press per pull request, keyed `owner/name#number`. */
  readonly readLatest: (request: {
    readonly home: string;
  }) => Promise<Result<ReadonlyMap<string, RecordedPress>, PressJournalError>>;
  /** Record one press. */
  readonly append: (request: {
    readonly home: string;
    readonly record: PressRecord;
  }) => Promise<Result<undefined, PressJournalError>>;
}

/** One stored press as the store returned it, undecoded. */
export interface StoredPress {
  readonly pressKey: string;
  readonly repoSlug: string;
  readonly number: number;
  readonly headOid: string;
  readonly entryState: string;
  readonly atIso: string;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface PressJournalRows extends ImportOnceRows<PressRecord> {
  /** Every stored press, in insertion order. */
  readonly readAll: () => Promise<Result<readonly StoredPress[], StoreStepFailure>>;
  /** Insert one press unless its key exists; undefined when it did. */
  readonly insert: (request: {
    readonly key: string;
    readonly record: PressRecord;
  }) => Promise<Result<StoredPress | undefined, StoreStepFailure>>;
  /** The press under one key, or undefined. */
  readonly readKey: (request: { readonly key: string }) => Promise<Result<StoredPress | undefined, StoreStepFailure>>;
  readonly close: () => Promise<void>;
}

/** Every effect the press register performs. */
export interface PressJournalSeams {
  /** Open the store for one home, refusing with `PRESS_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<PressJournalRows, PressStoreUnavailableError>>;
  /** The strict read of the old file, consulted only when no import marker exists. */
  readonly readImportFile: (request: { readonly home: string }) => Result<ImportSource<PressRecord>, PressJournalError>;
}

/**
 * Decode every stored press strictly, refusing on the first that is not one. Exported so `github press-reseal`
 * proves its repair through exactly this reader before it commits (`./pressReseal.ts`).
 *
 * @param stored the rows, in insertion order
 * @returns the records, or the corrupt row named
 */
export function decodeStored({
  stored,
}: {
  stored: readonly StoredPress[];
}): Result<readonly PressRecord[], PressJournalError> {
  const records: PressRecord[] = [];
  for (const row of stored) {
    const decoded = decodePressRecord({ value: row });
    if (decoded.isErr()) {
      return err(PressJournalErrors.recordInvalid({ pressKey: row.pressKey, reason: decoded.error.message }));
    }
    // A key that is not its own fields' hash is corruption a CHECK cannot see, so it is refused here.
    if (pressKey({ record: decoded.value }) !== row.pressKey) {
      return err(
        PressJournalErrors.recordInvalid({
          pressKey: row.pressKey,
          reason: "is stored under a key its own fields do not hash to",
        }),
      );
    }
    records.push(decoded.value);
  }
  return ok(records);
}

/**
 * Whether a stored press is the same act as the one being appended.
 *
 * @param stored the row under the key
 * @param record the press being appended
 * @returns true when every field agrees
 */
function samePress({ stored, record }: { stored: StoredPress; record: PressRecord }): boolean {
  return (
    stored.repoSlug === record.repoSlug &&
    stored.number === record.number &&
    stored.headOid === record.headOid &&
    stored.atIso === record.atIso &&
    stored.entryState === record.entryState
  );
}

/**
 * Run the one-time import over an open connection.
 *
 * @param home whose file is the import source
 * @param rows the open connection
 * @param seams where the file read comes from
 * @returns nothing once the table is the whole register, or the refusal
 */
async function imported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: PressJournalRows;
  seams: PressJournalSeams;
}): Promise<Result<undefined, PressJournalError>> {
  return ensureImported({
    readSource: () => seams.readImportFile({ home }).andThen((source) => refuseDisagreeingDuplicates({ source })),
    rows,
    unavailable: PressJournalErrors.storeUnavailable,
  });
}

/**
 * Refuse an old file holding two different presses under one key. The import keeps the first line a key
 * names, so letting a disagreeing second through would drop it silently; an identical repeat is harmless.
 *
 * @param source the old file as read
 * @returns the source unchanged, or the key the file disagrees with itself under
 */
function refuseDisagreeingDuplicates({
  source,
}: {
  source: ImportSource<PressRecord>;
}): Result<ImportSource<PressRecord>, PressJournalError> {
  if (source.state === "absent") {
    return ok(source);
  }
  const firstByKey = new Map<string, PressRecord>();
  for (const record of source.records) {
    const key = pressKey({ record });
    const first = firstByKey.get(key);
    if (first === undefined) {
      firstByKey.set(key, record);
    } else if (!samePress({ record, stored: { ...first, pressKey: key } })) {
      return err(
        PressJournalErrors.recordInvalid({ pressKey: key, reason: "appears twice in the old file, disagreeing" }),
      );
    }
  }
  return ok(source);
}

/**
 * Read the latest press per pull request.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the map, or the refusal
 */
async function readLatestWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: PressJournalRows;
  seams: PressJournalSeams;
}): Promise<Result<ReadonlyMap<string, RecordedPress>, PressJournalError>> {
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const stored = await rows.readAll();
  if (stored.isErr()) {
    return err(PressJournalErrors.storeUnavailable(stored.error));
  }
  const held = await confirmEmptyRead({
    rowCount: stored.value.length,
    rows,
    unavailable: PressJournalErrors.storeUnavailable,
  });
  if (held.isErr()) {
    return err(held.error);
  }
  const records = decodeStored({ stored: stored.value });
  if (records.isErr()) {
    return err(records.error);
  }
  return ok(latestPresses({ records: records.value }));
}

/**
 * Append one press, idempotently.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param record the press
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns nothing once it is recorded, or the refusal
 */
async function appendWith({
  home,
  record,
  rows,
  seams,
}: {
  home: string;
  record: PressRecord;
  rows: PressJournalRows;
  seams: PressJournalSeams;
}): Promise<Result<undefined, PressJournalError>> {
  const valid = decodePressRecord({ value: record });
  if (valid.isErr()) {
    return err(PressJournalErrors.recordInvalid({ pressKey: pressKey({ record }), reason: valid.error.message }));
  }
  // From here on only the decoded copy is used, so what was checked is exactly what is written.
  const press = valid.value;
  const key = pressKey({ record: press });
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const inserted = await rows.insert({ key, record: press });
  if (inserted.isErr()) {
    return err(PressJournalErrors.storeUnavailable(inserted.error));
  }
  if (inserted.value !== undefined) {
    return answeredAs({ answered: inserted.value, key, press });
  }
  // The key was already there — the import, or another writer, recorded it first. Same act or a different one.
  const existing = await rows.readKey({ key });
  if (existing.isErr()) {
    return err(PressJournalErrors.storeUnavailable(existing.error));
  }
  if (existing.value === undefined) {
    return err(PressJournalErrors.keyConflict({ pressKey: key }));
  }
  const sound = soundUnder({ key, row: existing.value });
  if (sound.isErr()) {
    return err(sound.error);
  }
  if (!samePress({ record: press, stored: existing.value })) {
    return err(PressJournalErrors.keyConflict({ pressKey: key }));
  }
  return ok(undefined);
}

/**
 * Check a row the store answered with as any stored row is checked, and that it sits under the key asked for.
 *
 * @param row the row the store returned
 * @param key the key the statement named
 * @returns nothing when it is sound, or the refusal naming it
 */
function soundUnder({ row, key }: { row: StoredPress; key: string }): Result<undefined, PressJournalError> {
  const decoded = decodeStored({ stored: [row] });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  if (row.pressKey !== key) {
    return err(
      PressJournalErrors.recordInvalid({ pressKey: key, reason: "came back from the store under another key" }),
    );
  }
  return ok(undefined);
}

/**
 * Check the row an insert answered with is sound and is exactly the press that was sent.
 *
 * @param answered the row the insert returned
 * @param key the key it was inserted under
 * @param press the press that was sent
 * @returns nothing when it is, or the refusal naming the row
 */
function answeredAs({
  answered,
  key,
  press,
}: {
  answered: StoredPress;
  key: string;
  press: PressRecord;
}): Result<undefined, PressJournalError> {
  const sound = soundUnder({ key, row: answered });
  if (sound.isErr()) {
    return sound;
  }
  if (!samePress({ record: press, stored: answered })) {
    return err(PressJournalErrors.recordInvalid({ pressKey: key, reason: "came back from its insert altered" }));
  }
  return ok(undefined);
}

/**
 * A press register port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./pressJournalStoreRows.ts`'s
 * @returns the port
 */
export function storePressJournalPort({ seams }: { seams: PressJournalSeams }): PressJournalPort {
  return {
    append: ({ home, record }) =>
      overConnection({
        body: (rows) => appendWith({ home, record, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: PressJournalErrors.storeUnavailable,
      }),
    readLatest: ({ home }) =>
      overConnection({
        body: (rows) => readLatestWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: PressJournalErrors.storeUnavailable,
      }),
  };
}
