/**
 * Why the store-backed workstream register could not answer or could not take a write.
 *
 * Its own union, apart from the file register's `../errors.ts`: an empty store is a valid register, so there is no
 * "absent" here, and a store outage is a refusal, never an empty answer and never a file read instead.
 */
import { byCodeUnit } from "./canonical.js";

/**
 * The store could not be opened or a statement failed; nothing is known about the register. On a write that includes
 * whether it landed: a connection lost while COMMIT is acknowledged leaves the write committed and unconfirmed, and no client can tell those apart. Read again before deciding; a blind retry is refused by its own
 * stated revision, never applied twice.
 */
export interface WorkstreamStoreUnavailableError {
  readonly code: "WORKSTREAM_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The rows the store holds do not make a valid register: damaged, or written by something that skipped the port. */
export interface WorkstreamStoredInvalidError {
  readonly code: "WORKSTREAM_STORED_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A proposed write breaks a rule of the register; nothing was written. */
export interface WorkstreamInvalidError {
  readonly code: "WORKSTREAM_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** The workstream moved since the writer read it (or, creating, already exists); nothing was written or retried. */
export interface WorkstreamRevisionConflictError {
  readonly code: "WORKSTREAM_REVISION_CONFLICT";
  readonly message: string;
  readonly workstreamId: string;
  readonly expectedRevision: number;
}

/** The register-level document moved since the writer read it; nothing was written or retried. */
export interface WorkstreamMetaRevisionConflictError {
  readonly code: "WORKSTREAM_META_REVISION_CONFLICT";
  readonly message: string;
  readonly expectedRevision: number;
}

/**
 * A batch stated every workstream it read and the revision it read it at, and the register no longer holds exactly
 * that; nothing was written or retried.
 */
export interface WorkstreamWholeRegisterConflictError {
  readonly code: "WORKSTREAM_WHOLE_REGISTER_CONFLICT";
  readonly message: string;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
}

/** Another workstream links to the one being deleted, so deleting it would leave a dangling link. */
export interface WorkstreamReferencedError {
  readonly code: "WORKSTREAM_REFERENCED";
  readonly message: string;
  readonly workstreamId: string;
  readonly referencedBy: readonly string[];
}

/**
 * Something other than the tombstone stands at the retired register's path (`./retiredRegister.ts`) — the old file,
 * most likely — so the store is neither read nor written: nothing imports a file, and a person moves it aside.
 */
export interface WorkstreamRetiredRegisterPresentError {
  readonly code: "WORKSTREAM_RETIRED_REGISTER_PRESENT";
  readonly message: string;
  readonly path: string;
  /** What stands there, in words. */
  readonly found: string;
}

/** The tombstone could not be made durable, so the store was not opened: an old build could write the file again. */
export interface WorkstreamTombstoneNotDurableError {
  readonly code: "WORKSTREAM_TOMBSTONE_NOT_DURABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * A whole-register document was edited against content the register no longer holds — or, carrying no baseline,
 * was handed to a register that is not empty — so nothing was written: list it again and redo the edit.
 */
export interface WorkstreamBaselineStaleError {
  readonly code: "WORKSTREAM_BASELINE_STALE";
  readonly message: string;
  /** The baseline the document carried; the empty register's when it carried none. */
  readonly expected: string;
  /** The baseline of what the register holds now. */
  readonly actual: string;
}

/** Every way the store-backed register can refuse. */
export type WorkstreamStoreError =
  | WorkstreamStoreUnavailableError
  | WorkstreamStoredInvalidError
  | WorkstreamInvalidError
  | WorkstreamRevisionConflictError
  | WorkstreamMetaRevisionConflictError
  | WorkstreamWholeRegisterConflictError
  | WorkstreamReferencedError
  | WorkstreamRetiredRegisterPresentError
  | WorkstreamTombstoneNotDurableError
  | WorkstreamBaselineStaleError;

/**
 * An id-to-revision map in id order, the way a refusal prints it: `a@2, b@1`, or `none` when it is empty.
 *
 * @returns the words
 */
function revisionsWords({ revisions }: { revisions: Readonly<Record<string, number>> }): string {
  const pairs = Object.entries(revisions)
    .toSorted(([a], [b]) => byCodeUnit({ a, b }))
    .map(([id, revision]) => `${id}@${String(revision)}`);
  if (pairs.length === 0) {
    return "none";
  }
  return pairs.join(", ");
}

/** The one place each refusal's message is worded. */
export const WorkstreamStoreErrors = {
  baselineStale: ({ actual, expected }: { actual: string; expected: string }): WorkstreamBaselineStaleError => ({
    actual,
    code: "WORKSTREAM_BASELINE_STALE",
    expected,
    message: `the register moved since this document was read (it carries ${expected}, the register is now ${actual}) — nothing written; list it again and redo the edit`,
  }),
  conflict: ({
    expectedRevision,
    workstreamId,
  }: {
    expectedRevision: number;
    workstreamId: string;
  }): WorkstreamRevisionConflictError => ({
    code: "WORKSTREAM_REVISION_CONFLICT",
    expectedRevision,
    message:
      expectedRevision === 0
        ? `workstream ${workstreamId} already exists — read it and write its current revision`
        : `workstream ${workstreamId} is no longer at revision ${expectedRevision} — read it again and decide afresh`,
    workstreamId,
  }),
  invalid: ({ problems }: { problems: readonly string[] }): WorkstreamInvalidError => ({
    code: "WORKSTREAM_INVALID",
    message: `the workstream was refused, nothing written: ${problems.join("; ")}`,
    problems,
  }),
  metaConflict: ({ expectedRevision }: { expectedRevision: number }): WorkstreamMetaRevisionConflictError => ({
    code: "WORKSTREAM_META_REVISION_CONFLICT",
    expectedRevision,
    message:
      expectedRevision === 0
        ? "the workstream register document already exists — read it and write its current revision"
        : `the workstream register document is no longer at revision ${expectedRevision} — read it again`,
  }),
  referenced: ({
    referencedBy,
    workstreamId,
  }: {
    referencedBy: readonly string[];
    workstreamId: string;
  }): WorkstreamReferencedError => ({
    code: "WORKSTREAM_REFERENCED",
    message: `workstream ${workstreamId} is linked from ${referencedBy.join(", ")} — remove those links first`,
    referencedBy,
    workstreamId,
  }),
  retiredRegisterPresent: ({
    found,
    path,
  }: {
    found: string;
    path: string;
  }): WorkstreamRetiredRegisterPresentError => ({
    code: "WORKSTREAM_RETIRED_REGISTER_PRESENT",
    found,
    message: `${path} holds ${found} where the retired workstream register was — the register lives in the store and nothing imports a file, so move it aside, then re-enter what it held with \`workstreams put\``,
    path,
  }),
  tombstoneNotDurable: ({ path, reason }: { path: string; reason: string }): WorkstreamTombstoneNotDurableError => ({
    code: "WORKSTREAM_TOMBSTONE_NOT_DURABLE",
    message: `the tombstone at ${path} could not be made durable, so the store was not opened — a build from before the move could write the retired register again: ${reason}`,
    path,
  }),
  storedInvalid: ({ problems }: { problems: readonly string[] }): WorkstreamStoredInvalidError => ({
    code: "WORKSTREAM_STORED_INVALID",
    message: `the store's workstream rows are not a valid register: ${problems.join("; ")}`,
    problems,
  }),
  unavailable: ({ doing, reason }: { doing: string; reason: string }): WorkstreamStoreUnavailableError => ({
    code: "WORKSTREAM_STORE_UNAVAILABLE",
    message: `the store could not ${doing}: ${reason}`,
  }),
  wholeRegisterConflict: ({
    actual,
    expected,
  }: {
    actual: Readonly<Record<string, number>>;
    expected: Readonly<Record<string, number>>;
  }): WorkstreamWholeRegisterConflictError => ({
    actual,
    code: "WORKSTREAM_WHOLE_REGISTER_CONFLICT",
    expected,
    message: `the register moved since it was read — read ${revisionsWords({ revisions: expected })}, now ${revisionsWords({ revisions: actual })}; read it again and decide afresh`,
  }),
} as const;
