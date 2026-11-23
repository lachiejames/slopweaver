/**
 * The FILE edge of the plan register: the one-time file read the store imports from, the divergence
 * diagnostics a store read carries, and the two one-way projections a committed change regenerates.
 *
 * The register's authority is the store's `plan_register` row (`./storePort.ts`). Nothing here is ever a
 * fallback for that row: once a row exists, this module is consulted only to WRITE copies and to report when
 * a copy on disk disagrees.
 *
 * ## Three answers from one file read, not two
 *
 * `$SLOPWEAVER_HOME/plans.json` ABSENT, with no store row, is a legitimate install — nothing has been
 * adopted, and the same picture is derived from the Claude accounts file alone — the plans the user signed in
 * to, never a login merely found on the machine (`./register.ts`'s `derivePlanRegister`).
 * PRESENT and unreadable is a different answer entirely: which destinations this install has is then
 * UNKNOWN, and seating a session anyway means seating it on whatever credential happens to be ambient. Only
 * `ENOENT` means absent, exactly as `src/claude/spawnAccounts.ts` already distinguishes them.
 *
 * ## Two projections, written after the commit and never instead of it
 *
 * `plans.json` (the whole document, for pre-store readers of the register) and
 * `claude-accounts/accounts.json` (the bare Claude rows, for older Claude readers) are regenerated from the
 * COMMITTED row. Each replacement is atomic on its own; the trio of commit plus two files is not. So both
 * files are attempted independently and every failure is collected into one
 * {@link ../plans/errors.ProjectionWriteFailedError} carrying `registerCommitted: true` and the committed
 * revision — never a rollback, because the change did land and re-applying it would double it.
 * `plans validate --repair-projection` is the named repair. Every cached seat pass is cleared before either
 * file is written, since the bash fast path trusts the Claude copy ({@link writePlanRegisterProjections}).
 *
 * An OLD checkout's writer still writes `plans.json` directly. Its edit is DIVERGENCE a store read reports,
 * never an import: the row outranks every file once it exists.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { removeSeatPasses } from "../claude/seatPassMarker.js";
import { stateHomePaths } from "../stateHome.js";

import {
  type PlanRegisterError,
  PlanRegisterErrors,
  type ProjectionWriteFailedError,
  type SeatPassesNotClearedError,
} from "./errors.js";
import { projectClaudeRows, projectionDivergence, registerProjectionDivergence } from "./projection.js";
import { derivePlanRegister, parsePlanRegister } from "./register.js";
import type { PlanDiagnostic, PlanRegisterDocument, PlanRegisterSnapshot } from "./types.js";

/** The register and its projections are per-install state, not secrets — but nor are they world-readable. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** What the filesystem said about one configuration file, in the three terms a caller acts on. */
type FileRead =
  { readonly kind: "absent" } | { readonly kind: "read"; readonly text: string } | { readonly kind: "unreadable" };

/**
 * Read one configuration file, distinguishing absence from a failure to read it.
 *
 * `readFileSync` and an inspection of the error's `code`, rather than `existsSync` first: a stat-then-read
 * pair answers about two different instants, and the gap between them is where a file another process is
 * writing lands.
 *
 * @param path the file to read
 * @returns what the filesystem said
 */
