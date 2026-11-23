/**
 * Adopting hand-appended rows — the effectful half of {@link ./adopt.js}.
 *
 * It repairs the register FILE so the one-time store import can take it (`./importRegister.ts`). Once the store
 * has imported the register the store is the ledger and the file is history, so `slopweaver autonomy adopt`
 * refuses: a repair then would edit a copy nothing reads.
 *
 * One pass, two modes: PLAN reads the register and writes nothing, APPLY takes the register's own lock,
 * preserves the original beside it and installs the adopted file atomically. The plan is what a reader
 * inspects; the apply is what changes the file, and it refuses when the register has moved under it.
 *
 * ## Why this is allowed to rewrite an append-only register
 *
 * It is the one exception, and it is narrow. The register's rule is that nothing edits a row and nothing
 * removes one — which is what makes it worth reading — and appending cannot fix the file this exists for:
 * the reader still cannot decode the malformed lines already in it, only skip and name them, and re-recording an act under its own id
 * with a different witness is an `ACTION_ID_CONFLICT` rather than a correction.
 *
 * So the exception is bounded by three things rather than by good intentions. The transformations are the
 * three `./adopt.ts` allows and no others — a substitution among them landing only on a field whose value
 * the register cannot read; the original bytes are preserved beside the register, named in
 * every patched row's own witness, and never overwritten; and the whole adopted file is read back through the
 * ordinary reader and folded before it replaces anything, so an adoption that would break the register fails
 * having written nothing but its own backup.
 *
 * ## What the lock does and does not buy
 *
 * `../admit/operationLock.ts` is cooperative: it stops another CLI writer, and it cannot stop a session
 * appending with a shell redirect — which is how the rows this module adopts were written in the first place.
 * The digest check is what covers the rest: APPLY re-reads the register under the lock and refuses if its
 * bytes are not the bytes the plan was computed over. That is a refusal rather than a merge on purpose — a
 * tail written by a hand-appending session is a row somebody meant, and quietly folding it into a rewrite
 * nobody inspected is how an adoption loses an act.
 */
import { createHash } from "node:crypto";
import { constants, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { acquireOperationLock } from "../admit/operationLock.js";
import { resolveHome } from "../cli/optionParsers.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomicStream } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import {
  type AdoptedAutonomyRow,
  type AutonomyAdoptionChange,
  type AutonomyFieldReplacement,
  adoptHandRecordedAutonomyObject,
  isAutonomyReplaceableField,
} from "./adopt.js";
import { frameObjects } from "./adoptFraming.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { AUTONOMY_REGISTER_LOCK_KEY, readAutonomyRegisterFile } from "./importRegister.js";
import { foldAutonomy } from "./query.js";
import { isSteerRecord } from "./row.js";
import { STATE_SUBJECT_PREFIX } from "./subject.js";
import { completeAutonomyRecords } from "./unparsed.js";

/** Owner-only permissions — a row quotes what a session saw and did. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** What one adoption pass found, and what it would write. */
export interface AutonomyAdoptionPlan {
  /** The register the plan was computed over. */
  readonly path: string;
  /** The digest of the register's bytes when the plan was computed — what APPLY re-checks. */
  readonly sourceSha256: string;
  /** Where the original will be (or was) preserved. */
  readonly backupPath: string;
  /** The `state:` reference to that backup, which every patched row's witness quotes. */
  readonly backupReference: string;
  readonly physicalLines: number;
  /** Every change, in source order. A row needing no patch still appears, with no fields. */
  readonly changes: readonly AutonomyAdoptionChange[];
  /** How many objects the file holds — never the same as its line count once a row is pretty-printed. */
  readonly objects: number;
}

/** What an applied adoption reports back. */
export interface AutonomyAdoptionReceipt {
  readonly plan: AutonomyAdoptionPlan;
  /** False when the register already needed no change, so nothing was written. */
  readonly applied: boolean;
}

