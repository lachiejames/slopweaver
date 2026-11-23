/**
 * Why the desktop e2e leg's reopen probe (`./e2eReopenProbe.ts`) could not be closed — that module's own typed union,
 * one per bounded module (`.claude/rules/error-handling.md`). A union rather than the plain string list because
 * `src/talk` is past the `error-shape-threshold` gate's four distinct plain shapes.
 */

/** The probe file could not be removed and a test call can still read it, so the reopen window stays armed. */
export interface ReopenProbeStillArmedError {
  readonly code: "REOPEN_PROBE_STILL_ARMED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way closing the reopen probe fails. */
export type ReopenProbeError = ReopenProbeStillArmedError;

/** The factories for {@link ReopenProbeError}. */
export const ReopenProbeErrors = {
  stillArmed: ({ path, cause }: { path: string; cause: unknown }): ReopenProbeStillArmedError => ({
    cause,
    code: "REOPEN_PROBE_STILL_ARMED",
    message: `could not remove the reopen probe at ${path}, which a test call can still read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
