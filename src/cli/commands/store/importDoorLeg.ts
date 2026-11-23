/**
 * `store import-fleet --only door` — the ONE-TIME import of an old `ledgers/door.jsonl` into `door_event`, which
 * is the door's ledger from then on (`../../../admit/doorStorePort.ts`).
 *
 * The file is two hundred thousand lines, so nothing here holds it whole:
 *
 * 1. **Validate.** One pass projects every line and keeps only a digest per import key. A line that does not
 *    project, or carries a NUL `jsonb` cannot hold, refuses the import before anything is written: an authority
 *    that skipped a line would be a trail that quietly lost a decision.
 * 2. **Write.** A second pass, resumed at line boundaries every {@link FLUSH_ROWS} rows, inserts each batch, and
 *    FILLS a mirror row whose verbatim `record` the one-way mirror never wrote. A row that already holds a record is
 *    never overwritten.
 * 3. **Read back.** Every non-live row is paged out in `seq` order and folded against the digests in BOTH
 *    directions (`../../../store/fleet/doorImport.ts`): a line with no row, a row with no line, an unfilled row and
 *    a differing record are each `DOOR_IMPORT_DIVERGED`.
 * 4. **Mark.** Only a clean pass whose file did not change underneath it writes the `door_register` marker, LAST.
 *    Until then the port refuses every door call with `DOOR_NOT_IMPORTED`, so a crash part-way leaves the door
 *    loudly closed rather than quietly short; a rerun converges over the rows already written.
 *
 * Nothing locks the file, so the stamp is checked again once the marker is written: an append landing in that
 * window is refused loudly rather than reported as a clean import.
 *
 * Once the marker stands a rerun VERIFIES only, and names every line with no row. A binary from before the switch
 * still appends to the file, and a line it appends after the marker is never imported by default — stop every seat
 * before the cutover. When one got through anyway, `--only door --adopt-unmatched-door-lines` is the operator's
 * one-shot repair: it inserts exactly the lines with no row, and only when they are the WHOLE divergence (no row
 * without a line, no unfilled or differing record, an unchanged file), then reads everything back again. MEASURED:
 * two lines a seat on pre-cutover code appended nine minutes after the marker,
 * held the nightly `store-import-fleet-nightly` recipe red with no route out (repro:
 * `slopweaver store import-fleet --only door`). The nightly never carries the flag: adopting retired-file content
 * into the authority is a decision, not a schedule. An adopted row takes the next `seq`, so it sorts after every
 * live row written since the cutover.
 */
import { filePresence } from "../../../autonomy/storeRows.js";
import type { StoreClient } from "../../../store/client.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import {
  importDoorRecords,
  markDoorImported,
  readDoorImported,
  readStoredDoorPage,
} from "../../../store/fleet/store.js";

import { changedFileRefusals, fileStamp } from "./doorFileStamp.js";
import { type DoorImportStore, readBack, validateLedger, writeLedger } from "./importDoorPasses.js";
import type { LegOutcome } from "./importFleetCore.js";

/**
 * The import's store operations over one open connection.
 *
 * @param client the open store connection the CLI owns
 * @returns the operations
 */
export function doorImportStoreOver({ client }: { client: StoreClient }): DoorImportStore {
  return {
    imported: () => readDoorImported({ client }),
    insert: ({ rows }) => importDoorRecords({ client, rows }),
    mark: () => markDoorImported({ client }),
    readPage: ({ afterSeq, limit }) => readStoredDoorPage({ afterSeq, client, limit }),
  };
}

/** What the door leg accumulates as it runs — the leg outcome's counted half. */
interface DoorLegTally {
  readonly notes: string[];
  readonly projected: number;
  readonly refused: FleetImportError[];
  written: number;
}

/** The note a marked import's verification ends on when it adopts nothing. */
function markedNote({ adopt, blocked }: { adopt: boolean; blocked: boolean }): string {
  if (!adopt) {
    return "already imported — verified only; the store is the ledger and the file is not read for it";
  }
  if (blocked) {
    return "adoption skipped — a divergence other than a line with no row, or a changed file; nothing written";
  }
  return "already imported — verified clean; no line without a row, so nothing to adopt";
}

/**
 * A marked import: verify, and — only when asked, and only when every divergence is a file line with no row —
 * adopt those lines.
 */
async function verifyMarked({
  adopt,
  before,
  expected,
  outcome,
  path,
  store,
}: {
  adopt: boolean;
  before: string;
  expected: Map<string, string>;
  outcome: DoorLegTally;
  path: string;
  store: DoorImportStore;
}): Promise<DoorLegTally> {
  const back = await readBack({ expected, path, store });
  // A verify reads the file once too, so a line appended after that read is caught here rather than passed over.
  const changed = changedFileRefusals({ before, path, verifying: true });
  const blocked = outcome.refused.length > 0 || back.other.length > 0 || changed.length > 0;
  if (!adopt || blocked || back.unmatchedKeys.length === 0) {
    outcome.refused.push(...back.other, ...back.unmatched, ...changed);
    outcome.notes.push(markedNote({ adopt, blocked }));
    return outcome;
  }
  return adoptUnmatched({ before, keys: back.unmatchedKeys, outcome, path, store });
}

/**
 * Insert exactly the unmatched lines' rows, then verify the whole file again from a fresh read: success is what the
 * final read-back says, never the insert count, so a partial batch or a concurrent adopter converges on a rerun.
 */
