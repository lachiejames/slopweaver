/**
 * The desktop shell's typed failures, one union per domain: bringing the console up, the permissions guide's
 * presses, the shell's own saved state, the checkout it serves, and reading and recovering the fleet. Every `message` is what the menu bar or the
 * sessions page's fold shows, so it is written for you.
 */

/** The console could not be read, started or reached. */
export type ConsoleError =
  | { readonly code: "PROCESS_FAILED"; readonly message: string; readonly command: string }
  | { readonly code: "PROCESS_TIMEOUT"; readonly message: string; readonly command: string }
  | { readonly code: "NO_ENDPOINT"; readonly message: string }
  | { readonly code: "CONFLICTING_ENDPOINTS"; readonly message: string; readonly endpoints: readonly string[] }
  | { readonly code: "CONSOLE_UNREACHABLE"; readonly message: string; readonly endpoint: string };

/** Build a {@link ConsoleError}, each with the sentence the menu bar shows. */
export const ConsoleErrors = {
  conflictingEndpoints: ({ endpoints }: { endpoints: readonly string[] }): ConsoleError => ({
    code: "CONFLICTING_ENDPOINTS",
    endpoints,
    message: `the console script named ${String(endpoints.length)} different addresses (${endpoints.join(", ")})`,
  }),
  noEndpoint: ({ output }: { output: string }): ConsoleError => ({
    code: "NO_ENDPOINT",
    message: `the console is not serving: ${lastLine({ text: output })}`,
  }),
  processFailed: ({ command, detail }: { command: string; detail: string }): ConsoleError => ({
    code: "PROCESS_FAILED",
    command,
    message: `${command} failed: ${lastLine({ text: detail })}`,
  }),
  processTimeout: ({ command, seconds }: { command: string; seconds: number }): ConsoleError => ({
    code: "PROCESS_TIMEOUT",
    command,
    message: `${command} did not finish in ${String(seconds)}s`,
  }),
  unreachable: ({ endpoint, detail }: { endpoint: string; detail: string }): ConsoleError => ({
    code: "CONSOLE_UNREACHABLE",
    endpoint,
    message: `${endpoint} did not answer: ${detail}`,
  }),
} as const;

/** Which of the System Audio Recording helper's two verbs ran (`systemAudioPermission.ts`). */
export type SystemAudioHelperVerb = "preflight" | "request";

/**
 * A press on the permissions guide that macOS refused to carry out, or a System Audio Recording status the helper
 * could not read — which the guide shows as off, never as on.
 */
export type PermissionGuideError =
  | { readonly code: "PROMPT_FAILED"; readonly message: string; readonly permission: string }
  | { readonly code: "SETTINGS_OPEN_FAILED"; readonly message: string; readonly url: string }
  | { readonly code: "SYSTEM_AUDIO_HELPER_MISSING"; readonly message: string; readonly path: string }
  | {
      readonly code: "SYSTEM_AUDIO_HELPER_START_FAILED";
      readonly message: string;
      readonly path: string;
      readonly verb: SystemAudioHelperVerb;
    }
  | {
      readonly code: "SYSTEM_AUDIO_HELPER_TIMED_OUT";
      readonly message: string;
      readonly verb: SystemAudioHelperVerb;
      readonly timeoutMs: number;
    }
  | {
      readonly code: "SYSTEM_AUDIO_HELPER_FAILED";
      readonly message: string;
      readonly exitCode: number | null;
      readonly stderr: string;
    }
  | {
      readonly code: "SYSTEM_AUDIO_HELPER_MALFORMED";
      readonly message: string;
      readonly stdout: string;
      readonly stderr: string;
    };

