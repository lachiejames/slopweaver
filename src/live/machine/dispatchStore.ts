/**
 * THE DISPATCH REGISTER — durable I/O for `./dispatchRow.ts`, one append-only JSONL file under
 * `$SLOPWEAVER_HOME`, and the reads `slopweaver machine dispatches`, `machine capacity --json` and
 * `../../supervisor/loadDispatchGate.ts` all take off it.
 *
 * Modelled on `../../events/store.ts` beside it, deliberately: same append-only shape, same 0o700 directory
 * mode, same reason for the mode (these rows name pids and process labels).
 *
 * ## A settlement is an APPEND, never an edit
 *
 * Settling a row writes a new line carrying the same id and a `settled` block; the reader folds the file by
 * id, last write winning. Rewriting the file in place would mean a reader could catch it mid-write and see
 * a truncated register — and this register's whole job is to be readable at the exact moment the machine is
 * least healthy. An append is one `write` of one line.
 *
 * Everything that DECIDES anything about a row is pure and lives in `./dispatchRow.ts` and `./backoff.ts`;
 * this module only moves bytes.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { slopweaverHome } from "../../config.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import { type DispatchRow, isOpen, parseDispatchRow } from "./dispatchRow.js";

/** Owner-only, matching the event stream beside it — these rows name pids and process labels. */
const DIR_MODE = 0o700;

/**
 * Where the register lives.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute path to the register file
 */
export function dispatchRegisterPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).live.machine.dispatchesJsonl;
}

/**
 * Append one row, or one settlement of an existing row.
 *
 * @param row the row to write — a settlement is the same id carrying a `settled` block
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the one-line reason the append failed
 */
export function appendDispatchRow({ row, home = slopweaverHome() }: { row: DispatchRow; home?: string }): Result<void> {
  const path = dispatchRegisterPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ path, text: `${safeJsonStringify({ label: "a machine dispatch row", value: row })}\n` });
  } catch (error: unknown) {
    return err([`could not append to the dispatch register at ${path}: ${String(error)}`]);
  }
  return ok(undefined);
}

/**
 * Every row in the register, folded by id so the newest write of each wins, NEWEST OBSERVATION FIRST.
 *
 * A line that will not parse is SKIPPED rather than failing the read: this file is appended to while the
 * machine is in trouble, and one bad line must not blind the gate to every good one. A file that does not
 * exist yet is an empty register, which is the normal state of a fresh install rather than a failure.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns every row, or the one-line reason the register could not be read at all
 */
export function readDispatchRows({ home = slopweaverHome() }: { home?: string } = {}): Result<readonly DispatchRow[]> {
  const path = dispatchRegisterPath({ home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const byId = new Map<string, DispatchRow>();
  try {
    // One line at a time behind a bounded chunk. The register is append-only with no ceiling, so reading
    // the whole of it into one JS string is the class `whole-file-json` refuses — and this file is read
    // exactly when the machine is least able to afford a transient heap spike.
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        let value: unknown;
        try {
          value = safeJsonParse({ label: "a machine dispatch row", text: line });
        } catch {
          return;
        }
        const row = parseDispatchRow({ value });
        if (row === undefined) {
          return;
        }
        // A settlement is STICKY: a later line for the same id that carries none never re-opens the row. The
        // watch appends a `registered` line before its spawn and the final seat line after it, minutes apart
        // under load, and a settle landing in between would otherwise be undone by the second append.
        // A seat is sticky the same way: a `registered` line never replaces a seat the spawn already reported —
        // a settle that read the row before the final append writes its line carrying the stale `registered`.
        const prior = byId.get(row.id);
        let merged = row;
        if (row.settled === undefined && prior?.settled !== undefined) {
          merged = { ...merged, settled: prior.settled };
        }
        if (row.seated.kind === "registered" && prior !== undefined && prior.seated.kind !== "registered") {
          merged = { ...merged, seated: prior.seated };
        }
        byId.set(row.id, merged);
      },
      path,
    });
  } catch (error: unknown) {
    return err([`could not read the dispatch register at ${path}: ${String(error)}`]);
  }
  return ok([...byId.values()].toSorted((a, b) => b.observedIso.localeCompare(a.observedIso)));
}

