/**
 * The typed failure kinds of the PLAN REGISTER — reading the store's `plan_register` row (or, once, the
 * legacy `$SLOPWEAVER_HOME/plans.json` it is imported from), validating one change to it, and publishing that
 * change beside its two one-way file projections.
 *
 * Per `.claude/rules/error-handling.md` this union stands alone: it shares no base type with
 * `ClaudeRotationError`, which is about a credential store's health, nor with the Codex routing union. What
 * lands here is a failure of FACT about the register — a policy refusal is an escape-hatch row instead.
 *
 * ## A store commit and two file projections are not a transaction
 *
 * The row is the source and `plans.json` plus `claude-accounts/accounts.json` are generated from it, so a
 * write is one database update followed by two atomic file replacements. {@link RegisterStoreUnavailableError}
 * and {@link RegisterRevisionConflictError} mean NOTHING was committed; {@link ProjectionWriteFailedError}
 * means the row WAS committed and a copy older readers use was not, and it says so in a field rather than in
 * prose, because the repair differs entirely: the first two are a retry, the third is `slopweaver plans
 * validate --repair-projection`. Reporting the third as a rollback would send a reader to re-apply a change
 * that already landed.
 *
 * ## A store outage is never an empty register
 *
 * {@link RegisterStoreUnavailableError} is its own code so no reader can mistake "the store could not be
 * read" for "this install registers nothing" — the second seats a session on whatever credential is ambient.
 *
 * **No variant carries a credential.** A register row holds a path and a label, a store message never carries
 * the connection string, and these messages are printed into logs and transcripts.
 */

/** The register file is PRESENT and could not be read — a permission error, a directory, an I/O failure. */
export interface RegisterUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  /** Where the unreadable file is, so the reader can go and look at it. */
  readonly path: string;
}

/** The register read fine and holds something this version cannot use. */
export interface RegisterInvalidError {
  readonly code: "REGISTER_INVALID";
  readonly message: string;
  /** Every problem found at once, so the reader fixes them in one pass rather than one run at a time. */
  readonly problems: readonly string[];
}

/** No registered row carries that provider and alias. */
export interface UnknownDestinationError {
  readonly code: "UNKNOWN_DESTINATION";
  readonly message: string;
  readonly provider: string;
  readonly alias: string;
}

/** The change is well formed and cannot be applied to the register as it currently stands. */
export interface MutationConflictError {
  readonly code: "MUTATION_CONFLICT";
  readonly message: string;
  /** What about the current register refused the change. */
  readonly conflict: string;
}

/** The store that holds the register could not be selected, reached, or queried. Nothing was read or written. */
export interface RegisterStoreUnavailableError {
  readonly code: "REGISTER_STORE_UNAVAILABLE";
  readonly message: string;
  /**
   * Set only when the store ANSWERED and `connectStore` refused it as stale (`STORE_STALE`): its migration record is not
   * the journal's. That one cause has a hatch under which the register — and every usage limit in it — reads, so a
   * spawn gate can say how to seat the investigator, rather than that nothing crosses (`../claude/spawnStore.ts`).
   */
  readonly staleStore?: true;
}

/**
 * Another writer committed a change between this writer's read and its compare-and-set. Nothing was written,
 * and nothing retries: replaying the change against a register that moved is a new judgement.
 */
