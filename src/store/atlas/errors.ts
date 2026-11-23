/**
 * The atlas import's own typed failures.
 *
 * One `<Domain>Error` union for this directory, per `.claude/rules/error-handling.md`, and it earns the
 * ceremony rather than inheriting it: the loader BRANCHES on these. A malformed envelope means skip the
 * whole kind, because nothing after line 1 can be attributed without it; a malformed entity means skip one
 * LINE and count it, because the tens of thousands of other rows in that file are fine. Collapsing the two into
 * `readonly string[]` would make the second indistinguishable from the first, and a single bad line would
 * cost a platform.
 */

/** A line that did not decode as JSON, or decoded to something that is not an object. */
export interface AtlasUnreadableLineError {
  readonly code: "UNREADABLE_LINE";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
}

/**
 * The envelope on line 1 is unusable — absent, not an object, or missing `kind`/`updatedAt`.
 *
 * Fatal for the KIND rather than for the line, which is why it is not {@link AtlasUnreadableLineError}: the
 * envelope names what every entity after it is, so without one there is nothing to attribute the rest to.
 */
export interface AtlasUnusableEnvelopeError {
  readonly code: "UNUSABLE_ENVELOPE";
  readonly message: string;
  readonly path: string;
  readonly field: string;
}

/** An entity missing a field the table declares `notNull`, named so an operator can go and look. */
export interface AtlasMissingFieldError {
  readonly code: "MISSING_FIELD";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly field: string;
}

/**
 * A pre-`channels` entity whose channel cannot be named.
 *
 * Its own variant because it is the one failure this import was measured as NOT having: every
 * pre-`channels` row on the measured install names their channel in `source.channel` (cloudflare) or
 * `source.surface` (crowdstrike, aether, github), and zero name neither. A row that trips this is a shape
 * nobody has seen, so it is reported as its own kind rather than folded into a missing-field count.
 */
export interface AtlasUnnamedChannelError {
  readonly code: "UNNAMED_CHANNEL";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
}

/** An instant that is present and not readable. Never defaulted — a fabricated `firstSeenAt` is a lie. */
export interface AtlasUnreadableInstantError {
  readonly code: "UNREADABLE_INSTANT";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly field: string;
  readonly value: string;
}

/** The envelope names a platform that is not the directory it was read from. */
export interface AtlasPlatformMismatchError {
  readonly code: "PLATFORM_MISMATCH";
  readonly message: string;
  readonly path: string;
  readonly declared: string;
  readonly directory: string;
}

/** Everything this import can refuse. */
export type AtlasImportError =
  | AtlasMissingFieldError
  | AtlasPlatformMismatchError
  | AtlasUnnamedChannelError
  | AtlasUnreadableInstantError
  | AtlasUnreadableLineError
  | AtlasUnusableEnvelopeError;

/** Build one of {@link AtlasImportError}'s variants. The factory the real code calls, so tests call it too. */
export const AtlasImportErrors = {
  missingField: ({
    field,
    lineNumber,
    path,
  }: {
    field: string;
    lineNumber: number;
    path: string;
  }): AtlasMissingFieldError => ({
    code: "MISSING_FIELD",
    field,
    lineNumber,
    message: `${path} line ${String(lineNumber)} has no usable ${field}`,
    path,
  }),
  platformMismatch: ({
    declared,
    directory,
    path,
  }: {
    declared: string;
    directory: string;
    path: string;
  }): AtlasPlatformMismatchError => ({
    code: "PLATFORM_MISMATCH",
    declared,
    directory,
    message: `${path} declares platform ${declared} while sitting in the ${directory} directory`,
    path,
  }),
  unnamedChannel: ({ lineNumber, path }: { lineNumber: number; path: string }): AtlasUnnamedChannelError => ({
    code: "UNNAMED_CHANNEL",
    lineNumber,
    message:
      `${path} line ${String(lineNumber)} carries no channels map and names no channel in ` +
      "source.channel or source.surface, so there is nothing to attribute its view to",
    path,
  }),
  unreadableInstant: ({
    field,
    lineNumber,
    path,
    value,
  }: {
    field: string;
    lineNumber: number;
    path: string;
    value: string;
  }): AtlasUnreadableInstantError => ({
    code: "UNREADABLE_INSTANT",
    field,
    lineNumber,
    message: `${path} line ${String(lineNumber)} has an unreadable ${field}: ${value}`,
    path,
    value,
  }),
  unreadableLine: ({ lineNumber, path }: { lineNumber: number; path: string }): AtlasUnreadableLineError => ({
    code: "UNREADABLE_LINE",
    lineNumber,
    message: `${path} line ${String(lineNumber)} is not a JSON object`,
    path,
  }),
  unusableEnvelope: ({ field, path }: { field: string; path: string }): AtlasUnusableEnvelopeError => ({
    code: "UNUSABLE_ENVELOPE",
    field,
    message: `${path} line 1 is not a usable envelope — ${field}`,
    path,
  }),
} as const;
