/**
 * The door import's three streaming passes over `ledgers/door.jsonl` and `door_event` — validate, write, read back —
 * and the store seam they run over. `./importDoorLeg.ts` is the orchestration that decides which pass runs when,
 * and whether the import may be marked or a late line adopted; this file holds no policy, only the passes.
 */
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { StoreError } from "../../../store/errors.js";
import { LAST_PROVEN_TEST_WRITE_ISO, projectDoorLine } from "../../../store/fleet/doorEvent.js";
import {
  type DoorReadBackSplit,
  doorRecordDigest,
  foldStoredDoorPage,
  holdsNul,
  type StoredDoorImportRow,
  splitUnmatchedDoorKeys,
} from "../../../store/fleet/doorImport.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import type { NewDoorEventRecord } from "../../../store/schema/ledgers.js";

import { FLUSH_ROWS } from "./importFleetCore.js";

/** How many stored rows one read-back page holds. */
const READ_PAGE_ROWS = 5_000;

/** The four store operations the import performs, injected so a unit test drives every branch without a database. */
export interface DoorImportStore {
  readonly imported: () => Promise<Result<boolean, StoreError>>;
  readonly insert: (request: { readonly rows: readonly NewDoorEventRecord[] }) => Promise<Result<number, StoreError>>;
  /** One page of non-live rows in `seq` order, after `afterSeq` — or from the very first row when it is unset. */
  readonly readPage: (request: {
    readonly afterSeq: number | undefined;
    readonly limit: number;
  }) => Promise<Result<readonly StoredDoorImportRow[], StoreError>>;
  readonly mark: () => Promise<Result<void, StoreError>>;
}

/** A row a write pass sent, by the physical line it came from — what an adoption note names. */
export interface PickedLine {
  readonly importKey: string;
  readonly lineNumber: number;
}

/** One line projected, or the refusal it earns — a NUL included, which the live writer refuses the same way. */
function projectedLine({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<NewDoorEventRecord, FleetImportError> {
  const row = projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line, lineNumber, path });
  if (row.isErr()) {
    return row;
  }
  if (holdsNul({ value: row.value.record })) {
    return err(
      FleetImportErrors.doorLineUnstorable({
        importKey: row.value.importKey,
        lineNumber,
        path,
        why: "it holds a NUL character, and stripping one would change what the trail says was decided",
      }),
    );
  }
  return ok(row.value);
}

/**
 * Pass 1: every line's digest by import key, and every refusal, holding nothing else.
 *
 * @param path the ledger file
 * @returns the digests in file order, and each line that would not project
 */
export function validateLedger({ path }: { path: string }): {
  expected: Map<string, string>;
  refused: FleetImportError[];
} {
  const expected = new Map<string, string>();
  const refused: FleetImportError[] = [];
  readJsonlLines({
    onLine: ({ line, index }) => {
      if (line.trim().length === 0) {
        return;
      }
      const row = projectedLine({ line, lineNumber: index + 1, path });
      if (row.isErr()) {
        refused.push(row.error);
        return;
      }
      expected.set(row.value.importKey, doorRecordDigest({ record: row.value.record }));
    },
    path,
  });
  return { expected, refused };
}

/**
 * One batch of projected rows from a line boundary, and where the next batch starts — `undefined` at the end.
 * `firstIndex` keeps line numbers absolute across a resumed read, because the import key hashes the line number.
 * `only`, when set, keeps just the rows whose key it holds; every line is still projected, so every key stays exact.
 */
function readBatch({
  only,
  path,
  startByteOffset,
  firstIndex,
}: {
  only: ReadonlySet<string> | undefined;
  path: string;
  startByteOffset: number;
  firstIndex: number;
}): {
  rows: NewDoorEventRecord[];
  picked: PickedLine[];
  refused: FleetImportError[];
  next: { startByteOffset: number; firstIndex: number } | undefined;
} {
  const rows: NewDoorEventRecord[] = [];
  const picked: PickedLine[] = [];
  const refused: FleetImportError[] = [];
  let delivered = 0;
  let next: { startByteOffset: number; firstIndex: number } | undefined;
  readJsonlLines({
    onChunk: ({ bytesConsumed }) => {
      if (rows.length < FLUSH_ROWS) {
        return true;
      }
      next = { firstIndex: firstIndex + delivered, startByteOffset: bytesConsumed };
      return false;
    },
    onLine: ({ line, index }) => {
      delivered = index + 1;
      if (line.trim().length === 0) {
        return;
      }
      const row = projectedLine({ line, lineNumber: firstIndex + index + 1, path });
      if (row.isErr()) {
        refused.push(row.error);
        return;
      }
      if (only !== undefined && !only.has(row.value.importKey)) {
        return;
      }
      rows.push(row.value);
      picked.push({ importKey: row.value.importKey, lineNumber: firstIndex + index + 1 });
    },
    path,
    startByteOffset,
  });
  return { next, picked, refused, rows };
}

/**
 * Pass 2: insert or fill every line's row — or only the keys `only` holds — batch by batch.
 *
 * @param only the import keys to send, or `undefined` for every line
 * @param path the ledger file
 * @param store the store operations
 * @returns rows the store reported affected, the lines sent, and the refusal that stopped the pass, if any
 */
export async function writeLedger({
  only,
  path,
  store,
}: {
  only: ReadonlySet<string> | undefined;
  path: string;
  store: DoorImportStore;
}): Promise<{ written: number; refused: FleetImportError[]; picked: PickedLine[] }> {
  let written = 0;
  const picked: PickedLine[] = [];
  let cursor: { startByteOffset: number; firstIndex: number } | undefined = { firstIndex: 0, startByteOffset: 0 };
  while (cursor !== undefined) {
    const batch = readBatch({ only, path, ...cursor });
    if (batch.refused.length > 0) {
      // Pass 1 accepted every line, so a refusal here is a file that changed between the passes.
      return { picked, refused: batch.refused, written };
    }
    const inserted = await store.insert({ rows: batch.rows });
    if (inserted.isErr()) {
      return { picked, refused: [FleetImportErrors.legWriteFailed({ path, reason: inserted.error.message })], written };
    }
    written += inserted.value;
    picked.push(...batch.picked);
    cursor = batch.next;
  }
  return { picked, refused: [], written };
}

/**
 * Pass 3: every stored non-live row folded against the file's digests, page by page.
 *
 * @param expected the file's digests by import key — mutated: each matched key is struck off
 * @param path the ledger file, named in every divergence
 * @param store the store operations
 * @returns the divergences, lines with no row kept apart from every other kind
 */
export async function readBack({
  expected,
  path,
  store,
}: {
  expected: Map<string, string>;
  path: string;
  store: DoorImportStore;
}): Promise<DoorReadBackSplit> {
  const diverged: FleetImportError[] = [];
  // The first page has no lower bound: `seq` carries no positivity check, so a row written by hand at any value
  // is still read back.
  let afterSeq: number | undefined;
  for (;;) {
    const page = await store.readPage({ afterSeq, limit: READ_PAGE_ROWS });
    if (page.isErr()) {
      const failed = FleetImportErrors.legWriteFailed({ path, reason: `read-back failed: ${page.error.message}` });
      return { other: [failed], unmatched: [], unmatchedKeys: [] };
    }
    diverged.push(...foldStoredDoorPage({ expected, page: page.value, path }));
    const last = page.value.at(-1);
    if (last === undefined || page.value.length < READ_PAGE_ROWS) {
      break;
    }
    afterSeq = last.seq;
  }
  return splitUnmatchedDoorKeys({ expected, other: diverged, path });
}