/** The digest of a file's bytes, streamed rather than read into one string. */
function digestOf({ path }: { path: string }): Result<string, AutonomyError> {
  try {
    const hash = createHash("sha256");
    readJsonlLines({
      onLine: ({ line }) => {
        hash.update(line);
        hash.update("\n");
      },
      path,
    });
    return ok(hash.digest("hex"));
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
}

/**
 * Where the preserved original goes, and the `state:` reference every patched witness quotes for it.
 *
 * Named for the plan's own instant rather than for the register, so two adoptions never collide and a reader
 * can tell which pass produced which backup.
 */
function backupNames({ ledgers, nowIso }: { ledgers: string; nowIso: string }): {
  backupPath: string;
  backupReference: string;
} {
  const stamp = nowIso.replaceAll(/[:.]/gu, "-");
  return {
    backupPath: join(ledgers, `autonomy.pre-adopt-${stamp}.jsonl`),
    backupReference: `${STATE_SUBJECT_PREFIX}ledgers/autonomy.pre-adopt-${stamp}.jsonl`,
  };
}

/**
 * A row-level refusal, placed on the line it came from and named by the act it is about.
 *
 * `validateAutonomyRecord` is line-free by design, because it judges a decoded object and knows nothing
 * about the file it was read out of. The line number is in hand HERE, in the framing pass, and nowhere
 * after it. Measured: adoption refused the register carrying `"doneIso":"2026-09-14T01:1xZ"`
 * with `doneIso is "2026-09-14T01:1xZ", which is not an ISO-8601 instant` and nothing else, so an
 * operator holding a 61-line file was told neither which row nor what to type.
 *
 * A `CORRUPT_ROW` already carries its own line, so it is passed through rather than wrapped a second time.
 *
 * The repair command is offered only for a failure the positional grammar actually fixes — an
 * `INVALID_FIELD` naming `subject` or `doneIso`. A row refused for its `kind`, its `why` or anything else
 * still gets its line and its act, and no route it cannot take: a refusal that names the wrong fix sends a
 * reader to try it, fail, and trust the next line less.
 */
function locateRowFailure({
  error,
  firstLine,
  value,
}: {
  error: AutonomyError;
  firstLine: number;
  value: Readonly<Record<string, unknown>>;
}): AutonomyError {
  if (error.code === "CORRUPT_ROW") {
    return error;
  }
  const actionId = value["actionId"];
  if (typeof actionId !== "string" || actionId.length === 0) {
    return AutonomyErrors.corruptRow({ lineNumber: firstLine, why: error.message });
  }
  const repairable = error.code === "INVALID_FIELD" && isAutonomyReplaceableField(error.field);
  if (!repairable) {
    return AutonomyErrors.corruptRow({ lineNumber: firstLine, why: `the act ${actionId} ${error.message}` });
  }
  return AutonomyErrors.corruptRow({
    lineNumber: firstLine,
    why:
      `the act ${actionId} ${error.message} — repair it by naming the act and the value: ` +
      `\`slopweaver autonomy adopt ${actionId}=<the value it should carry>\``,
  });
}

/**
 * Frame the file into objects and adopt each one, or stop at the first row a rule refused.
 *
 * Split out of {@link planAutonomyAdoption} so each half fits on one screen: this half turns the FILE into
 * rows, and its caller decides what the plan built from them says. The refusal is placed by
 * {@link locateRowFailure} HERE, inside the callback, because that is the only scope holding the line it
 * came from.
 */
function adoptEveryObject({
  backupReference,
  path,
  replacements,
  sha256,
}: {
  backupReference: string;
  path: string;
  replacements: readonly AutonomyFieldReplacement[];
  sha256: string;
}): Result<{ physicalLines: number; rows: readonly AdoptedAutonomyRow[] }, AutonomyError> {
  const rows: AdoptedAutonomyRow[] = [];
  const framed = frameObjects({
    onObject: ({ value, firstLine, lastLine }) => {
      const adopted = adoptHandRecordedAutonomyObject({
        backupReference,
        replacements,
        sha256,
        source: { firstLine, lastLine, value },
      });
      if (adopted.isErr()) {
        return locateRowFailure({ error: adopted.error, firstLine, value });
      }
      rows.push(adopted.value);
      return undefined;
    },
    path,
  });
  if (framed.isErr()) {
    return err(framed.error);
  }
  return ok({ physicalLines: framed.value, rows });
}

/**
 * Read a register and work out what adopting it would change, writing nothing.
 *
 * @param home the state home the register lives under
 * @param replacements every field substitution the caller asked for
 * @param nowIso the instant the backup is named for
 * @returns the plan and every adopted row, or the first rule that refused one
 */
export function planAutonomyAdoption({
  home,
  replacements,
  nowIso,
}: {
  home?: string;
  replacements: readonly AutonomyFieldReplacement[];
  nowIso: string;
}): Result<{ plan: AutonomyAdoptionPlan; rows: readonly AdoptedAutonomyRow[] }, AutonomyError> {
  const paths = stateHomePaths({ home: resolveHome({ named: home }) });
  const path = paths.autonomyLedgerJsonl;
  try {
    statSync(path);
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const digest = digestOf({ path });
  if (digest.isErr()) {
    return err(digest.error);
  }
  const { backupPath, backupReference } = backupNames({ ledgers: paths.ledgers, nowIso });
  const adopted = adoptEveryObject({ backupReference, path, replacements, sha256: digest.value });
  if (adopted.isErr()) {
    return err(adopted.error);
  }
  const { physicalLines, rows } = adopted.value;
  // Matched against the ACTS only. A steer row carries the act's own id (`./decode.ts`'s file overview), so
  // asking "does any row carry this id" answers yes for a register holding the owner's word about an act it does
  // not hold — and a replacement naming that id would then no-op silently instead of saying so.
  const unmatched = replacements.find(
    (candidate) => !rows.some((row) => row.change.actionId === candidate.actionId && !isSteerRecord(row.record)),
  );
  if (unmatched !== undefined) {
    return err(AutonomyErrors.unknownAction({ actionId: unmatched.actionId }));
  }
  return ok({
    plan: {
      backupPath,
      backupReference,
      changes: rows.map((row) => row.change),
      objects: rows.length,
      path,
      physicalLines,
      sourceSha256: digest.value,
    },
    rows,
  });
}

/** Whether a plan would change anything at all. */
function planChangesNothing({ plan }: { plan: AutonomyAdoptionPlan }): boolean {
  return plan.objects === plan.physicalLines && plan.changes.every((change) => change.fields.length === 0);
}

/**
 * Copy the register's exact bytes aside before anything replaces them.
 *
 * `COPYFILE_EXCL`, so an existing backup is never overwritten: the preserved original is the only copy of
 * what the fleet actually wrote, and a second adoption naming the same instant must fail rather than replace
 * it. The directory is not created here — the register itself lives in it, and the plan has already stat'd
 * that file.
 */
function preserveOriginal({ plan }: { plan: AutonomyAdoptionPlan }): Result<true, AutonomyError> {
  try {
    copyFileSync(plan.path, plan.backupPath, constants.COPYFILE_EXCL);
    return ok(true);
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path: plan.backupPath }));
  }
}