function readFile({ path }: { path: string }): FileRead {
  try {
    return { kind: "read", text: readFileSync(path, "utf8") };
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
    if (code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unreadable" };
  }
}

/**
 * Decode one configuration file's JSON, reporting a parse failure as invalid rather than throwing.
 *
 * @param label what the file is, for a size warning naming the right thing
 * @param text the file's contents
 * @returns the decoded value, or the problem
 */
function decodeJson({ label, text }: { label: string; text: string }): Result<unknown, PlanRegisterError> {
  try {
    return ok(safeJsonParse({ label, text }));
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : "unknown failure";
    return err(PlanRegisterErrors.registerInvalid({ problems: [`${label} is not JSON — ${why}`] }));
  }
}

/**
 * Derive the register an install that has adopted nothing already has.
 *
 * @param projectionPath where the Claude accounts file lives
 * @returns the derived snapshot, or why the accounts file could not be read
 */
function deriveFromAccountsFile({
  projectionPath,
}: {
  projectionPath: string;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const accountsFile = readFile({ path: projectionPath });
  if (accountsFile.kind === "unreadable") {
    return err(PlanRegisterErrors.registerUnreadable({ path: projectionPath }));
  }
  if (accountsFile.kind === "absent") {
    return derivePlanRegister({ claudeRows: [] });
  }
  const decoded = decodeJson({ label: "the Claude accounts file", text: accountsFile.text });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const rows = decoded.value;
  if (!Array.isArray(rows)) {
    return err(PlanRegisterErrors.registerInvalid({ problems: ["the Claude accounts file is not an array"] }));
  }
  return derivePlanRegister({
    claudeRows: rows.map((row): Readonly<Record<string, unknown>> => (isRow(row) ? row : {})),
  });
}

/**
 * Whether one decoded element of the accounts file is a row rather than a scalar.
 *
 * @param row one decoded element
 * @returns whether it is a plain object
 */
function isRow(row: unknown): row is Readonly<Record<string, unknown>> {
  return typeof row === "object" && row !== null && !Array.isArray(row);
}

/**
 * Read the register FILES — the one-time import source for a store that holds no row yet.
 *
 * A present `plans.json` is decoded and returned as `registered` (the store then imports it); an absent one
 * derives the unadopted picture from the Claude accounts file; a present but unreadable or invalid one is
 * REFUSED rather than derived around, because deriving would turn damaged adopted state into an ambient
 * fallback. Never called once a store row exists.
 *
 * @param home the Slopweaver home whose files are read
 * @returns the snapshot (with `revision: null`), or why the files could not be read
 */
export function readPlanRegisterFile({ home }: { home: string }): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const paths = stateHomePaths({ home });
  const register = readFile({ path: paths.plansJson });
  if (register.kind === "unreadable") {
    return err(PlanRegisterErrors.registerUnreadable({ path: paths.plansJson }));
  }
  if (register.kind === "absent") {
    return deriveFromAccountsFile({ projectionPath: paths.claudeAccountsJson }).map((snapshot) =>
      withUnkeyedQuotaNote({ home, snapshot }),
    );
  }
  const decoded = decodeJson({ label: "the plan register", text: register.text });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  return parsePlanRegister({ value: decoded.value });
}

/**
 * The diagnostics a read of a STORED register carries: whether either projection on disk has diverged from
 * the row, and whether a leftover unkeyed quota file is still lying around.
 *
 * The row is never healed from a copy here — a disagreeing copy is reported and the row wins, because healing
 * on read would silently discard whichever change somebody meant.
 *
 * @param home the Slopweaver home whose projections are compared
 * @param snapshot the register just decoded from the store row
 * @returns the same snapshot, with its diagnostics replaced by what the files say
 */
export function storedRegisterDiagnostics({
  home,
  snapshot,
}: {
  home: string;
  snapshot: PlanRegisterSnapshot;
}): PlanRegisterSnapshot {
  return withUnkeyedQuotaNote({
    home,
    snapshot: { ...snapshot, diagnostics: divergenceDiagnostics({ home, snapshot }) },
  });
}

/**
 * Report a leftover ambient `codex-quota.json`, which no reader consults now that a cap is per-destination.
 *
 * A cap record is evidence, so losing one silently is the failure worth a line: an install that hit a limit
 * before the cache became alias-scoped still holds that record, and every quota read now looks under
 * `codex-quota/<alias>.json` instead. `codex quota clear` disarms the per-destination record; the leftover
 * file is inert and safe to delete by hand, which is what the note says rather than deleting it on a READ.
 *
 * @param home the Slopweaver home whose unkeyed quota file is checked
 * @param snapshot the snapshot the note is appended to
 * @returns the same snapshot, with the note when the quota file is still there
 */
function withUnkeyedQuotaNote({
  home,
  snapshot,
}: {
  home: string;
  snapshot: PlanRegisterSnapshot;
}): PlanRegisterSnapshot {
  const path = stateHomePaths({ home }).codexQuotaJson;
  if (readFile({ path }).kind === "absent") {
    return snapshot;
  }
  return {
    ...snapshot,
    diagnostics: [
      ...snapshot.diagnostics,
      {
        code: "UNKEYED_QUOTA_UNATTRIBUTED",
        message: `${path} records a Codex cap against no destination — every quota read is per-alias now, so it is inert and may be deleted`,
      },
    ],
  };
}

/**
 * Decode one projection file for a divergence comparison: an absent, unreadable or non-JSON file is
 * `undefined`, which disagrees with every register and so reports as divergence.
 *
 * @param label what the file is, for a size warning naming the right thing
 * @param path the projection file
 * @returns the decoded contents, or undefined
 */
function decodedOnDisk({ label, path }: { label: string; path: string }): unknown {
  const onDisk = readFile({ path });
  if (onDisk.kind !== "read") {
    return undefined;
  }
  try {
    return safeJsonParse({ label, text: onDisk.text });
  } catch {
    return undefined;
  }
}

/**
 * Whether the two projections on disk still match the register, as a diagnostic list.
 *
 * @param home the Slopweaver home
 * @param snapshot the authoritative register just read
 * @returns one divergence diagnostic per projection that disagrees, empty when both agree
 */
function divergenceDiagnostics({
  home,
  snapshot,
}: {
  home: string;
  snapshot: PlanRegisterSnapshot;
}): readonly PlanDiagnostic[] {
  const paths = stateHomePaths({ home });
  const notes = [
    projectionDivergence({
      document: snapshot.document,
      onDisk: decodedOnDisk({ label: "the Claude accounts file", path: paths.claudeAccountsJson }),
    }),
    registerProjectionDivergence({
      document: snapshot.document,
      onDisk: decodedOnDisk({ label: "the plan register projection", path: paths.plansJson }),
    }),
  ];
  return notes.filter((note): note is PlanDiagnostic => note !== undefined);
}

/**
 * Write one projection file atomically, reporting the path on failure rather than throwing.
 *
 * @param contents the bytes to write
 * @param path where they go
 * @returns nothing, or the failure and its path
 */
function writeProjection({
  contents,
  path,
}: {
  contents: string;
  path: string;
}): Result<undefined, { readonly cause: unknown; readonly path: string }> {
  try {
    writeFileAtomic({ contents, dirMode: DIR_MODE, fileMode: FILE_MODE, path });
    return ok(undefined);
  } catch (cause) {
    return err({ cause, path });
  }
}

/**
 * Clear every cached seat pass, reporting the directory on failure rather than throwing.
 *
 * @param dir the seat-pass markers' directory
 * @returns nothing, or the failure and its path
 */
function forgetSeatPasses({
  dir,
}: {
  dir: string;
}): Result<undefined, { readonly cause: unknown; readonly path: string }> {
  const removed = removeSeatPasses({ path: dir });
  if (removed.isErr()) {
    return err({ cause: removed.error.message, path: dir });
  }
  return ok(undefined);
}

/**
 * Clear every cached seat pass BEFORE a register change commits, refusing the change when they cannot be cleared.
 *
 * The purge inside {@link writePlanRegisterProjections} runs only after the commit, so on its own it leaves a window
 * in which the committed row is limited while an older unlimited pass still answers the bash fast path. Cleared first, a check that runs between here and the commit dates its new pass to its own start,
 * which the accounts file rewritten after the commit then outranks.
 *
 * @param home the Slopweaver home whose passes are cleared
 * @returns nothing, or why the change must not commit
 */
export function clearSeatPassesBeforeCommit({ home }: { home: string }): Result<undefined, SeatPassesNotClearedError> {
  const cleared = forgetSeatPasses({ dir: stateHomePaths({ home }).live.seatPassDir });
  if (cleared.isErr()) {
    return err(PlanRegisterErrors.seatPassesNotCleared(cleared.error));
  }
  return ok(undefined);
}

/**
 * Regenerate both one-way projections from a COMMITTED register document.
 *
 * Both writes are attempted whatever the first one did, so one failure never leaves the other copy stale
 * as well, and every failed path is reported at once.
 *
 * Every cached seat pass is cleared FIRST. `bin/slopweaver` answers a seat's next prompt from its marker while that
 * marker is newer than the Claude accounts file, so a commit whose projection then failed to write would leave a
 * pass the committed row no longer earns — a usage limit lowered from 100 most of all. With no
 * marker, every seat's next prompt is judged in full against the committed row, whatever the projections did.
 * The residue is a DOUBLE fault: the purge and the Claude projection both failing leave an older marker newer than
 * an unchanged accounts file, so it still passes. Both failures are returned in the one error, whose named repair
 * (`plans validate --repair-projection`) rewrites that file and so outruns the marker.
 *
 * @param home the Slopweaver home the projections live under
 * @param document the register document exactly as the store committed it
 * @param committedRevision the store revision that document committed at
 * @returns nothing, or which projections could not be written
 */
export function writePlanRegisterProjections({
  committedRevision,
  document,
  home,
}: {
  committedRevision: number;
  document: PlanRegisterDocument;
  home: string;
}): Result<undefined, ProjectionWriteFailedError> {
  const paths = stateHomePaths({ home });
  const outcomes = [
    forgetSeatPasses({ dir: paths.live.seatPassDir }),
    writeProjection({
      contents: `${safeJsonStringify({ label: "the plan register projection", space: 2, value: document })}\n`,
      path: paths.plansJson,
    }),
    writeProjection({
      contents: `${safeJsonStringify({
        label: "the generated Claude projection",
        space: 2,
        value: projectClaudeRows({ document }),
      })}\n`,
      path: paths.claudeAccountsJson,
    }),
  ];
  const failures = outcomes.flatMap((outcome) => (outcome.isErr() ? [outcome.error] : []));
  const first = failures[0];
  if (first === undefined) {
    return ok(undefined);
  }
  return err(
    PlanRegisterErrors.projectionWriteFailed({
      cause: first.cause,
      committedRevision,
      paths: failures.map((failure) => failure.path),
    }),
  );
}
