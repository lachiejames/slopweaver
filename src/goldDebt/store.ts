/**
 * Reading and appending the gold-debt ledger — the effectful half of {@link ./row.js} and {@link ./decode.js}.
 *
 * One append-only `ledgers/gold-debt.jsonl` under the state home, one {@link GoldDebtRecord} per line, debts
 * and their settlements interleaved in the order they happened. A session that lands a pull request below
 * gold appends to it through `slopweaver gold owe`; a session that later gathers the proof appends through
 * `slopweaver gold settle`.
 *
 * ## The read REFUSES rather than reporting empty
 *
 * `../autonomy/importRegister.ts`'s call, for the same reason and with the same force: the whole value of this
 * register is that a debt is not forgotten, so a list printing "nothing is owed" because a read failed would
 * be the exact failure it exists to prevent. Only the DEFAULT register being absent is empty — an explicitly
 * named file that is not there is a caller naming the wrong path, which is a failure and says so.
 * `existsSync` cannot draw that line, because it swallows every error and answers `false`, so a register
 * whose directory the caller cannot traverse reads identically to a fresh install that owes nothing.
 *
 * ## Why the file is streamed rather than read whole
 *
 * `.claude/rules/typescript-patterns.md`: a `.jsonl` read whole is one of three shapes the `whole-file-json`
 * gate refuses, because its size is a property of the DATA. Nothing ever removes a line here, so it goes
 * through `readJsonlLines` from the first commit rather than being converted once it gets big.
 *
 * ## Why an append takes a lock
 *
 * An append is read-check-append, not one write: a conflicting or duplicate row has to be detected against
 * what the file already holds, and a `wouldBe` plus an `evidence` routinely exceed the 4 KiB an O_APPEND
 * write is atomic within. Several fleet sessions land pull requests at once by design, so both races are
 * ordinary rather than theoretical.
 *
 * ## This register is NOT consulted by the landing lane
 *
 * The owner's ruling is that merging is not delayed and the debt is remembered instead, so no merge guard,
 * no enqueue path and no `stack push` reads this file. `../__tests__/unit/goldDebt/notAMergeBlocker.test.ts`
 * is the guard that keeps it true.
 */
import { chmodSync, mkdirSync, statSync } from "node:fs";

import { acquireOperationLock } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { slopweaverHome } from "../homeDir.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import { isSettlementRecord, parseGoldDebtLine, validateGoldDebtRecord } from "./decode.js";
import { type GoldDebtError, GoldDebtErrors } from "./errors.js";
import { goldDebtId } from "./pull.js";
import { conflictingDebtField, foldGoldDebts } from "./query.js";
import type { GoldDebtAppendReceipt, GoldDebtRecord } from "./types.js";

/** Owner-only permissions — a row quotes what a session landed and why. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The permission bits a mode check compares, so a `statSync` mode's file-type bits do not confuse it. */
const PERMISSION_BITS = 0o777;

/** The lock key every writer of this register takes. One register, one key. */
const LOCK_KEY = "gold-debt-ledger";

/**
 * The register's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `ledgers/gold-debt.jsonl`
 */
export function goldDebtLedgerPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).goldDebtLedgerJsonl;
}

/**
 * Whether a register is there, genuinely absent, or present-but-unreachable.
 *
 * The presence check is a `statSync` whose ENOENT is the ONLY answer that means absent. Every other errno is
 * a register we cannot see, which is a failure and says so — see this file's overview.
 */
function registerPresence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "ENOENT" ? "absent" : "unreachable";
  }
}

/**
 * Every record one register file holds, in the order they were written.
 *
 * @param path the file to read
 * @param missing whether an absent file is empty or an error — see this file's overview
 * @returns every record, or the first failure
 */
export function readGoldDebtRecords({
  path,
  missing,
}: {
  path: string;
  missing: "empty" | "error";
}): Result<readonly GoldDebtRecord[], GoldDebtError> {
  const presence = registerPresence({ path });
  if (presence === "unreachable") {
    return err(
      GoldDebtErrors.storeUnreadable({ cause: "the register could not be reached — check its permissions", path }),
    );
  }
  if (presence === "absent") {
    if (missing === "empty") {
      return ok([]);
    }
    return err(GoldDebtErrors.storeUnreadable({ cause: "the file does not exist", path }));
  }
  const records: GoldDebtRecord[] = [];
  let failure: GoldDebtError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseGoldDebtLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          failure = parsed.error;
          return;
        }
        records.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    return err(GoldDebtErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(records);
}

/**
 * Every record the default register holds. An install that has never merged below gold is empty.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every record, or the first failure
 */
export function readGoldDebtLedger({ home }: { home?: string } = {}): Result<readonly GoldDebtRecord[], GoldDebtError> {
  return readGoldDebtRecords({ missing: "empty", path: goldDebtLedgerPath(home === undefined ? {} : { home }) });
}

/**
 * Narrow an existing register's permissions to owner-only, leaving its bytes untouched.
 *
 * A creation mode governs a file this process CREATES and says nothing about one that already exists. A
 * register we cannot stat or chmod is one somebody else owns, and refusing the whole append over its
 * permissions would stop a session recording a debt — the strictly worse outcome, since the append below
 * reports its own failure if the file is genuinely unwritable.
 */
