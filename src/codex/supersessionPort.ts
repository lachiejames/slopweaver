/**
 * The one door the supersession register is read and written through, the strict decoder both its old file and
 * its rows go through, and its orchestration over injected seams.
 *
 * The `codex_supersession` table is the authority (`../store/schema/codexSupersession.ts`). The old
 * `codex-supersessions.jsonl` is imported ONCE by the shared protocol in `../store/registerImport.ts`, on the
 * first operation of any connection, read or write. A store that cannot be reached is
 * `SUPERSESSION_STORE_UNAVAILABLE`, never a file read.
 *
 * ## Fail closed, where the file reader failed toward strictness
 *
 * The file reader DROPPED a malformed line, on the argument that a dropped row only makes the gate stricter —
 * the pass it retired goes back to counting. That held for the gate and nothing else: `codex supersede` read
 * the same map to decide whether a pass was already retired, so a dropped row let a second, different
 * retirement of it be written. A row that will not decode now refuses every reader, and the import refuses a
 * file with a line that is not a retirement rather than importing around it.
 *
 * Every effect arrives through {@link SupersessionSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/landingRegistersFixture.ts` — a seam, not a mock). The Postgres half and the
 * production factory are `./supersessionStore.ts`; what only a real database can prove is the opt-in
 * `src/__tests__/integration/landingRegistersStore.test.ts`.
 *
 * ## Insert-only
 *
 * An append inserts under `artifactId` with `ON CONFLICT DO NOTHING`. A conflict re-reads the key: the same
 * retirement is the same act and succeeds, a different one is `ALREADY_SUPERSEDED`. Nothing overwrites.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import {
  confirmEmptyRead,
  ensureImported,
  type ImportOnceRows,
  type ImportSource,
  overConnection,
  type StoreStepFailure,
} from "../store/registerImport.js";

import { isArtifactIdShape } from "./ledgerStore.js";
import type { Supersession } from "./supersession.js";
import {
  type SupersessionDecodeError,
  SupersessionDecodeErrors,
  type SupersessionStoreError,
  SupersessionStoreErrors,
  type SupersessionStoreUnavailableError,
} from "./supersessionErrors.js";

/** The register's two operations, as one value a caller threads. */
export interface SupersessionPort {
  /** Every retirement on record, keyed by the artifact id each retires. */
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<ReadonlyMap<string, Supersession>, SupersessionStoreError>>;
  /** Record one retirement. */
  readonly append: (request: {
    readonly home: string;
    readonly row: Supersession;
  }) => Promise<Result<Supersession, SupersessionStoreError>>;
}

