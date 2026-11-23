/**
 * The store lifecycle's own typed failures — the migration journal, the migrator and `drizzle-kit generate`, the
 * catalog reads a verify and a baseline make, the push, baseline and reset refusals, and a `--from-file` that
 * names no bronze file.
 *
 * Declared beside `./errors.ts` rather than inside it only because that file is already the store's longest
 * declaration; each interface here is a member of `StoreError` and each factory is spread into `StoreErrors`, so
 * a caller never imports this file. A list of problems — a generate's output tail, every catalog disagreement, a
 * four-line hatch refusal — rides as `reasons`, and `storeErrorLines` prints it one line each, as the
 * `readonly string[]` it replaced did.
 */

/** `drizzle-kit generate` could not be launched at all. */
export interface StoreGenerateLaunchFailedError {
  readonly code: "GENERATE_LAUNCH_FAILED";
  readonly message: string;
  readonly detail: string;
}

/** `drizzle-kit generate` ran and exited non-zero; `reasons` is the heading and the tail of what it printed. */
export interface StoreGenerateExitedError {
  readonly code: "GENERATE_EXITED";
  readonly message: string;
  readonly status: number | null;
  readonly reasons: readonly string[];
}

/** `--from-file` matched none of a source's bronze files; `available` is every basename it could have named. */
export interface StoreFromFileUnknownError {
  readonly code: "FROM_FILE_UNKNOWN";
  readonly message: string;
  readonly fromFile: string;
  readonly available: readonly string[];
}

/** The journal and drizzle's own reader disagree about how many migrations there are. */
export interface StoreJournalMismatchError {
  readonly code: "JOURNAL_MISMATCH";
  readonly message: string;
  readonly entries: number;
  readonly files: number;
}

/** The migration journal under `folder` could not be read; `detail` is the first line of why. */
export interface StoreJournalUnreadableError {
  readonly code: "JOURNAL_UNREADABLE";
  readonly message: string;
  readonly folder: string;
  readonly detail: string;
}

/** A catalog or bookkeeping read threw; `subject` says which, `detail` is the first line of why. */
export interface StoreLifecycleReadFailedError {
  readonly code: "LIFECYCLE_READ_FAILED";
  readonly message: string;
  readonly subject: "migration-state" | "live-schema" | "catalog";
  readonly detail: string;
}

/** A write the lifecycle began failed; `stage` says which, `detail` is the first line of why. */
export interface StoreLifecycleWriteFailedError {
  readonly code: "LIFECYCLE_WRITE_FAILED";
  readonly message: string;
  readonly stage: "baseline" | "reset-drop";
  readonly detail: string;
}

