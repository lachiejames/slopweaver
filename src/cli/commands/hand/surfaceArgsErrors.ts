/**
 * Why a `hand surface` invocation's flags do not describe one report — the verb's own typed union, one per bounded
 * module (`.claude/rules/error-handling.md`). Each is a usage problem the verb prints before anything is composed.
 */

/** The flag tokeniser refused the argv, before any report field was read. */
export interface SurfaceFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
}

/** A required flag, or every entry of a required list, is absent. */
export interface SurfaceFlagsMissingError {
  readonly code: "FLAGS_MISSING";
  readonly message: string;
  /** Each absent flag, `--`-prefixed. */
  readonly flags: readonly string[];
}

/** Part of the access triple was passed without the rest. */
export interface SurfaceAccessIncompleteError {
  readonly code: "ACCESS_INCOMPLETE";
  readonly message: string;
}

/** `--urgency` named a kind outside the closed set. */
export interface SurfaceUrgencyUnknownError {
  readonly code: "URGENCY_UNKNOWN";
  readonly message: string;
  readonly kind: string;
}

/** `--urgency`'s kind lacks a companion it needs, or carries one it does not take. */
export interface SurfaceUrgencyCompanionError {
  readonly code: "URGENCY_COMPANION";
  readonly message: string;
  readonly kind: string;
}

/** `--context` is neither of the two contexts a note may carry. */
export interface SurfaceContextInvalidError {
  readonly code: "CONTEXT_INVALID";
  readonly message: string;
}

/** Every way `hand surface`'s flags are refused before a report is built. */
export type HandSurfaceArgsError =
  | SurfaceFlagsRefusedError
  | SurfaceFlagsMissingError
  | SurfaceAccessIncompleteError
  | SurfaceUrgencyUnknownError
  | SurfaceUrgencyCompanionError
  | SurfaceContextInvalidError;

/** Constructors for {@link HandSurfaceArgsError}. The only place one is built. */
export const HandSurfaceArgsErrors = {
  accessIncomplete: (): SurfaceAccessIncompleteError => ({
    code: "ACCESS_INCOMPLETE",
    message: "--access, --holder and --would-settle come together: the access, who holds it, and what it would settle",
  }),
  contextInvalid: ({ stated }: { stated: string }): SurfaceContextInvalidError => ({
    code: "CONTEXT_INVALID",
    message: `--context must be work or slopweaver, not ${stated}`,
  }),
  flagsMissing: ({ flags }: { flags: readonly string[] }): SurfaceFlagsMissingError => ({
    code: "FLAGS_MISSING",
    flags,
    message: `hand surface needs ${flags.join(", ")}`,
  }),
  flagsRefused: ({ lines }: { lines: readonly string[] }): SurfaceFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: lines.join("; "),
  }),
  urgencyCompanion: ({ kind, why }: { kind: string; why: string }): SurfaceUrgencyCompanionError => ({
    code: "URGENCY_COMPANION",
    kind,
    message: `--urgency ${kind} ${why}`,
  }),
  urgencyUnknown: ({ kind, known }: { kind: string; known: readonly string[] }): SurfaceUrgencyUnknownError => ({
    code: "URGENCY_UNKNOWN",
    kind,
    message: `--urgency must be one of ${known.join("|")}, not ${kind}`,
  }),
} as const;
