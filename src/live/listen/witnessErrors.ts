/**
 * Typed domain errors for witnessing a peer bot's threads — see `.claude/rules/error-handling.md` for the shape.
 *
 * Two unions, one per bounded concern, sharing no base type: resolving the configured handles against the
 * member directory (`./witnessIdentity.ts`), and the durable witnessed-thread snapshot
 * (`./witnessStateStore.ts`). Both are STARTUP refusals — `listen` prints one and never opens Socket Mode —
 * except a state write failing mid-run, which costs that one line its handoff and is logged.
 */

// ---------------------------------------------------------------------------------------------------------
// WitnessIdentityError — `slackBot.witnessBotHandles` against `corpus/members/slack.jsonl`.
// ---------------------------------------------------------------------------------------------------------

/** The member directory could not be read cleanly, so no handle can be trusted to resolve. */
export interface WitnessDirectoryUnreadableError {
  readonly code: "WITNESS_DIRECTORY_UNREADABLE";
  readonly message: string;
  readonly warnings: readonly string[];
}

/** No current member row carries the handle. */
export interface WitnessBotNotFoundError {
  readonly code: "WITNESS_BOT_NOT_FOUND";
  readonly message: string;
  readonly handle: string;
}

/** More than one current member row carries the handle — witnessing the wrong one is worse than none. */
export interface WitnessBotAmbiguousError {
  readonly code: "WITNESS_BOT_AMBIGUOUS";
  readonly message: string;
  readonly handle: string;
  readonly userIds: readonly string[];
}

/** The one row carrying the handle is a person, not a bot. */
export interface WitnessBotNotABotError {
  readonly code: "WITNESS_BOT_NOT_A_BOT";
  readonly message: string;
  readonly handle: string;
  readonly userId: string;
}

/** Every failure {@link ./witnessIdentity.resolveWitnessBots} can produce. */
export type WitnessIdentityError =
  WitnessDirectoryUnreadableError | WitnessBotNotFoundError | WitnessBotAmbiguousError | WitnessBotNotABotError;

/** Factories for every {@link WitnessIdentityError} variant. */
export const WitnessIdentityErrors = {
  /** @returns a {@link WitnessBotAmbiguousError} naming every candidate id */
  ambiguous: ({ handle, userIds }: { handle: string; userIds: readonly string[] }): WitnessBotAmbiguousError => ({
    code: "WITNESS_BOT_AMBIGUOUS",
    handle,
    message:
      `witness handle "${handle}" matches ${String(userIds.length)} current Slack members (${userIds.join(", ")}) — ` +
      "refusing to guess which bot to witness",
    userIds,
  }),

  /** @returns a {@link WitnessBotNotABotError} naming the person the handle resolved to */
  notABot: ({ handle, userId }: { handle: string; userId: string }): WitnessBotNotABotError => ({
    code: "WITNESS_BOT_NOT_A_BOT",
    handle,
    message: `witness handle "${handle}" resolves to ${userId}, which is not a bot — only a peer bot's threads are witnessed`,
    userId,
  }),

  /** @returns a {@link WitnessBotNotFoundError} naming the handle */
  notFound: ({ handle }: { handle: string }): WitnessBotNotFoundError => ({
    code: "WITNESS_BOT_NOT_FOUND",
    handle,
    message:
      `witness handle "${handle}" matches no current Slack member — run \`slopweaver refresh --source slack\` to refresh ` +
      "the member directory, or correct `slackBot.witnessBotHandles` in profile.json",
  }),

  /** @returns a {@link WitnessDirectoryUnreadableError} carrying the reader's own warnings */
  unreadable: ({ warnings }: { warnings: readonly string[] }): WitnessDirectoryUnreadableError => ({
    code: "WITNESS_DIRECTORY_UNREADABLE",
    message: `the Slack member directory did not read cleanly, so no witness handle can be resolved: ${warnings.join("; ")}`,
    warnings,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// WitnessStateError — the durable witnessed-thread snapshot (`witness-state.json`).
// ---------------------------------------------------------------------------------------------------------

/** The snapshot exists but could not be read (anything but ENOENT). */
export interface WitnessStateUnreadableError {
  readonly code: "WITNESS_STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The snapshot's bytes are not the shape this version writes — never silently treated as empty. */
export interface WitnessStateMalformedError {
  readonly code: "WITNESS_STATE_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** Writing the snapshot failed. */
export interface WitnessStateWriteFailedError {
  readonly code: "WITNESS_STATE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every failure the witnessed-thread snapshot's read and write can produce. */
export type WitnessStateError = WitnessStateUnreadableError | WitnessStateMalformedError | WitnessStateWriteFailedError;

/** Factories for every {@link WitnessStateError} variant. */
export const WitnessStateErrors = {
  /** @returns a {@link WitnessStateMalformedError} naming what was wrong with the snapshot */
  malformed: ({ path, why }: { path: string; why: string }): WitnessStateMalformedError => ({
    code: "WITNESS_STATE_MALFORMED",
    message: `witness state at ${path} is malformed (${why}) — refusing to treat a corrupt snapshot as no threads`,
    path,
  }),

  /** @returns a {@link WitnessStateUnreadableError} wrapping the I/O failure */
  unreadable: ({ path, cause }: { path: string; cause: unknown }): WitnessStateUnreadableError => ({
    code: "WITNESS_STATE_UNREADABLE",
    message: `witness state at ${path} could not be read (${String(cause)})`,
    path,
  }),

  /** @returns a {@link WitnessStateWriteFailedError} wrapping the I/O failure */
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): WitnessStateWriteFailedError => ({
    code: "WITNESS_STATE_WRITE_FAILED",
    message: `witness state at ${path} could not be written (${String(cause)})`,
    path,
  }),
} as const;
