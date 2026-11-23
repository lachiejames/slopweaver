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

/** Every way `home reclaim` fails. */
export type HomeReclaimError =
  RootNotDeclaredError | RootNotDirectoryError | ScanFailedError | ApplyFailedError | WitnessFailedError;

/** Construct one `HomeReclaimError`. The factory the real code calls, so a test fixture is built the same way. */
export const HomeReclaimErrors = {
  applyFailed: ({ path, cause }: { path: string; cause: unknown }): ApplyFailedError => ({
    cause,
    code: "APPLY_FAILED",
    message: `could not remove ${path}: ${cause instanceof Error ? cause.message : "unknown failure"}`,
    path,
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