/** One stored retirement as the store returned it, undecoded: both shapes' columns, absent ones null. */
export interface StoredSupersession {
  readonly artifactId: string;
  readonly kind: string;
  readonly propertyId: string | null;
  readonly pass: string | null;
  readonly mode: string | null;
  readonly branch: string | null;
  readonly reason: string;
  readonly replacedBy: string;
  readonly atIso: string;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface SupersessionRows extends ImportOnceRows<Supersession> {
  /** Every stored retirement. */
  readonly readAll: () => Promise<Result<readonly StoredSupersession[], StoreStepFailure>>;
  /** Insert one retirement unless its artifact id has one; undefined when it did. */
  readonly insert: (request: {
    readonly row: Supersession;
  }) => Promise<Result<StoredSupersession | undefined, StoreStepFailure>>;
  /** The retirement of one artifact, or undefined. */
  readonly readArtifact: (request: {
    readonly artifactId: string;
  }) => Promise<Result<StoredSupersession | undefined, StoreStepFailure>>;
  readonly close: () => Promise<void>;
}

/** Every effect the register performs. */
export interface SupersessionSeams {
  /** Open the store for one home, refusing with `SUPERSESSION_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<SupersessionRows, SupersessionStoreUnavailableError>>;
  /** The strict read of the old file, consulted only when no import marker exists. */
  readonly readImportFile: (request: {
    readonly home: string;
  }) => Result<ImportSource<Supersession>, SupersessionStoreError>;
}

/**
 * Whether a field says anything: at least one letter or digit. `trim()` alone lets a blank-rendering character
 * such as U+2800 through, and a retirement with nothing legible in it hides a pass for no stated reason.
 *
 * @param text the field as stored
 * @returns true when it carries a letter or digit
 */
function legible({ text }: { text: string }): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Decode one retirement strictly: either shape, every field it needs and none it may not carry.
 *
 * A value with no `kind` is a wording row — every row written before the no-tree shape existed carries none —
 * and decodes WITHOUT a `kind`, so an old row and a new one read the same.
 *
 * @param value one parsed line of the old file, or a stored row with its absent columns already dropped
 * @returns the retirement, or the sentence saying why it is not one
 */
export function decodeSupersession({ value }: { value: unknown }): Result<Supersession, SupersessionDecodeError> {
  if (!isRecord(value)) {
    return err(SupersessionDecodeErrors.notAnObject());
  }
  const { artifactId, kind, propertyId, reason, replacedBy, atIso } = value;
  // A retirement is looked up by exact id, so one filed under an id no pass can carry (`abc123 `, a path) would
  // hide nothing while reading as sound: that row is corrupt, never a retirement of somebody else.
  if (typeof artifactId !== "string" || !isArtifactIdShape({ artifactId })) {
    return err(SupersessionDecodeErrors.artifactIdInvalid({ artifactId }));
  }
  if (typeof reason !== "string" || typeof replacedBy !== "string" || typeof atIso !== "string") {
    return err(SupersessionDecodeErrors.sharedFieldsMissing());
  }
  // A retirement hides a pass from every landing verdict, so one that names no replacement, gives no reason or
  // carries no instant is corrupt, not a retirement. Strict, never `Date.parse`, which guesses at an impossible day.
  const instantSound = parseStrictIsoInstantMs({ text: atIso }) !== undefined;
  if (!legible({ text: reason }) || !legible({ text: replacedBy }) || !instantSound) {
    return err(SupersessionDecodeErrors.sharedFieldsMissing());
  }
  if (kind === "no-tree") {
    return decodeUnplaceable({ artifactId, atIso, reason, replacedBy, value });
  }
  if (kind !== undefined && kind !== "wording") {
    return err(SupersessionDecodeErrors.kindUnknown({ kind }));
  }
  if (typeof propertyId !== "string" || !legible({ text: propertyId })) {
    return err(SupersessionDecodeErrors.wordingPropertyIdMissing());
  }
  if (value["pass"] !== undefined || value["mode"] !== undefined || value["branch"] !== undefined) {
    return err(SupersessionDecodeErrors.wordingCarriesNoTreeField());
  }
  return ok({ artifactId, atIso, propertyId, reason, replacedBy });
}

/** The `no-tree` half of {@link decodeSupersession}, once the shared fields are known to be strings. */
function decodeUnplaceable({
  artifactId,
  atIso,
  reason,
  replacedBy,
  value,
}: {
  artifactId: string;
  atIso: string;
  reason: string;
  replacedBy: string;
  value: Record<string, unknown>;
}): Result<Supersession, SupersessionDecodeError> {
  const { pass, mode, propertyId, branch } = value;
  if (typeof pass !== "string" || (mode !== "plan" && mode !== "review") || typeof branch !== "string") {
    return err(SupersessionDecodeErrors.unplaceableFieldsMissing());
  }
  if (!legible({ text: pass }) || !legible({ text: branch })) {
    return err(SupersessionDecodeErrors.unplaceableFieldsMissing());
  }
  // A review record always carries its property id and a plan never does (`ledger.ts`), so a retirement whose
  // propertyId disagrees with its mode retires a record that cannot exist.
  if ((mode === "review") !== (propertyId !== undefined)) {
    return err(SupersessionDecodeErrors.unplaceablePropertyIdMismatched());
  }
  if (propertyId === undefined) {
    return ok({ artifactId, atIso, branch, kind: "no-tree", mode, pass, reason, replacedBy });
  }
  if (typeof propertyId !== "string" || !legible({ text: propertyId })) {
    return err(SupersessionDecodeErrors.unplaceablePropertyIdMalformed());
  }
  return ok({ artifactId, atIso, branch, kind: "no-tree", mode, pass, propertyId, reason, replacedBy });
}

/**
 * Decode one stored row strictly, its null columns read as absent.
 *
 * @returns the retirement, or the corrupt row named
 */
function decodeStoredSupersession({ row }: { row: StoredSupersession }): Result<Supersession, SupersessionStoreError> {
  const present = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
  return decodeSupersession({ value: present }).mapErr((problem) =>
    SupersessionStoreErrors.recordInvalid({ artifactId: row.artifactId, reason: problem.message }),
  );
}

/**
 * The columns one retirement is stored as — `kind` always explicit, an absent field null. The insert writes
 * this shape and the idempotency check compares it, so the two cannot disagree about what "the same" is.
 *
 * @param row the retirement
 * @returns its columns
 */
export function supersessionColumns({ row }: { row: Supersession }): StoredSupersession {
  if (row.kind === "no-tree") {
    return {
      artifactId: row.artifactId,
      atIso: row.atIso,
      branch: row.branch,
      kind: "no-tree",
      mode: row.mode,
      pass: row.pass,
      propertyId: unsetAsNull({ value: row.propertyId }),
      reason: row.reason,
      replacedBy: row.replacedBy,
    };
  }
  return {
    artifactId: row.artifactId,
    atIso: row.atIso,
    branch: null,
    kind: "wording",
    mode: null,
    pass: null,
    propertyId: row.propertyId,
    reason: row.reason,
    replacedBy: row.replacedBy,
  };
}

/** An optional field as its column: absent by design is null. */
function unsetAsNull({ value }: { value: string | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Whether two stored rows are the same retirement, column for column.
 *
 * @param left one row
 * @param right the other
 * @returns true when every column agrees
 */
function sameColumns({ left, right }: { left: StoredSupersession; right: StoredSupersession }): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.kind === right.kind &&
    left.propertyId === right.propertyId &&
    left.pass === right.pass &&
    left.mode === right.mode &&
    left.branch === right.branch &&
    left.reason === right.reason &&
    left.replacedBy === right.replacedBy &&
    left.atIso === right.atIso
  );
}

/**
 * Fold the old file's lines to one retirement per artifact, the LAST line winning — the file reader's own rule,
 * so the import keeps exactly what that reader answered.
 *
 * @param records the file's retirements, in file order
 * @returns one per artifact id, in first-seen order
 */
export function foldImportedSupersessions({ records }: { records: readonly Supersession[] }): readonly Supersession[] {
  const byArtifact = new Map<string, Supersession>();
  for (const record of records) {
    byArtifact.set(record.artifactId, record);
  }
  return [...byArtifact.values()];
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
  rows: SupersessionRows;
  seams: SupersessionSeams;
}): Promise<Result<undefined, SupersessionStoreError>> {
  return ensureImported({
    readSource: () => seams.readImportFile({ home }),
    rows,
    unavailable: SupersessionStoreErrors.storeUnavailable,
  });
}