/** Build a {@link PermissionGuideError}, each with the sentence the guide shows under its button. */
export const PermissionGuideErrors = {
  helperFailed: ({ exitCode, stderr }: { exitCode: number | null; stderr: string }): PermissionGuideError => ({
    code: "SYSTEM_AUDIO_HELPER_FAILED",
    exitCode,
    message: `System Audio Recording could not be read (${exitCode === null ? "the helper was stopped" : `exit ${String(exitCode)}`}): ${lastLine({ text: stderr })}`,
    stderr,
  }),
  helperMalformed: ({ stdout, stderr }: { stdout: string; stderr: string }): PermissionGuideError => {
    const answered = JSON.stringify(stdout.slice(0, 80));
    const reported = stderr.trim();
    // A helper that reported a problem is believed over its answer, so the problem is what the owner reads.
    const why =
      reported === ""
        ? `the helper answered ${answered}, not granted, denied or not-determined`
        : `the helper reported ${JSON.stringify(reported.slice(0, 200))} beside its answer ${answered}`;
    return {
      code: "SYSTEM_AUDIO_HELPER_MALFORMED",
      message: `System Audio Recording could not be read: ${why}`,
      stderr,
      stdout,
    };
  },
  helperMissing: ({ path }: { path: string }): PermissionGuideError => ({
    code: "SYSTEM_AUDIO_HELPER_MISSING",
    message: `System Audio Recording could not be read: ${path} is missing. Reinstall Slopweaver with slopweaver desktop install`,
    path,
  }),
  helperStartFailed: ({
    path,
    verb,
    cause,
  }: {
    path: string;
    verb: SystemAudioHelperVerb;
    cause: unknown;
  }): PermissionGuideError => ({
    code: "SYSTEM_AUDIO_HELPER_START_FAILED",
    message: `System Audio Recording's helper did not start (${verb}): ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
    verb,
  }),
  helperTimedOut: ({ verb, timeoutMs }: { verb: SystemAudioHelperVerb; timeoutMs: number }): PermissionGuideError => ({
    code: "SYSTEM_AUDIO_HELPER_TIMED_OUT",
    message:
      verb === "request"
        ? `macOS's System Audio Recording prompt had no answer in ${String(timeoutMs / 60_000)} minutes; answer it if it is still up, or turn it on in System Settings`
        : `System Audio Recording could not be read: the helper did not answer in ${String(timeoutMs / 1000)}s`,
    timeoutMs,
    verb,
  }),
  promptFailed: ({ permission, cause }: { permission: string; cause: unknown }): PermissionGuideError => ({
    code: "PROMPT_FAILED",
    message: `macOS did not ask for ${permission}: ${cause instanceof Error ? cause.message : String(cause)}`,
    permission,
  }),
  settingsOpenFailed: ({ url, cause }: { url: string; cause: unknown }): PermissionGuideError => ({
    code: "SETTINGS_OPEN_FAILED",
    message: `System Settings did not open: ${cause instanceof Error ? cause.message : String(cause)}. Open it from the Apple menu, then Privacy & Security`,
    url,
  }),
} as const;

/** The shell's saved state could not be read or written. */
export type StateError =
  | { readonly code: "STATE_UNREADABLE"; readonly message: string }
  | { readonly code: "STATE_MALFORMED"; readonly message: string; readonly field: string }
  | { readonly code: "STATE_UNWRITABLE"; readonly message: string };

/** Build a {@link StateError}. */
export const StateErrors = {
  malformed: ({ field }: { field: string }): StateError => ({
    code: "STATE_MALFORMED",
    field,
    message: `the saved window state was malformed at ${field}, so it opened fresh`,
  }),
  unreadable: ({ detail }: { detail: string }): StateError => ({
    code: "STATE_UNREADABLE",
    message: `the saved window state could not be read (${detail}), so it opened fresh`,
  }),
  unwritable: ({ detail }: { detail: string }): StateError => ({
    code: "STATE_UNWRITABLE",
    message: `the window state could not be saved (${detail})`,
  }),
} as const;

/** The shell's own event log could not be written (`desktopEventLog.ts`). */
export type DesktopLogError = { readonly code: "LOG_UNWRITABLE"; readonly message: string; readonly path: string };

/** Build a {@link DesktopLogError}. */
export const DesktopLogErrors = {
  unwritable: ({ detail, path }: { detail: string; path: string }): DesktopLogError => ({
    code: "LOG_UNWRITABLE",
    message: `the desktop event log at ${path} could not be written (${detail})`,
    path,
  }),
} as const;

/** No Slopweaver checkout to serve the console from. */
export type CheckoutError =
  | { readonly code: "CHECKOUT_UNSET"; readonly message: string }
  | { readonly code: "CHECKOUT_INVALID"; readonly message: string; readonly path: string }
  | { readonly code: "CHECKOUT_SELECTION_FAILED"; readonly message: string };