function narrowPermissions({ path }: { path: string }): void {
  try {
    if ((statSync(path).mode & PERMISSION_BITS) !== FILE_MODE) {
      chmodSync(path, FILE_MODE);
    }
  } catch {
    // Deliberately swallowed — see this function's own doc.
  }
}

/**
 * The exact bytes one validated record becomes, serialised from an object that inherits NOTHING.
 *
 * `JSON.stringify` reaches a `toJSON` through the prototype chain, so a plain copy of the record can still
 * be rewritten on its way to the file by an `Object.prototype.toJSON` installed elsewhere in the process.
 * Detaching the prototype first makes the bytes a function of the validated record alone. Scoped honestly:
 * this closes the hole for THIS register and is not the general fix.
 */
function serialised({ record }: { record: GoldDebtRecord }): string {
  const detached = { ...record };
  Object.setPrototypeOf(detached, null);
  return safeJsonStringify({ label: "a gold-debt ledger row", value: detached });
}

/**
 * Append one record to the register, taking the write lock and refusing a row the file contradicts.
 *
 * @param row the debt or settlement to write
 * @param nowIso the instant the lock is taken at
 * @param home the state home (defaults to the resolved home)
 * @returns what was written and where, or the failure
 */
export function appendGoldDebtRecord({
  row,
  nowIso,
  home = slopweaverHome(),
}: {
  row: GoldDebtRecord;
  nowIso: string;
  home?: string;
}): Result<GoldDebtAppendReceipt, GoldDebtError> {
  const paths = stateHomePaths({ home });
  const path = paths.goldDebtLedgerJsonl;
  try {
    mkdirSync(paths.ledgers, { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(GoldDebtErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(GoldDebtErrors.ledgerBusy({ why: lock.error }));
  }
  try {
    return writeUnderLock({ path, row });
  } finally {
    lock.value.release();
  }
}

/**
 * The critical section: re-validate the row, read what is there, refuse a contradiction, skip a duplicate,
 * append otherwise.
 *
 * The re-validation is the first thing, and it is not belt-and-braces. `GoldDebtRecord` is a TYPE, and a
 * type cannot say that `wouldBe` is non-empty or that `pullRequest` is a URL a reader can open — so an
 * in-repo caller that built a record literal rather than going through `./row.ts`'s builders could put a row
 * into the file that the next read refuses as corrupt, taking the whole register down with one line.
 */
function writeUnderLock({
  path,
  row,
}: {
  path: string;
  row: GoldDebtRecord;
}): Result<GoldDebtAppendReceipt, GoldDebtError> {
  const validated = validateGoldDebtRecord({ value: row });
  if (validated.isErr()) {
    return err(validated.error);
  }
  // From here on the caller's `row` is NEVER touched again: the builders trim every string, drop an absent
  // optional rather than writing it as undefined, and answer with a plain literal. Checking one object and
  // serialising another is how an untrimmed field reaches the file — and, in the limit, how a `toJSON`
  // method on the argument writes a record that never passed a single rule.
  const checked = validated.value;
  const debtId = goldDebtId({ pullRequest: checked.pullRequest });
  const held = readGoldDebtRecords({ missing: "empty", path });
  if (held.isErr()) {
    return err(held.error);
  }
  const admitted = admissible({ debtId, records: held.value, row: checked });
  if (admitted.isErr()) {
    return err(admitted.error);
  }
  if (!admitted.value) {
    return ok({ appended: false, debtId, path });
  }
  narrowPermissions({ path });
  try {
    appendLines({ mode: FILE_MODE, path, text: `${serialised({ record: checked })}\n` });
  } catch (cause) {
    return err(GoldDebtErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok({ appended: true, debtId, path });
}

/**
 * Whether the row should be written at all: false when the register already holds it, an error when the
 * register contradicts it.
 */
function admissible({
  debtId,
  records,
  row,
}: {
  debtId: string;
  records: readonly GoldDebtRecord[];
  row: GoldDebtRecord;
}): Result<boolean, GoldDebtError> {
  const serialisedRow = serialised({ record: row });
  if (records.some((held) => serialised({ record: held }) === serialisedRow)) {
    return ok(false);
  }
  const folded = foldGoldDebts({ records });
  if (folded.isErr()) {
    return err(folded.error);
  }
  const existing = folded.value.find((entry) => goldDebtId({ pullRequest: entry.debt.pullRequest }) === debtId);
  if (isSettlementRecord(row)) {
    if (existing === undefined) {
      return err(GoldDebtErrors.unknownDebt({ reference: debtId }));
    }
    const { settlement } = existing;
    if (settlement !== undefined) {
      return err(GoldDebtErrors.alreadySettled({ debtId, settledIso: settlement.settledIso }));
    }
    return ok(true);
  }
  if (existing === undefined) {
    return ok(true);
  }
  const field = conflictingDebtField({ first: existing.debt, second: row });
  if (field !== undefined) {
    return err(GoldDebtErrors.debtConflict({ debtId, field }));
  }
  // Every identity field matches, so this is the same debt recorded again — a retry whose only difference is
  // its own `recordedIso`. Writing it would put two accounts of one merge in the file for no gain.
  return ok(false);
}