/** A migration statement, or the migrator itself, failed; `reasons` is the failure and what it was running. */
export interface StoreMigrationFailedError {
  readonly code: "MIGRATION_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `--through` names no migration in the journal. */
export interface StoreMigrationUnknownError {
  readonly code: "MIGRATION_UNKNOWN";
  readonly message: string;
  readonly through: string;
  readonly known: readonly string[];
}

/** The database's migration state is one this act refuses to touch; `reasons` is the refusal and the state. */
export interface StoreStateRefusedError {
  readonly code: "STATE_REFUSED";
  readonly message: string;
  readonly act: "push" | "baseline";
  readonly state: string;
  readonly reasons: readonly string[];
}

/** A lifecycle act refused for every reason in `reasons` — a catalog disagreement, an unlanded migration, a
 * missing acknowledgement. */
export interface StoreLifecycleRefusedError {
  readonly code: "LIFECYCLE_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `store reset` was pointed at a database on another host, which nothing here resets. */
export interface StoreResetRemoteError {
  readonly code: "RESET_REMOTE";
  readonly message: string;
}

/** The database was dropped and the rebuild failed, so it is empty; `reasons` is that and the push's own lines. */
export interface StoreRebuildFailedError {
  readonly code: "REBUILD_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure the lifecycle authors. */
export type StoreLifecycleError =
  | StoreGenerateLaunchFailedError
  | StoreGenerateExitedError
  | StoreFromFileUnknownError
  | StoreJournalMismatchError
  | StoreJournalUnreadableError
  | StoreLifecycleReadFailedError
  | StoreLifecycleWriteFailedError
  | StoreMigrationFailedError
  | StoreMigrationUnknownError
  | StoreStateRefusedError
  | StoreLifecycleRefusedError
  | StoreResetRemoteError
  | StoreRebuildFailedError;

/** How to raise one — spread into `StoreErrors`, so the real code and a test build each the same way. */
export const StoreLifecycleErrors = {
  baselineStateRefused: ({ state }: { state: string }): StoreStateRefusedError => {
    const reasons = [
      `refusing to baseline a ${state} database — a baseline is only for one whose tables exist with no bookkeeping`,
    ];
    return { act: "baseline", code: "STATE_REFUSED", message: reasons.join("; "), reasons, state };
  },
  catalogDisagrees: ({ problems }: { problems: readonly string[] }): StoreLifecycleRefusedError => {
    const reasons = ["refusing to baseline: the catalog disagrees with --through", ...problems];
    return { code: "LIFECYCLE_REFUSED", message: reasons.join("; "), reasons };
  },
  fromFileUnknown: ({
    fromFile,
    available,
  }: {
    fromFile: string;
    available: readonly string[];
  }): StoreFromFileUnknownError => ({
    available,
    code: "FROM_FILE_UNKNOWN",
    fromFile,
    message:
      `--from-file ${fromFile} names no bronze file here` +
      (available.length === 0 ? " — this source has none" : ` — this source has ${available.join(", ")}`),
  }),
  generateExited: ({ status, tail }: { status: number | null; tail: readonly string[] }): StoreGenerateExitedError => {
    const reasons = [`drizzle-kit generate exited ${String(status)}`, ...tail];
    return { code: "GENERATE_EXITED", message: reasons.join("; "), reasons, status };
  },
  generateLaunchFailed: ({ detail }: { detail: string }): StoreGenerateLaunchFailedError => ({
    code: "GENERATE_LAUNCH_FAILED",
    detail,
    message: `drizzle-kit generate could not start: ${detail}`,
  }),
  journalMismatch: ({ entries, files }: { entries: number; files: number }): StoreJournalMismatchError => ({
    code: "JOURNAL_MISMATCH",
    entries,
    files,
    message: `the journal lists ${String(entries)} entries and drizzle read ${String(files)} files`,
  }),
  journalUnreadable: ({ folder, detail }: { folder: string; detail: string }): StoreJournalUnreadableError => ({
    code: "JOURNAL_UNREADABLE",
    detail,
    folder,
    message: `could not read the migration journal under ${folder}: ${detail}`,
  }),
  lifecycleReadFailed: ({
    subject,
    detail,
  }: {
    subject: StoreLifecycleReadFailedError["subject"];
    detail: string;
  }): StoreLifecycleReadFailedError => {
    const what = { catalog: "the catalog", "live-schema": "the live schema", "migration-state": "the migration state" }[
      subject
    ];
    return { code: "LIFECYCLE_READ_FAILED", detail, message: `could not read ${what}: ${detail}`, subject };
  },
  lifecycleRefused: ({ reasons }: { reasons: readonly string[] }): StoreLifecycleRefusedError => ({
    code: "LIFECYCLE_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  lifecycleWriteFailed: ({
    stage,
    detail,
  }: {
    stage: StoreLifecycleWriteFailedError["stage"];
    detail: string;
  }): StoreLifecycleWriteFailedError => ({
    code: "LIFECYCLE_WRITE_FAILED",
    detail,
    message:
      stage === "baseline"
        ? `baseline failed, and nothing was recorded: ${detail}`
        : `reset failed before rebuilding: ${detail}`,
    stage,
  }),
  migrationApplyFailed: ({ detail, folder }: { detail: string; folder: string }): StoreMigrationFailedError => {
    const reasons = [`migration failed: ${detail}`, `migrations were read from ${folder}`];
    return { code: "MIGRATION_FAILED", message: reasons.join("; "), reasons };
  },
  migrationStatementFailed: ({
    phase,
    index,
    detail,
    statement,
  }: {
    phase: string;
    index: number;
    detail: string;
    statement: string;
  }): StoreMigrationFailedError => {
    const reasons = [`${phase} statement ${String(index)} failed: ${detail}`, statement];
    return { code: "MIGRATION_FAILED", message: reasons.join("; "), reasons };
  },
  migrationUnknown: ({
    through,
    known,
  }: {
    through: string;
    known: readonly string[];
  }): StoreMigrationUnknownError => ({
    code: "MIGRATION_UNKNOWN",
    known,
    message: `--through ${through} names no migration; the journal has ${known.join(", ")}`,
    through,
  }),
  pushStateRefused: ({
    state,
    stateLine,
  }: {
    state: "unrecorded" | "foreign";
    stateLine: string;
  }): StoreStateRefusedError => {
    const would =
      state === "unrecorded"
        ? "replay 0000 onto tables that already exist"
        : "apply over a history this journal does not carry";
    const reasons = [`refusing to push: ${state} — the migrator would ${would}`, stateLine];
    return { act: "push", code: "STATE_REFUSED", message: reasons.join("; "), reasons, state };
  },
  rebuildFailed: ({ pushLines }: { pushLines: readonly string[] }): StoreRebuildFailedError => {
    const reasons = [
      "the database was dropped and the rebuild failed — it is now EMPTY; fix the cause and run `slopweaver store push`",
      ...pushLines,
    ];
    return { code: "REBUILD_FAILED", message: reasons.join("; "), reasons };
  },
  resetRemote: (): StoreResetRemoteError => ({
    code: "RESET_REMOTE",
    message:
      "store reset only ever resets a database on this machine, and the store URL reaches another host; no hatch opens this",
  }),
} as const;
