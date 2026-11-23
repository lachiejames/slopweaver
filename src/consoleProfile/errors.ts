/**
 * Why a `slopweaver perf console` walk could not produce a report at all. A page that is slow, a read that never
 * answered or a flow with nothing to press is a MEASUREMENT and lands in the report; these are the failures that
 * leave no report to print.
 */

/** No browser could be launched — the Playwright build is missing or refused to start. */
export interface BrowserLaunchFailedError {
  readonly code: "BROWSER_LAUNCH_FAILED";
  readonly message: string;
}

/** The console did not answer its first page, so there is nothing to walk. */
export interface ConsoleUnreachableError {
  readonly code: "CONSOLE_UNREACHABLE";
  readonly message: string;
  readonly base: string;
}

/** Every way a walk ends without a report. */
export type ConsoleProfileError = BrowserLaunchFailedError | ConsoleUnreachableError;

export const ConsoleProfileErrors = {
  browserLaunchFailed: ({ cause }: { cause: unknown }): BrowserLaunchFailedError => ({
    code: "BROWSER_LAUNCH_FAILED",
    message:
      `perf console: no browser could be launched — ${cause instanceof Error ? cause.message : String(cause)}. ` +
      "Install the build this checkout's playwright-core pins with `npx playwright-core install chromium`.",
  }),
  consoleUnreachable: ({ base, why }: { base: string; why: string }): ConsoleUnreachableError => ({
    base,
    code: "CONSOLE_UNREACHABLE",
    message:
      `perf console: ${base} did not answer (${why}). Serve a production build first — ` +
      "`scripts/docs-site.sh --serve` — and pass its address with --base.",
  }),
} as const;