async function adoptUnmatched({
  before,
  keys,
  outcome,
  path,
  store,
}: {
  before: string;
  keys: readonly string[];
  outcome: DoorLegTally;
  path: string;
  store: DoorImportStore;
}): Promise<DoorLegTally> {
  const wrote = await writeLedger({ only: new Set(keys), path, store });
  outcome.written = wrote.written;
  const final = validateLedger({ path });
  const back = await readBack({ expected: final.expected, path, store });
  outcome.refused.push(
    ...wrote.refused,
    ...final.refused,
    ...back.other,
    ...back.unmatched,
    ...changedFileRefusals({ before, path, verifying: true }),
  );
  if (outcome.refused.length > 0) {
    outcome.notes.push("adoption not confirmed — the final read-back is not clean; import again with the flag");
    return outcome;
  }
  outcome.notes.push(
    ...wrote.picked.map(
      ({ importKey, lineNumber }) => `adopted door line ${path}:${String(lineNumber)} as ${importKey}`,
    ),
    "adopted — the final read-back is clean; the store is the door's ledger",
  );
  return outcome;
}

/** The import itself, once the file is known to be there and a store is open. */
async function importLedger({
  adopt,
  path,
  store,
}: {
  adopt: boolean;
  path: string;
  store: DoorImportStore;
}): Promise<DoorLegTally> {
  const notes: string[] = [];
  const before = fileStamp({ path });
  if (before.isErr()) {
    return {
      notes,
      projected: 0,
      refused: [before.error],
      written: 0,
    };
  }
  const { expected, refused } = validateLedger({ path });
  const outcome = { notes, projected: expected.size, refused, written: 0 };
  const imported = await store.imported();
  if (imported.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path, reason: imported.error.message }));
    return outcome;
  }
  if (imported.value) {
    return verifyMarked({ adopt, before: before.value, expected, outcome, path, store });
  }
  if (adopt) {
    // The flag is the operator's repair of a MARKED import; a first import it did not ask for is never its side effect.
    const reason =
      "--adopt-unmatched-door-lines repairs a marked import and this store has no import marker; run `store import-fleet --only door` without it to import";
    refused.push(FleetImportErrors.legWriteFailed({ path, reason }));
    notes.push("nothing written — adoption needs a marked import");
    return outcome;
  }
  return firstImport({ before: before.value, expected, outcome, path, store });
}

/** Passes 2–4 of a first import into an unmarked store: write every line, read back, then mark. */
async function firstImport({
  before,
  expected,
  outcome,
  path,
  store,
}: {
  before: string;
  expected: Map<string, string>;
  outcome: DoorLegTally;
  path: string;
  store: DoorImportStore;
}): Promise<DoorLegTally> {
  const { notes, refused } = outcome;
  if (refused.length > 0) {
    notes.push(`nothing written — ${String(refused.length)} line(s) refused; repair them, then import again`);
    return outcome;
  }
  const wrote = await writeLedger({ only: undefined, path, store });
  outcome.written = wrote.written;
  if (wrote.refused.length > 0) {
    refused.push(...wrote.refused);
    notes.push("not marked imported — the door stays refused until a clean pass");
    return outcome;
  }
  const back = await readBack({ expected, path, store });
  refused.push(...back.other, ...back.unmatched);
  refused.push(...changedFileRefusals({ before, path, verifying: false }));
  if (refused.length > 0) {
    notes.push("not marked imported — the door stays refused until a clean pass");
    return outcome;
  }
  const markFailed = await markImported({ before, path, store });
  if (markFailed !== undefined) {
    refused.push(markFailed);
    return outcome;
  }
  notes.push("marked imported — the store is the door's ledger from here on");
  return outcome;
}

/** Pass 4: write the import marker, then stamp the file again; the refusal when either fails, else nothing. */
async function markImported({
  before,
  path,
  store,
}: {
  before: string;
  path: string;
  store: DoorImportStore;
}): Promise<FleetImportError | undefined> {
  const marked = await store.mark();
  if (marked.isErr()) {
    return FleetImportErrors.legWriteFailed({ path, reason: `marking the import failed: ${marked.error.message}` });
  }
  // Nothing locks the file, so an append can still land while the marker is being written. Stamp it again: a
  // changed file now is refused loudly, and the rerun that refusal asks for verifies and names the line with no row.
  const settled = fileStamp({ path });
  if (settled.isErr() || settled.value !== before) {
    const reason =
      "the file changed while the import was being marked — the marker stands; stop every seat still writing it, then import again to verify";
    return FleetImportErrors.legWriteFailed({ path, reason });
  }
  return undefined;
}

/**
 * Import the old door ledger file once, or verify an import that already ran — and, when asked, adopt the lines a
 * marked import has no row for.
 *
 * @param adoptUnmatchedDoorLines `--adopt-unmatched-door-lines`: on a marked import whose only divergence is file
 *   lines with no row, insert those lines; before the marker it refuses and writes nothing
 * @param store the store operations, or `undefined` on a dry run, which validates every line and writes nothing
 * @param path the ledger file
 * @returns what this leg did; a refused line, a failed write, a changed file and a divergence are each a refusal
 */
export async function runDoorLeg({
  adoptUnmatchedDoorLines,
  store,
  path,
}: {
  adoptUnmatchedDoorLines: boolean;
  store: DoorImportStore | undefined;
  path: string;
}): Promise<LegOutcome> {
  const base = { absentSource: undefined, leg: "door" as const, unreadableLines: 0 };
  const presence = filePresence({ path });
  if (presence.kind === "absent") {
    return { ...base, absentSource: path, projected: 0, refused: [], written: 0 };
  }
  if (presence.kind === "unknown") {
    const reason = `the ledger could not be located: ${presence.reason}`;
    return { ...base, projected: 0, refused: [FleetImportErrors.legWriteFailed({ path, reason })], written: 0 };
  }
  if (store === undefined) {
    const { expected, refused } = validateLedger({ path });
    return { ...base, projected: expected.size, refused, written: 0 };
  }
  return { ...base, ...(await importLedger({ adopt: adoptUnmatchedDoorLines, path, store })) };
}
