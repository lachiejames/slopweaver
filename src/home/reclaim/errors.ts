/**
 * The `home reclaim` domain's failures. One bounded module: reclaiming the obviously-junk bytes from the
 * declared scratch roots under `$SLOPWEAVER_HOME`.
 *
 * Its own union rather than the default `Result<T>` because a caller branches on every one of these. A root
 * that is not declared and a protected path that would have been deleted are different acts — the first is
 * a usage mistake, the second is the safety rail firing and the thing an operator must never see silently.
 */

/** A root was named that the allowlist does not carry. */
export interface RootNotDeclaredError {
  readonly code: "ROOT_NOT_DECLARED";
  readonly message: string;
  readonly named: string;
}

/** The scratch roots exist, but the walk could not read one. */
export interface ScanFailedError {
  readonly code: "SCAN_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * The declared root is a symlink or not a directory. Every removal is a path below the root, so a root that
 * resolves elsewhere would delete outside the home while its witness, walking the same resolution, held.
 */
export interface RootNotDirectoryError {
  readonly code: "ROOT_NOT_DIRECTORY";
  readonly message: string;
  readonly path: string;
}

/** A delete was asked for and the filesystem refused it. */
export interface ApplyFailedError {
  readonly code: "APPLY_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * The post-apply witness failed: a path the walk KEPT no longer stats. Information was lost, which is the
 * one outcome this verb exists to make impossible.
 */
export interface WitnessFailedError {
  readonly code: "WITNESS_FAILED";
  readonly message: string;
  readonly lostPaths: readonly string[];
}

/** Why a finished pass's own scratch was refused before anything was removed. */
export type PassScratchRefusal = "workspace-mismatch" | "record-missing" | "artifact-missing" | "record-shaped-scratch";

/**
 * A pass asked to reclaim its own scratch and a check refused it BEFORE any removal, so the scratch is still
 * there. `home reclaim --root codex-scratch` applies the same checks later, so a refusal here is one to inspect.
 */
export interface PassScratchNotReclaimableError {
  readonly code: "PASS_SCRATCH_NOT_RECLAIMABLE";
  readonly message: string;
  readonly artifactId: string;
  readonly reason: PassScratchRefusal;
}

/** Every way `home reclaim` fails. */
export type HomeReclaimError =
  | RootNotDeclaredError
  | RootNotDirectoryError
  | ScanFailedError
  | ApplyFailedError
  | WitnessFailedError
  | PassScratchNotReclaimableError;

/** What each refusal means, in the words the message carries. */
const PASS_SCRATCH_REFUSAL_WHY: Readonly<Record<PassScratchRefusal, string>> = {
  "artifact-missing": "its artifact.md is not there, so the pass is not finished",
  "record-missing": "its record.json is not there, so the record the witness checks is incomplete",
  "record-shaped-scratch": "the scratch holds a record.json or artifact.md at its top, so it may be a record",
  "workspace-mismatch": "the path is not the one this pass's own scratch was created at",
};

/** Construct one `HomeReclaimError`. The factory the real code calls, so a test fixture is built the same way. */
export const HomeReclaimErrors = {
  applyFailed: ({ path, cause }: { path: string; cause: unknown }): ApplyFailedError => ({
    cause,
    code: "APPLY_FAILED",
    message: `could not remove ${path}: ${cause instanceof Error ? cause.message : "unknown failure"}`,
    path,
  }),
  passScratchNotReclaimable: ({
    artifactId,
    reason,
  }: {
    artifactId: string;
    reason: PassScratchRefusal;
  }): PassScratchNotReclaimableError => ({
    artifactId,
    code: "PASS_SCRATCH_NOT_RECLAIMABLE",
    message: `pass ${artifactId}'s scratch was left in place: ${PASS_SCRATCH_REFUSAL_WHY[reason]}`,
    reason,
  }),
  rootNotDeclared: ({ named, declared }: { named: string; declared: readonly string[] }): RootNotDeclaredError => ({
    code: "ROOT_NOT_DECLARED",
    message: `no reclaim root is declared as "${named}" — declared roots are ${declared.join(", ")}`,
    named,
  }),
  rootNotDirectory: ({ path }: { path: string }): RootNotDirectoryError => ({
    code: "ROOT_NOT_DIRECTORY",
    message: `${path} is a symlink or not a directory, so nothing below it is reclaimed — a removal there would land wherever it resolves`,
    path,
  }),
  scanFailed: ({ path, cause }: { path: string; cause: unknown }): ScanFailedError => ({
    cause,
    code: "SCAN_FAILED",
    message: `could not walk ${path}: ${cause instanceof Error ? cause.message : "unknown failure"}`,
    path,
  }),
  witnessFailed: ({ lostPaths }: { lostPaths: readonly string[] }): WitnessFailedError => ({
    code: "WITNESS_FAILED",
    lostPaths,
    message: `the reclaim lost information: ${String(lostPaths.length)} kept path(s) no longer exist`,
  }),
} as const;
