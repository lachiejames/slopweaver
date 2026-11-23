/**
 * `store import-fleet --only autonomy` — the ONE-TIME import of a legacy `ledgers/autonomy.jsonl` into
 * `autonomy_event`, which is the ledger from then on (`../../../autonomy/port.ts`).
 *
 * Every line is validated by the record rules first; one refused line refuses the import, because an authority
 * that skipped a line would be a ledger that quietly lost an act — `slopweaver autonomy adopt` is the repair.
 * Every insert is `DO NOTHING` on any unique index, then the rows are READ BACK and each line compared with the
 * row the store holds for it: a line that disagrees is `AUTONOMY_IMPORT_DIVERGED`, never an overwrite.
 *
 * Only a clean pass — every line valid, every write landed, nothing diverged — writes the `autonomy_register`
 * marker, and it is written LAST. Until then the port refuses every read and write with `AUTONOMY_NOT_IMPORTED`,
 * so a crash part-way leaves the ledger loudly unavailable rather than quietly short; a rerun converges over the
 * rows already inserted. Once the marker stands a rerun VERIFIES only: a later edit to the file is a divergence
 * to look at, never new authority.
 *
 * The register's own operation lock is held across the read and the writes, so `autonomy adopt` cannot rewrite
 * the file between the lines this pass validated and the rows it inserted.
 */
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { AUTONOMY_REGISTER_LOCK_KEY } from "../../../autonomy/importRegister.js";
import { filePresence } from "../../../autonomy/storeRows.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import type { Result } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import type { StoreError } from "../../../store/errors.js";
import {
  autonomyImportDivergences,
  type ProjectedAutonomyLine,
  projectAutonomyLine,
  type StoredAutonomyImportRow,
} from "../../../store/fleet/autonomyEvent.js";
import {
  importAutonomyEvents,
  markAutonomyImported,
  readAutonomyImported,
  readStoredAutonomyRows,
} from "../../../store/fleet/autonomyStore.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import type { NewAutonomyEventRecord } from "../../../store/schema/ledgers.js";

import type { LegOutcome } from "./importFleetCore.js";

/** The four store operations the import performs, injected so a unit test drives every branch without a database. */
export interface AutonomyImportStore {
  readonly imported: () => Promise<Result<boolean, StoreError>>;
  readonly insert: (request: {
    readonly rows: readonly NewAutonomyEventRecord[];
  }) => Promise<Result<number, StoreError>>;
  readonly readBack: () => Promise<Result<readonly StoredAutonomyImportRow[], StoreError>>;
  readonly mark: () => Promise<Result<void, StoreError>>;
}

/**
 * The import's store operations over one open connection.
 *
 * @param client the open store connection the CLI owns
 * @returns the operations
 */
export function autonomyImportStoreOver({ client }: { client: StoreClient }): AutonomyImportStore {
  return {
    imported: () => readAutonomyImported({ client }),
    insert: ({ rows }) => importAutonomyEvents({ client, rows }),
    mark: () => markAutonomyImported({ client }),
    readBack: () => readStoredAutonomyRows({ client }),
  };
}

/** Every line of the register projected, and every one that was refused, in file order. */
function readRegister({ path }: { path: string }): {
  projected: ProjectedAutonomyLine[];
  refused: FleetImportError[];
} {
  const projected: ProjectedAutonomyLine[] = [];
  const refused: FleetImportError[] = [];
  readJsonlLines({
    onLine: ({ line, index }) => {
      if (line.trim().length === 0) {
        return;
      }
      const lineNumber = index + 1;
      const row = projectAutonomyLine({ line, lineNumber, path });
      if (row.isErr()) {
        refused.push(row.error);
        return;
      }
      projected.push({ lineNumber, row: row.value });
    },
    path,
  });
  return { projected, refused };
}

/** The import itself, run under the register's lock. */
async function importUnderLock({
  path,
  store,
}: {
  path: string;
  store: AutonomyImportStore;
}): Promise<{ projected: number; refused: FleetImportError[]; written: number; notes: string[] }> {
  const { projected, refused } = readRegister({ path });
  const notes: string[] = [];
  const outcome = { notes, projected: projected.length, refused, written: 0 };
  const imported = await store.imported();
  if (imported.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path, reason: imported.error.message }));
    return outcome;
  }
  if (!imported.value) {
    if (refused.length > 0) {
      outcome.notes.push(`nothing written — ${String(refused.length)} line(s) refused; repair them, then import again`);
      return outcome;
    }
    const written = await store.insert({ rows: projected.map(({ row }) => row) });
    if (written.isErr()) {
      refused.push(FleetImportErrors.legWriteFailed({ path, reason: written.error.message }));
      return outcome;
    }
    outcome.written = written.value;
  }
  const stored = await store.readBack();
  if (stored.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path, reason: `read-back failed: ${stored.error.message}` }));
    return outcome;
  }
  refused.push(...autonomyImportDivergences({ path, projected, stored: stored.value }));
  if (imported.value) {
    outcome.notes.push("already imported — verified only; the store is the ledger and the file is not read for it");
    return outcome;
  }
  if (refused.length > 0) {
    outcome.notes.push("not marked imported — the ledger stays refused until a clean pass");
    return outcome;
  }
  const marked = await store.mark();
  if (marked.isErr()) {
    refused.push(
      FleetImportErrors.legWriteFailed({ path, reason: `marking the import failed: ${marked.error.message}` }),
    );
    return outcome;
  }
  outcome.notes.push("marked imported — the store is the ledger from here on");
  return outcome;
}

/**
 * Import the legacy autonomy register once, or verify an import that already ran.
 *
 * @param store the store operations, or `undefined` on a dry run, which validates every line and writes nothing
 * @param home the state home whose register lock is taken
 * @param path the register file
 * @param nowIso the instant the lock is taken at, for its own staleness check
 * @returns what this leg did; a refused line, a failed write and a divergence are each a refusal
 */
export async function runAutonomyLeg({
  store,
  home,
  path,
  nowIso,
}: {
  store: AutonomyImportStore | undefined;
  home: string;
  path: string;
  nowIso: string;
}): Promise<LegOutcome> {
  const base = { absentSource: undefined, leg: "autonomy" as const, unreadableLines: 0 };
  const presence = filePresence({ path });
  if (presence.kind === "absent") {
    return { ...base, absentSource: path, projected: 0, refused: [], written: 0 };
  }
  if (presence.kind === "unknown") {
    const reason = `the register could not be located: ${presence.reason}`;
    return { ...base, projected: 0, refused: [FleetImportErrors.legWriteFailed({ path, reason })], written: 0 };
  }
  if (store === undefined) {
    const { projected, refused } = readRegister({ path });
    return { ...base, projected: projected.length, refused, written: 0 };
  }
  const lock = acquireOperationLock({ home, key: AUTONOMY_REGISTER_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return {
      ...base,
      projected: 0,
      refused: [FleetImportErrors.legWriteFailed({ path, reason: `the register is busy: ${lock.error}` })],
      written: 0,
    };
  }
  try {
    const outcome = await importUnderLock({ path, store });
    return { ...base, ...outcome };
  } finally {
    lock.value.release();
  }
}