/**
 * The OPEN rows, newest first — what the gate reads to decide whether a hold has been answered.
 *
 * @param rows every row in the register
 * @returns the rows nobody has settled
 */
export function openDispatches({ rows }: { rows: readonly DispatchRow[] }): readonly DispatchRow[] {
  return rows.filter((row) => isOpen({ row }));
}

/**
 * The open rows that are an INVESTIGATION — what the gate counts, and a strict subset of
 * {@link openDispatches}.
 *
 * An open row means only that nobody has settled it. A row whose `seated` arm is `none` — a seat the
 * backoff suppressed, or a `cmux spawn` that failed — is an unanswered alert, the opposite of coverage.
 * Counting it as coverage made the one case where the fleet TRIED to investigate and could not the case
 * where the gate stopped asking (review pass r2 `gate-cannot-be-satisfied-by-assertion`). A `registered` row
 * does not cover either: its spawn never reported, and a spawn nobody confirmed covers nothing.
 *
 * @param rows every row in the register
 * @returns the unsettled rows that actually seated a visible session
 */
export function coveringDispatches({ rows }: { rows: readonly DispatchRow[] }): readonly DispatchRow[] {
  return rows.filter((row) => isOpen({ row }) && row.seated.kind === "seated");
}

/**
 * How long a `registered` seat — a board row whose `cmux spawn` never reported — still counts as a LIVE
 * investigation. Inside it, a second seat on the signature would duplicate a spawn that may yet boot; past
 * it, the row stops holding the signature and the backoff governs, so a spawn that really died cannot make
 * its signature un-investigable forever (`./backoff.ts`'s promise). Set equal to `machine watch`'s sampling cap
 * (`MAX_WATCH_SECONDS`, `../../cli/commands/machine/watch.ts`) as a first measurement; a seating spawn can run
 * past it, and a killed spawn was re-run and booted inside 280s.
 *
 * The trade, stated: nothing ever promotes a `registered` row to `seated`. When the chair re-spawns it by
 * hand, or the killed watch's spawn booted after all, the signature is released after this window anyway and
 * a later watch may open a second seat on it, rate-limited only by the backoff. Promoting the row would need
 * a second notion of liveness (cmux titles), which the liveness read deliberately does not have.
 */
export const REGISTERED_LIVE_SECONDS = 900;

/**
 * The signatures an investigation is live on right now — what `machine watch` skips rather than seats.
 *
 * Read off the register rather than cmux titles, so liveness has one notion: an unsettled `seated` row, or an
 * unsettled `registered` row younger than {@link REGISTERED_LIVE_SECONDS}.
 *
 * @param rows every row in the register
 * @param nowMs the instant liveness is judged at, epoch milliseconds
 * @returns the live signatures
 */
export function liveDispatchSignatures({
  rows,
  nowMs,
}: {
  rows: readonly DispatchRow[];
  nowMs: number;
}): ReadonlySet<string> {
  return new Set(
    rows
      .filter((row) => {
        if (!isOpen({ row })) {
          return false;
        }
        if (row.seated.kind === "seated") {
          return true;
        }
        if (row.seated.kind === "registered") {
          return nowMs - Date.parse(row.seated.sinceIso) < REGISTERED_LIVE_SECONDS * 1000;
        }
        return false;
      })
      .map((row) => row.signature),
  );
}

/**
 * The rows carrying one signature, newest first — the population `./backoff.ts` counts.
 *
 * @param rows every row in the register
 * @param signature the dedupe key to select
 * @returns that signature's rows
 */
export function rowsForSignature({
  rows,
  signature,
}: {
  rows: readonly DispatchRow[];
  signature: string;
}): readonly DispatchRow[] {
  return rows.filter((row) => row.signature === signature);
}