/**
 * Read every retirement.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the map, or the refusal
 */
async function readWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: SupersessionRows;
  seams: SupersessionSeams;
}): Promise<Result<ReadonlyMap<string, Supersession>, SupersessionStoreError>> {
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const stored = await rows.readAll();
  if (stored.isErr()) {
    return err(SupersessionStoreErrors.storeUnavailable(stored.error));
  }
  const held = await confirmEmptyRead({
    rowCount: stored.value.length,
    rows,
    unavailable: SupersessionStoreErrors.storeUnavailable,
  });
  if (held.isErr()) {
    return err(held.error);
  }
  const retired = new Map<string, Supersession>();
  for (const row of stored.value) {
    const decoded = decodeStoredSupersession({ row });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    retired.set(decoded.value.artifactId, decoded.value);
  }
  return ok(retired);
}

/**
 * Append one retirement, insert-only.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param row the retirement
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the retirement as stored, or the refusal
 */
async function appendWith({
  home,
  row,
  rows,
  seams,
}: {
  home: string;
  row: Supersession;
  rows: SupersessionRows;
  seams: SupersessionSeams;
}): Promise<Result<Supersession, SupersessionStoreError>> {
  const valid = decodeSupersession({ value: row });
  if (valid.isErr()) {
    return err(SupersessionStoreErrors.recordInvalid({ artifactId: row.artifactId, reason: valid.error.message }));
  }
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const inserted = await rows.insert({ row: valid.value });
  if (inserted.isErr()) {
    return err(SupersessionStoreErrors.storeUnavailable(inserted.error));
  }
  if (inserted.value !== undefined) {
    // The row the store answers with is checked like any stored row, and must be the retirement that was sent.
    if (!sameColumns({ left: inserted.value, right: supersessionColumns({ row: valid.value }) })) {
      return err(
        SupersessionStoreErrors.recordInvalid({
          artifactId: row.artifactId,
          reason: "came back from its insert altered",
        }),
      );
    }
    return decodeStoredSupersession({ row: inserted.value });
  }
  // The artifact was already retired — by the import, or by another writer. The same act, or a different one.
  const existing = await rows.readArtifact({ artifactId: row.artifactId });
  if (existing.isErr()) {
    return err(SupersessionStoreErrors.storeUnavailable(existing.error));
  }
  if (existing.value === undefined) {
    return err(
      SupersessionStoreErrors.storeUnavailable({
        doing: "read back the retirement its insert collided with",
        reason: `no row retires ${row.artifactId}`,
      }),
    );
  }
  const stored = decodeStoredSupersession({ row: existing.value });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (!sameColumns({ left: existing.value, right: supersessionColumns({ row: valid.value }) })) {
    return err(SupersessionStoreErrors.alreadySuperseded({ stored: stored.value }));
  }
  return ok(stored.value);
}

/**
 * A supersession port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./supersessionStore.ts`'s
 * @returns the port
 */
export function storeSupersessionPort({ seams }: { seams: SupersessionSeams }): SupersessionPort {
  return {
    append: ({ home, row }) =>
      overConnection({
        body: (rows) => appendWith({ home, row, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: SupersessionStoreErrors.storeUnavailable,
      }),
    read: ({ home }) =>
      overConnection({
        body: (rows) => readWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: SupersessionStoreErrors.storeUnavailable,
      }),
  };
}