export interface RegisterRevisionConflictError {
  readonly code: "REGISTER_REVISION_CONFLICT";
  readonly message: string;
  /** The revision this writer read and pinned its update to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** The register row WAS committed and one or more of its generated projections was not. See the header. */
export interface ProjectionWriteFailedError {
  readonly code: "PROJECTION_WRITE_FAILED";
  readonly message: string;
  /** Every projection file that could not be written, so one repair covers them all. */
  readonly paths: readonly string[];
  /** Always true, and stated rather than implied: this is not a rollback. */
  readonly registerCommitted: true;
  /** The store revision that DID commit, which the repair regenerates from. */
  readonly committedRevision: number;
}

/**
 * The seats' cached passes could not be cleared before a change, so the change was NOT committed: a pass the change
 * no longer earns would otherwise answer the bash fast path until the projections land.
 */
export interface SeatPassesNotClearedError {
  readonly code: "SEAT_PASSES_NOT_CLEARED";
  readonly message: string;
  /** The seat-pass directory that could not be removed. */
  readonly path: string;
}

/** Every failure kind the plan register can produce. */
export type PlanRegisterError =
  | RegisterUnreadableError
  | RegisterInvalidError
  | UnknownDestinationError
  | MutationConflictError
  | RegisterStoreUnavailableError
  | RegisterRevisionConflictError
  | ProjectionWriteFailedError
  | SeatPassesNotClearedError;

/**
 * The failures a register READ can end in — the three that leave which plans exist, and every limit the owner set on them,
 * unknown. A reader that turns one into a card or a refusal narrows to these, rather than switching over the
 * mutation-only variants a read never produces.
 */
export type PlanRegisterReadError = RegisterUnreadableError | RegisterInvalidError | RegisterStoreUnavailableError;

/**
 * Narrow a register failure to the read failures, or undefined for a mutation-only one a read never produces.
 *
 * @param error what the register refused with
 * @returns the same error as a read failure, or undefined
 */
export function planRegisterReadError({ error }: { error: PlanRegisterError }): PlanRegisterReadError | undefined {
  if (error.code === "REGISTER_UNREADABLE" || error.code === "REGISTER_INVALID") {
    return error;
  }
  if (error.code === "REGISTER_STORE_UNAVAILABLE") {
    return error;
  }
  return undefined;
}

/** Construct a {@link PlanRegisterError}. Tests build fixtures through here, never as object literals. */
export const PlanRegisterErrors = {
  registerUnreadable: ({ path }: { path: string }): RegisterUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message:
      `the plan register at \`${path}\` exists and could not be read, so which plans this install has is ` +
      `UNKNOWN — refusing rather than seating a session on whatever credential is ambient; check that ` +
      `file's permissions and that it is a file`,
    path,
  }),
  registerInvalid: ({ problems }: { problems: readonly string[] }): RegisterInvalidError => ({
    code: "REGISTER_INVALID",
    message: `the plan register is not usable: ${problems.join("; ")}`,
    problems,
  }),
  unknownDestination: ({ alias, provider }: { alias: string; provider: string }): UnknownDestinationError => ({
    alias,
    code: "UNKNOWN_DESTINATION",
    message: `no registered ${provider} plan is called \`${alias}\` — \`slopweaver plans list\` names every one`,
    provider,
  }),
  mutationConflict: ({ conflict }: { conflict: string }): MutationConflictError => ({
    code: "MUTATION_CONFLICT",
    conflict,
    message: `that change cannot be applied to the register as it stands: ${conflict}`,
  }),
  registerStoreUnavailable: ({
    doing,
    reason,
    staleStore,
  }: {
    doing: string;
    reason: string;
    staleStore?: boolean;
  }): RegisterStoreUnavailableError => ({
    code: "REGISTER_STORE_UNAVAILABLE",
    message:
      `the plan register lives in the store, and the store could not ${doing}, so which plans this install ` +
      `has is UNKNOWN — refusing rather than seating a session on whatever credential is ambient ` +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
    ...(staleStore === true ? { staleStore: true as const } : {}),
  }),
  registerRevisionConflict: ({ expectedRevision }: { expectedRevision: number }): RegisterRevisionConflictError => ({
    code: "REGISTER_REVISION_CONFLICT",
    expectedRevision,
    message:
      `the plan register changed while this change was being prepared (it was read at revision ` +
      `${String(expectedRevision)}), so nothing was written; read it again and decide whether the change ` +
      `still applies`,
  }),
  projectionWriteFailed: ({
    cause,
    committedRevision,
    paths,
  }: {
    cause: unknown;
    committedRevision: number;
    paths: readonly string[];
  }): ProjectionWriteFailedError => ({
    code: "PROJECTION_WRITE_FAILED",
    committedRevision,
    message:
      `the plan register was COMMITTED at revision ${String(committedRevision)} and its generated ` +
      `projection(s) at ${paths.join(", ")} were not, so older readers still see the previous fleet: ` +
      `${describeCause({ cause })}. This is not a rollback — rerun ` +
      `\`slopweaver plans validate --repair-projection\` rather than re-applying the change`,
    paths,
    registerCommitted: true,
  }),
  seatPassesNotCleared: ({ cause, path }: { cause: unknown; path: string }): SeatPassesNotClearedError => ({
    code: "SEAT_PASSES_NOT_CLEARED",
    message:
      `the seats' cached passes at ${path} could not be cleared, so the change was NOT committed — a pass it no ` +
      `longer earns would otherwise keep answering until the register's files are rewritten: ` +
      `${describeCause({ cause })}. Fix that directory's permissions and apply the change again`,
    path,
  }),
} as const;

/**
 * What a caught value says about itself, without letting a thrown request object into a message.
 *
 * @param cause whatever was thrown
 * @returns its message, or a constant when it is not an Error
 */
export function describeCause({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}
