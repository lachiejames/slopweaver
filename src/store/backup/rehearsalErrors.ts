/**
 * The restore rehearsal's own typed error union — every way `slopweaver store rehearse` refuses a target or
 * stops before it has a verdict. Distinct from `./errors.ts`, whose subject is a backup or a restore INTO THE
 * LIVE STACK; a rehearsal's subject is a throwaway Postgres beside it, and the refusals below are the reason it
 * can never be anything else. They share no base type, per `.claude/rules/error-handling.md`.
 *
 * A failed CHECK is not here. A schema that differs, a count that does not reconcile, a sampled row that is
 * not byte-equal — those are the rehearsal WORKING, and they ride its report as a verdict, because a rehearsal
 * that could only say "error" when the backup is bad would have nothing to file.
 */

/** The target would name the live store — its database, its port, its container or its data directory. */
export interface RehearsalTargetIsLiveError {
  readonly code: "REHEARSAL_TARGET_IS_LIVE";
  readonly message: string;
  /** Every live coordinate the requested target collided with, one line each. */
  readonly collisions: readonly string[];
}

/** A container of the throwaway's name already exists, and a rehearsal never removes one. */
export interface RehearsalContainerExistsError {
  readonly code: "REHEARSAL_CONTAINER_EXISTS";
  readonly message: string;
  readonly container: string;
}

/** The live store could not be described — its container inspected, or its selection parsed. */
export interface RehearsalLiveUnreadableError {
  readonly code: "REHEARSAL_LIVE_UNREADABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The destination holds no backup this install can rehearse. */
export interface RehearsalNoBackupError {
  readonly code: "REHEARSAL_NO_BACKUP";
  readonly message: string;
  readonly destination: string;
  readonly project: string;
}

/** A step of the rehearsal itself failed: the throwaway would not start, a download or a replay stopped. */
export interface RehearsalStepFailedError {
  readonly code: "REHEARSAL_STEP_FAILED";
  readonly message: string;
  readonly step: string;
  readonly reasons: readonly string[];
}

/** Every way a rehearsal stops before it reaches a verdict. */
export type RehearsalError =
  | RehearsalTargetIsLiveError
  | RehearsalContainerExistsError
  | RehearsalLiveUnreadableError
  | RehearsalNoBackupError
  | RehearsalStepFailedError;

/** The factories the rehearsal constructs its failures with. Tests build fixtures through these. */
export const RehearsalErrors = {
  containerExists: ({ container }: { container: string }): RehearsalContainerExistsError => ({
    code: "REHEARSAL_CONTAINER_EXISTS",
    container,
    message:
      `a container named ${container} already exists — a rehearsal never removes one, because it cannot tell ` +
      `from here whether it is a rehearsal you kept with --keep or something else. Inspect it with ` +
      `\`docker inspect ${container}\`, stop it yourself if it is a kept rehearsal, or pass --container <name>.`,
  }),
  liveUnreadable: ({ reasons }: { reasons: readonly string[] }): RehearsalLiveUnreadableError => ({
    code: "REHEARSAL_LIVE_UNREADABLE",
    message:
      `${reasons.join("; ")} — the live store could not be described, and a rehearsal that cannot say what the ` +
      `live store IS cannot prove its target is not it, so nothing was started.`,
    reasons,
  }),
  noBackup: ({ destination, project }: { destination: string; project: string }): RehearsalNoBackupError => ({
    code: "REHEARSAL_NO_BACKUP",
    destination,
    message: `${destination}/${project}/ holds no backup with a manifest.json — there is nothing to rehearse`,
    project,
  }),
  stepFailed: ({ step, reasons }: { step: string; reasons: readonly string[] }): RehearsalStepFailedError => ({
    code: "REHEARSAL_STEP_FAILED",
    message: `${step}: ${reasons.join("; ")}`,
    reasons,
    step,
  }),
  targetIsLive: ({ collisions }: { collisions: readonly string[] }): RehearsalTargetIsLiveError => ({
    code: "REHEARSAL_TARGET_IS_LIVE",
    collisions,
    message:
      `refused before anything ran — the rehearsal target collides with the LIVE store: ${collisions.join("; ")}. ` +
      `A rehearsal restores into a throwaway Postgres of its own and never into the one live database.`,
  }),
} as const;
