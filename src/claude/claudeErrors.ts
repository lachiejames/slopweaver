/**
 * The Claude directory's typed failures outside its narrower domains — the drawdown journal and the
 * investigation it opens, a re-enrollment refusal, and a keep-alive record that cannot be read.
 *
 * Rotation keeps `ClaudeRotationError` (`./errors.ts`) and minting keeps `MintError` (`./mintErrors.ts`); this
 * union covers what neither of them does and absorbs neither. A list of problems — every reason a
 * re-enrollment was refused — rides as `reasons`, and `claudeErrorLines` prints it one line each, as the
 * `readonly string[]` it replaced did.
 */

/** A drawdown journal line whose JSON does not parse, or parses to something other than an object. */
export interface ClaudeDrawdownLineUnreadableError {
  readonly code: "DRAWDOWN_LINE_UNREADABLE";
  readonly message: string;
  readonly problem: "not-json" | "not-object";
}

/** A drawdown journal line names a `kind` this reader has no parser for. */
export interface ClaudeDrawdownKindUnknownError {
  readonly code: "DRAWDOWN_KIND_UNKNOWN";
  readonly message: string;
  readonly kind: string | undefined;
}

/** A drawdown journal line of a known `lineKind` is missing, or holds a bad value for, `field`. */
export interface ClaudeDrawdownFieldInvalidError {
  readonly code: "DRAWDOWN_FIELD_INVALID";
  readonly message: string;
  readonly lineKind: string;
  readonly field: string;
}

/** The drawdown journal exists and could not be read, or could not be appended to. */
export interface ClaudeDrawdownJournalFailedError {
  readonly code: "DRAWDOWN_JOURNAL_FAILED";
  readonly message: string;
  readonly operation: "read" | "append";
  readonly detail: string;
}

/** The investigation's workspace came up, or half came up, and then failed; `workspaceRef` is the one to close. */
export interface ClaudeDrawdownInvestigationFailedError {
  readonly code: "DRAWDOWN_INVESTIGATION_FAILED";
  readonly message: string;
  readonly reason: string;
  readonly workspaceRef: string;
}

/** The investigation could not be spawned at all. */
export interface ClaudeDrawdownSpawnFailedError {
  readonly code: "DRAWDOWN_SPAWN_FAILED";
  readonly message: string;
  readonly detail: string;
}

/** A re-enrollment named no store, or named one more than once; `aliases` is what was repeated. */
export interface ClaudeReenrollTargetInvalidError {
  readonly code: "REENROLL_TARGET_INVALID";
  readonly message: string;
  readonly aliases: readonly string[];
}

