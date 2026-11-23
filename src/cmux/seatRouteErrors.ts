/**
 * The Codex-seat routing domain's typed errors — why a `--driver codex` spawn has nowhere to boot.
 *
 * Its own union rather than a member of `./errors.ts`: that one is the cmux control-socket's, and every
 * variant here is decided before a socket is opened at all. The four codes are what a caller BRANCHES on —
 * `cmux spawn` prints the message, while a future caller (the ask dispatcher) may want to fall back to a
 * visible Claude seat on `EVERY_DESTINATION_UNAVAILABLE` and never on `PLAN_NOT_REGISTERED`, which is a
 * typo in the operator's own command line.
 *
 * Each message names the destinations it saw, because the failure a reader is most often holding is "I
 * thought that plan was registered" and an error that omits the list cannot settle it.
 */

import type { CodexRouteExclusion } from "../codex/fleetTypes.js";

/** The register carries no Codex row at all, so there is nothing to rank. */
export interface NoCodexDestinationError {
  readonly code: "NO_CODEX_DESTINATION";
  readonly message: string;
}

/** Every registered Codex destination is excluded — paused, at its usage limit, refusing and so on — so none can take the seat. */
export interface EveryCodexDestinationUnavailableError {
  readonly code: "EVERY_DESTINATION_UNAVAILABLE";
  readonly message: string;
  /** Each destination's own reason, kept whole so a caller can report the awkward row rather than a count. */
  readonly exclusions: readonly CodexRouteExclusion[];
}

/** `--plan <alias>` named an alias no Codex row carries. */
export interface CodexPlanNotRegisteredError {
  readonly code: "PLAN_NOT_REGISTERED";
  readonly message: string;
  readonly alias: string;
  /** Every Codex alias that IS registered, so the reader can see the one they meant. */
  readonly registered: readonly string[];
}

/** `--plan <alias>` named a real Codex row that is excluded — paused, at its usage limit, or refusing and not forced past. */
export interface CodexPlanUnavailableError {
  readonly code: "PLAN_UNAVAILABLE";
  readonly message: string;
  readonly alias: string;
  readonly kind: CodexRouteExclusion["kind"];
}

/** Every way a Codex seat can fail to route. */
export type CodexSeatRouteError =
  | NoCodexDestinationError
  | EveryCodexDestinationUnavailableError
  | CodexPlanNotRegisteredError
  | CodexPlanUnavailableError;

/** One exclusion as a reader-facing clause: which destination, and its own stated reason. */
function clauseFor({ exclusion }: { exclusion: CodexRouteExclusion }): string {
  return `${exclusion.destination.alias} (${exclusion.kind}: ${exclusion.reason})`;
}

/** The factory every producer of a {@link CodexSeatRouteError} constructs through — tests included. */
export const CodexSeatRouteErrors = {
  everyDestinationUnavailable: ({
    exclusions,
  }: {
    exclusions: readonly CodexRouteExclusion[];
  }): EveryCodexDestinationUnavailableError => ({
    code: "EVERY_DESTINATION_UNAVAILABLE",
    exclusions,
    message:
      `no registered Codex destination can take this seat: ` +
      `${exclusions.map((exclusion) => clauseFor({ exclusion })).join("; ")}`,
  }),
  noDestination: (): NoCodexDestinationError => ({
    code: "NO_CODEX_DESTINATION",
    message:
      "the plan register carries no Codex destination: `slopweaver plans add --provider codex` names one, " +
      "and the sign-in is the owner's own terminal",
  }),
  planNotRegistered: ({
    alias,
    registered,
  }: {
    alias: string;
    registered: readonly string[];
  }): CodexPlanNotRegisteredError => ({
    alias,
    code: "PLAN_NOT_REGISTERED",
    message: `no Codex destination is registered as ${alias} — registered: ${registered.join(", ")}`,
    registered,
  }),
  planUnavailable: ({ exclusion }: { exclusion: CodexRouteExclusion }): CodexPlanUnavailableError => ({
    alias: exclusion.destination.alias,
    code: "PLAN_UNAVAILABLE",
    kind: exclusion.kind,
    message: `${exclusion.destination.alias} cannot take this seat — ${exclusion.kind}: ${exclusion.reason}`,
  }),
} as const;