/** Build a {@link CheckoutError}. */
export const CheckoutErrors = {
  invalid: ({ path }: { path: string }): CheckoutError => ({
    code: "CHECKOUT_INVALID",
    message: `${path} is not a Slopweaver clone (no scripts/docs-site.sh and site/)`,
    path,
  }),
  selectionFailed: ({ cause }: { cause: unknown }): CheckoutError => ({
    code: "CHECKOUT_SELECTION_FAILED",
    message: `the folder picker failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  unset: (): CheckoutError => ({
    code: "CHECKOUT_UNSET",
    message: "no Slopweaver clone is chosen yet",
  }),
} as const;

/**
 * Whether a failure is about which clone serves the console, which Retry cannot fix and choosing a clone can.
 *
 * @returns true for every {@link CheckoutError}
 */
export function isCheckoutProblem({ failure }: { failure: { readonly code: string } }): boolean {
  return (
    failure.code === "CHECKOUT_UNSET" ||
    failure.code === "CHECKOUT_INVALID" ||
    failure.code === "CHECKOUT_SELECTION_FAILED"
  );
}

/** The logo asset both icons are made from could not be read as one. */
export type LogoError =
  | { readonly code: "LOGO_NOT_PNG"; readonly message: string }
  | { readonly code: "LOGO_CORRUPT"; readonly message: string }
  | { readonly code: "LOGO_UNSUPPORTED"; readonly message: string }
  | { readonly code: "LOGO_NOT_SQUARE"; readonly message: string }
  | { readonly code: "LOGO_TOO_SMALL"; readonly message: string }
  | { readonly code: "LOGO_NO_MARK"; readonly message: string }
  | { readonly code: "LOGO_TOO_FAINT"; readonly message: string };

/** Build a {@link LogoError}. */
export const LogoErrors = {
  corrupt: ({ detail }: { detail: string }): LogoError => ({
    code: "LOGO_CORRUPT",
    message: `the logo asset is a damaged PNG: ${detail}`,
  }),
  noMark: (): LogoError => ({
    code: "LOGO_NO_MARK",
    message:
      "the logo asset has no mark the menu bar can draw: give it a transparent background, or a solid plate with " +
      "the mark in a contrasting colour",
  }),
  notPng: (): LogoError => ({ code: "LOGO_NOT_PNG", message: "the logo asset is not a PNG file" }),
  notSquare: ({ width, height }: { width: number; height: number }): LogoError => ({
    code: "LOGO_NOT_SQUARE",
    message: `the logo asset is ${String(width)}x${String(height)}, and an icon is square`,
  }),
  tooFaint: ({ size }: { size: number }): LogoError => ({
    code: "LOGO_TOO_FAINT",
    message:
      `the logo's mark is too thin or sparse to show in the menu bar at ${String(size)}px, so no pixel of it comes ` +
      "out even half opaque; use a bolder mark",
  }),
  tooSmall: ({ side, needed }: { side: number; needed: number }): LogoError => ({
    code: "LOGO_TOO_SMALL",
    message: `the logo asset is ${String(side)}px a side, and the largest app icon needs ${String(needed)}`,
  }),
  unsupported: ({
    depth,
    colourType,
    interlace,
  }: {
    depth: number;
    colourType: number;
    interlace: number;
  }): LogoError => ({
    code: "LOGO_UNSUPPORTED",
    message:
      `the logo asset is a PNG of bit depth ${String(depth)}, colour type ${String(colourType)}, interlace ` +
      `${String(interlace)}; save it as 8-bit RGBA, not interlaced`,
  }),
  unsupportedChunk: ({ type }: { type: string }): LogoError => ({
    code: "LOGO_UNSUPPORTED",
    message: `the logo asset carries a ${type} chunk the icons cannot honour; save it as plain 8-bit RGBA`,
  }),
} as const;

/**
 * The fleet could not be read, or the shell could not reach cmux to recover it. Each `message` is the fold's
 * text on the sessions page; the headline above it is the page's own sentence (`fleetPage.ts`).
 */
export type FleetError =
  | { readonly code: "FLEET_UNREADABLE"; readonly message: string }
  | { readonly code: "FLEET_MALFORMED"; readonly message: string; readonly field: string }
  | { readonly code: "AUTOMATION_DENIED"; readonly message: string }
  | { readonly code: "CMUX_UNAVAILABLE"; readonly message: string }
  | { readonly code: "LAUNCH_FAILED"; readonly message: string };

/** Build a {@link FleetError}. */
export const FleetErrors = {
  automationDenied: ({ detail }: { detail: string }): FleetError => ({
    code: "AUTOMATION_DENIED",
    message: `macOS refused Slopweaver control of cmux: ${lastLine({ text: detail })}`,
  }),
  cmuxUnavailable: ({ detail }: { detail: string }): FleetError => ({
    code: "CMUX_UNAVAILABLE",
    message: `cmux did not open: ${lastLine({ text: detail })}`,
  }),
  launchFailed: ({ detail }: { detail: string }): FleetError => ({
    code: "LAUNCH_FAILED",
    message: `the recovery tab did not open: ${lastLine({ text: detail })}`,
  }),
  malformed: ({ field }: { field: string }): FleetError => ({
    code: "FLEET_MALFORMED",
    field,
    message: `fleet health printed a document malformed at ${field}`,
  }),
  unreadable: ({ detail }: { detail: string }): FleetError => ({
    code: "FLEET_UNREADABLE",
    message: `fleet health did not run: ${lastLine({ text: detail })}`,
  }),
} as const;

/**
 * The last non-empty line of a process's output, which is where a script says what went wrong.
 *
 * @param text everything the process printed
 * @returns that line, or `no output` when it printed nothing
 */
export function lastLine({ text }: { text: string }): string {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const last = lines.at(-1);
  if (last === undefined) {
    return "no output";
  }
  return last.trim();
}