/** A re-enrollment refused for every reason in `reasons` — a store with no standing row, a collision. */
export interface ClaudeReenrollRefusedError {
  readonly code: "REENROLL_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The keep-alive record exists and cannot be read; `field` is the first thing wrong with it. */
export interface ClaudeWatchSessionInvalidError {
  readonly code: "WATCH_SESSION_INVALID";
  readonly message: string;
  readonly field: WatchSessionField;
}

/** The part of a keep-alive record found wrong — `record` when it is not an object at all. */
export type WatchSessionField =
  "record" | "watchId" | "pid" | "cwd" | "startedAtIso" | "lastTickStartedAtIso" | "intervalMs";

/** Every failure this union covers. */
export type ClaudeError =
  | ClaudeDrawdownLineUnreadableError
  | ClaudeDrawdownKindUnknownError
  | ClaudeDrawdownFieldInvalidError
  | ClaudeDrawdownJournalFailedError
  | ClaudeDrawdownInvestigationFailedError
  | ClaudeDrawdownSpawnFailedError
  | ClaudeReenrollTargetInvalidError
  | ClaudeReenrollRefusedError
  | ClaudeWatchSessionInvalidError;

/** What each keep-alive field's refusal says, so the reader's order and its wording cannot drift apart. */
const WATCH_SESSION_MESSAGES: Readonly<Record<WatchSessionField, string>> = {
  cwd: "`cwd` is missing or empty, so the tree the loop runs cannot be measured",
  intervalMs: "`intervalMs` is not a positive number, so the staleness deadline would be vacuous",
  lastTickStartedAtIso: "`lastTickStartedAtIso` is not a date, so tick freshness cannot be judged",
  pid: "`pid` is not a positive integer, so no process can be looked up",
  record: "the keep-alive record is not an object, so nothing about the loop can be read from it",
  startedAtIso: "`startedAtIso` is not a date",
  watchId: "`watchId` is missing or empty",
};

/** The investigation fields a refusal names as the line's OWN ("missing its incidentId"), as it always has. */
const OWNED_FIELDS: ReadonlySet<string> = new Set(["incidentId", "workspaceRef"]);

/** One drawdown field refusal. */
function fieldInvalid({
  lineKind,
  field,
  message,
}: {
  lineKind: string;
  field: string;
  message: string;
}): ClaudeDrawdownFieldInvalidError {
  return { code: "DRAWDOWN_FIELD_INVALID", field, lineKind, message };
}

/** How to raise one, so the real code and a test build each the same way. */
export const ClaudeErrors = {
  drawdownAppendFailed: ({ detail }: { detail: string }): ClaudeDrawdownJournalFailedError => ({
    code: "DRAWDOWN_JOURNAL_FAILED",
    detail,
    message: `the drawdown journal could not be appended to: ${detail}`,
    operation: "append",
  }),
  drawdownFieldMissing: ({ lineKind, field }: { lineKind: string; field: string }): ClaudeDrawdownFieldInvalidError => {
    const its = OWNED_FIELDS.has(field) ? "its " : "";
    return fieldInvalid({ field, lineKind, message: `an ${lineKind} line is missing ${its}${field}` });
  },
  drawdownInvestigationFailed: ({
    reason,
    workspaceRef,
  }: {
    reason: string;
    workspaceRef: string;
  }): ClaudeDrawdownInvestigationFailedError => ({
    code: "DRAWDOWN_INVESTIGATION_FAILED",
    message: `${reason} (workspace ${workspaceRef})`,
    reason,
    workspaceRef,
  }),
  drawdownKindUnknown: ({ kind }: { kind: string | undefined }): ClaudeDrawdownKindUnknownError => ({
    code: "DRAWDOWN_KIND_UNKNOWN",
    kind,
    message: `a journal line names an unknown kind: ${String(kind)}`,
  }),
  drawdownLineNotJson: (): ClaudeDrawdownLineUnreadableError => ({
    code: "DRAWDOWN_LINE_UNREADABLE",
    message: "a journal line is not readable JSON",
    problem: "not-json",
  }),
  drawdownLineNotObject: (): ClaudeDrawdownLineUnreadableError => ({
    code: "DRAWDOWN_LINE_UNREADABLE",
    message: "a journal line does not hold an object",
    problem: "not-object",
  }),
  drawdownReadFailed: ({ detail }: { detail: string }): ClaudeDrawdownJournalFailedError => ({
    code: "DRAWDOWN_JOURNAL_FAILED",
    detail,
    message: `the drawdown journal could not be read: ${detail}`,
    operation: "read",
  }),
  drawdownSampleFieldsMissing: (): ClaudeDrawdownFieldInvalidError =>
    fieldInvalid({
      field: "planAlias/observedAtIso/resetAtIso",
      lineKind: "sample",
      message: "a sample line is missing planAlias, observedAtIso or resetAtIso",
    }),
  drawdownSampleInstantInvalid: ({
    field,
  }: {
    field: "observedAtIso" | "resetAtIso";
  }): ClaudeDrawdownFieldInvalidError =>
    fieldInvalid({
      field,
      lineKind: "sample",
      message: `a sample line's ${field} is not one ISO-8601 instant`,
    }),
  drawdownSampleUtilizationInvalid: (): ClaudeDrawdownFieldInvalidError =>
    fieldInvalid({
      field: "utilization",
      lineKind: "sample",
      message: "a sample line's utilization is not a finite number",
    }),
  drawdownSampleWindowUnknown: ({ window }: { window: string | undefined }): ClaudeDrawdownFieldInvalidError =>
    fieldInvalid({
      field: "window",
      lineKind: "sample",
      message: `a sample line names an unknown window: ${String(window)}`,
    }),
  drawdownSpawnFailed: ({ detail }: { detail: string }): ClaudeDrawdownSpawnFailedError => ({
    code: "DRAWDOWN_SPAWN_FAILED",
    detail,
    message: `the investigation could not be spawned: ${detail}`,
  }),
  reenrollNothingNamed: (): ClaudeReenrollTargetInvalidError => ({
    aliases: [],
    code: "REENROLL_TARGET_INVALID",
    message: "NOT RE-ENROLLED — no store was named",
  }),
  reenrollRefused: ({ reasons }: { reasons: readonly string[] }): ClaudeReenrollRefusedError => ({
    code: "REENROLL_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  reenrollRepeated: ({ aliases }: { aliases: readonly string[] }): ClaudeReenrollTargetInvalidError => ({
    aliases,
    code: "REENROLL_TARGET_INVALID",
    message: `NOT RE-ENROLLED — ${aliases.join(", ")} named more than once`,
  }),
  watchSessionInvalid: ({ field }: { field: WatchSessionField }): ClaudeWatchSessionInvalidError => ({
    code: "WATCH_SESSION_INVALID",
    field,
    message: WATCH_SESSION_MESSAGES[field],
  }),
} as const;

/**
 * The lines a {@link ClaudeError} prints, one per problem. A re-enrollment refusal gives each reason its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function claudeErrorLines({ error }: { error: ClaudeError }): readonly string[] {
  if (error.code === "REENROLL_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