/**
 * Fold the adopted rows BEFORE anything is written, so a whole-register rule refuses the pass in memory.
 *
 * Each row is already valid on its own — `./adopt.ts` validates every one — but `./query.ts`'s fold carries
 * the rules no single line can see, and the sharpest of them is `ACTION_ID_CONFLICT`: two rows under one id
 * must agree about every identity field, `witness` and `doneIso` among them. Adoption can mint a
 * disagreement out of rows that were consistent when read, because it writes a witness naming each row's own
 * LINE SPAN and it replaces an instant a caller named. Folding after the write would leave the register
 * already replaced by the file this refusal exists to reject.
 */
function foldBeforeWriting({ rows }: { rows: readonly AdoptedAutonomyRow[] }): Result<true, AutonomyError> {
  return foldAutonomy({ records: rows.map((row) => row.record) }).map(() => true as const);
}

/** Write the adopted rows, then read the whole file back through the ordinary reader before trusting it. */
function installAdopted({
  path,
  rows,
}: {
  path: string;
  rows: readonly AdoptedAutonomyRow[];
}): Result<true, AutonomyError> {
  const foldable = foldBeforeWriting({ rows });
  if (foldable.isErr()) {
    return err(foldable.error);
  }
  try {
    writeFileAtomicStream({
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
      produce: ({ write }) => {
        for (const row of rows) {
          write({ text: `${row.wire}\n` });
        }
      },
    });
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  // Strict where the listing readers skip: adoption has just written the whole register, so a line it cannot
  // read back is a repair that failed, never a line to report past. It refuses naming every such line.
  return readAutonomyRegisterFile({ missing: "error", path })
    .andThen((read) => completeAutonomyRecords({ read }))
    .andThen((records) => foldAutonomy({ records }))
    .map(() => true as const);
}

/**
 * Apply an adoption: preserve the original, install the adopted register, and read it back.
 *
 * The register is re-digested under the lock and compared to the plan's. A mismatch means a session appended
 * while the plan was being read, and it is refused rather than merged — see this file's overview. Whether the
 * store still awaits the import is asked again under the same lock the import holds, so an import that landed
 * after the caller's first check refuses the repair instead of letting it edit a copy nothing reads.
 *
 * @param home the state home the register lives under
 * @param plan what {@link planAutonomyAdoption} worked out
 * @param rows the adopted rows that plan produced
 * @param nowIso the instant the lock is taken at, for its own staleness check
 * @param stillPending asked under the lock: why the store no longer awaits this register, or undefined while it does
 * @returns what was written, or the failure
 */
export async function applyAutonomyAdoption({
  home,
  plan,
  rows,
  nowIso,
  stillPending,
}: {
  home?: string;
  plan: AutonomyAdoptionPlan;
  rows: readonly AdoptedAutonomyRow[];
  nowIso: string;
  stillPending: () => Promise<string | undefined>;
}): Promise<Result<AutonomyAdoptionReceipt, AutonomyError>> {
  if (planChangesNothing({ plan })) {
    return ok({ applied: false, plan });
  }
  const lock = acquireOperationLock({ home: resolveHome({ named: home }), key: AUTONOMY_REGISTER_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(AutonomyErrors.ledgerBusy({ why: lock.error }));
  }
  try {
    const notPending = await stillPending();
    if (notPending !== undefined) {
      return err(AutonomyErrors.registerNotPending({ why: notPending }));
    }
    const current = digestOf({ path: plan.path });
    if (current.isErr()) {
      return err(current.error);
    }
    if (current.value !== plan.sourceSha256) {
      return err(
        AutonomyErrors.registerMoved({
          currentSha256: current.value,
          path: plan.path,
          plannedSha256: plan.sourceSha256,
        }),
      );
    }
    const preserved = preserveOriginal({ plan });
    if (preserved.isErr()) {
      return err(preserved.error);
    }
    const installed = installAdopted({ path: plan.path, rows });
    if (installed.isErr()) {
      return err(installed.error);
    }
    return ok({ applied: true, plan });
  } finally {
    lock.value.release();
  }
}
