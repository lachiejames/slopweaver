/**
 * `supervisor tick-reseal`'s streamed pass: hash every byte of a tick ledger, reseal each row through
 * `./tickReseal.ts`, and apply the ledger-order checks the ordinary reader applies. Reads only — the preview runs it
 * bare, and the apply (`./tickResealStore.ts`) hands it a writer into its staging file.
 *
 * A row whose stats already match is written back as the exact line it was read as; only a resealed row is
 * re-rendered, through `supervisorTickLine`. The pass also counts how many rows re-render byte-identically with
 * their recorded stats, so the preview says whether a re-render alone would have moved anything else.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

import { readJsonlDescriptorLines } from "../corpus/corpusStore.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { admitTickRowInOrder, emptyTickLedgerCheck, type TickLedgerCheck } from "./tickLedgerCheck.js";
import { resealSupervisorTickRow } from "./tickReseal.js";
import { type TickResealError, TickResealErrors } from "./tickResealErrors.js";
import { supervisorTickLine } from "./tickStore.js";

/** One pass's tally — the plan's numbers plus the defects that stop it. */
export interface PassOutcome {
  readonly sha256: string;
  readonly rowsRead: number;
  readonly rowsChanged: number;
  readonly rowsRenderedAsRead: number;
  readonly defects: readonly string[];
}

/**
 * The sha256 of a whole file, read in chunks so its size never meets one buffer.
 *
 * @param path the file to hash
 * @returns the lowercase hex digest
 */
export function sha256OfFile({ path }: { path: string }): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * One streamed pass: hash every byte, reseal every row, apply the ledger-order checks, and hand each output line
 * to `write` when one is given. Once a defect is found the remaining lines are hashed and passed through, never
 * judged, exactly as the ordinary reader stops at its first.
 *
 * @param source the file the bytes are read from
 * @param label the ledger as a defect names it — the backup is read, the ledger is what a reader looks at
 * @param write where the rewritten lines go, or `undefined` for a preview
 * @returns the tally; throws only on a filesystem fault
 */
export function resealPass({
  source,
  label,
  write,
}: {
  source: string;
  label: string;
  write: ((args: { text: string }) => void) | undefined;
}): PassOutcome {
  const hash = createHash("sha256");
  const check = emptyTickLedgerCheck();
  const tally = { rowsChanged: 0, rowsRead: 0, rowsRenderedAsRead: 0 };
  // The pass learns a line was the LAST only when the read ends, and a final empty "line" is just the trailing
  // newline — so each output line is held until the next arrives. A holder object, because it is assigned in the
  // line callback, where control-flow narrowing cannot see the assignment.
  const held: { pending: string | undefined } = { pending: undefined };
  const fd = openSync(source, "r");
  try {
    readJsonlDescriptorLines({
      fd,
      onBytes: ({ bytes }) => {
        hash.update(bytes);
      },
      onLine: ({ line, index, undecodable }) => {
        const output = outputLine({ check, index, label, line, tally, undecodable });
        if (write !== undefined && held.pending !== undefined) {
          write({ text: `${held.pending}\n` });
        }
        held.pending = output;
      },
      strictUtf8: true,
    });
  } finally {
    closeSync(fd);
  }
  if (write !== undefined && held.pending !== undefined && held.pending.length > 0) {
    write({ text: `${held.pending}\n` });
  }
  return { ...tally, defects: check.defects, sha256: hash.digest("hex") };
}

/**
 * Judge one line and say what the rewrite writes for it: the exact line, or the resealed row's own render.
 *
 * @param line the line as read
 * @param index its zero-based position
 * @param label the ledger, for a defect's `<ledger>:<line>`
 * @param undecodable whether a byte in it is not UTF-8
 * @param check the pass's ledger-order state, which collects every defect
 * @param tally the pass's counts, bumped here
 * @returns the text to write for this line
 */
function outputLine({
  line,
  index,
  label,
  undecodable,
  check,
  tally,
}: {
  line: string;
  index: number;
  label: string;
  undecodable: boolean;
  check: TickLedgerCheck;
  tally: { rowsChanged: number; rowsRead: number; rowsRenderedAsRead: number };
}): string {
  if (check.defects.length > 0 || line.trim().length === 0) {
    return line;
  }
  const where = `${label}:${String(index + 1)}`;
  if (undecodable) {
    check.defects.push(`${where}: a byte in the line is not UTF-8`);
    return line;
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "a supervisor tick ledger line", text: line });
  } catch (error: unknown) {
    check.defects.push(
      `${where}: the line is not readable JSON: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return line;
  }
  const resealed = resealSupervisorTickRow({ value });
  if (resealed.isErr()) {
    check.defects.push(`${where}: ${resealed.error.join("; ")}`);
    return line;
  }
  const { row, before, changed } = resealed.value;
  if (!admitTickRowInOrder({ check, row, where })) {
    return line;
  }
  tally.rowsRead += 1;
  if (supervisorTickLine({ row: { ...row, stats: before } }) === line) {
    tally.rowsRenderedAsRead += 1;
  }
  if (!changed) {
    return line;
  }
  tally.rowsChanged += 1;
  return supervisorTickLine({ row });
}

/**
 * The refusal a finished pass earns, if any — a moved digest first, since every other finding is about bytes the
 * caller did not mean.
 *
 * @param outcome the pass's tally
 * @param expected the digest the caller named, or `undefined` for a preview
 * @param path the ledger
 * @returns the refusal, or `undefined` when the pass stands
 */
export function passRefusal({
  outcome,
  expected,
  path,
}: {
  outcome: PassOutcome;
  expected: string | undefined;
  path: string;
}): TickResealError | undefined {
  if (expected !== undefined && outcome.sha256 !== expected) {
    return TickResealErrors.sourceMoved({ actual: outcome.sha256, expected });
  }
  if (outcome.defects.length > 0) {
    return TickResealErrors.ledgerRefused({ reasons: outcome.defects });
  }
  if (outcome.rowsRead === 0) {
    return TickResealErrors.ledgerUnreadable({ path, why: "it holds no tick rows" });
  }
  return undefined;
}
