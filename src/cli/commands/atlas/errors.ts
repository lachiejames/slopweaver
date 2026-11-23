/**
 * The typed failures the `slopweaver atlas` verb family authors at its top level — a flag that did not
 * parse, a number out of range, a confirmation word left off or mistyped, and the Slack API and driven-surface
 * inputs that could not be read or will not publish.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/cli/commands/atlas/` itself; the
 * per-platform subdirectories keep their own. A variant carrying `reasons` keeps one line per problem, and
 * {@link atlasCommandErrorLines} is how a verb prints them: every runner here writes one line per entry,
 * exactly as the `readonly string[]` it replaced did.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A failure reading one file, carrying what the read threw. */
interface Unreadable<C extends string> extends Plain<C> {
  readonly path: string;
  readonly cause: unknown;
}

/** Every failure an `atlas` verb authors at the top of the noun. */
export type AtlasCommandError =
  | Listed<"FLAGS_INVALID">
  | (Plain<"INTEGER_FLAG_INVALID"> & { readonly name: string; readonly min: number; readonly raw: string })
  | (Plain<"BACKLOG_GROUND_INVALID"> & { readonly ground: string; readonly allowed: readonly string[] })
  | (Plain<"DOCTOR_MULTIPLE_PLATFORMS"> & { readonly platforms: readonly string[] })
  | (Plain<"READ_LIMIT_INVALID"> & { readonly raw: string; readonly min: number; readonly max: number })
  | Plain<"RESTORE_CONFIRM_WITHOUT_ARCHIVE">
  | Plain<"RESTORE_CONFIRM_REQUIRED">
  | Plain<"RESET_CONFIRM_REQUIRED">
  | (Plain<"RESET_EMPTY_CONFIRM_REQUIRED"> & { readonly word: string })
  | (Plain<"CONFIRM_MISMATCH"> & { readonly expected: string; readonly confirm: string })
  | Plain<"SLACK_API_TERM_EMPTY">
  | Plain<"SLACK_API_HAR_PATH_EMPTY">
  | (Plain<"SDK_TYPINGS_UNREADABLE"> & { readonly cause: unknown })
  | Unreadable<"CAPTURE_UNREADABLE">
  | (Plain<"SLACK_DRIVE_VERB_UNKNOWN"> & { readonly verb: string })
  | Plain<"SLACK_DRIVE_SESSION_MISUSED">
  | Listed<"SDK_TYPINGS_UNAVAILABLE">
  | Listed<"WALK_DOCUMENT_INVALID">
  | Plain<"SLACK_WORKSPACE_UNDECLARED">
  | Unreadable<"WALK_DOCUMENT_UNREADABLE">
  | Unreadable<"SCREENSHOT_UNREADABLE">
  | Listed<"ARTIFACT_WRITE_FAILED">
  | Plain<"LINEAR_BROWSER_TOKEN_MISSING">
  | (Plain<"CHROME_PIN_UNRESOLVED"> & { readonly detail: string })
  | Listed<"LINEAR_PLAN_INVALID">
  | Plain<"LINEAR_LIMIT_INVALID">
  | Plain<"LINEAR_API_KEY_MISSING">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** What a caught read threw, in the words these verbs have always printed it. */
function thrown({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const AtlasCommandErrors = {
  artifactWriteFailed: ({ reasons }: { reasons: readonly string[] }): AtlasCommandError =>
    listed({ code: "ARTIFACT_WRITE_FAILED", reasons }),
  backlogGroundInvalid: ({ allowed, ground }: { allowed: readonly string[]; ground: string }): AtlasCommandError => ({
    allowed,
    code: "BACKLOG_GROUND_INVALID",
    ground,
    message: `--ground must be one of: ${allowed.join(", ")} — the gate refuses no other`,
  }),
  captureUnreadable: ({ cause, path }: { cause: unknown; path: string }): AtlasCommandError => ({
    cause,
    code: "CAPTURE_UNREADABLE",
    message: `cannot read the capture at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  chromePinUnresolved: ({ detail }: { detail: string }): AtlasCommandError => ({
    code: "CHROME_PIN_UNRESOLVED",
    detail,
    message: detail,
  }),
  confirmMismatch: ({ confirm, expected }: { confirm: string; expected: string }): AtlasCommandError => ({
    code: "CONFIRM_MISMATCH",
    confirm,
    expected,
    message: `--confirm must be exactly "${expected}", not "${confirm}"`,
  }),
  doctorMultiplePlatforms: ({ platforms }: { platforms: readonly string[] }): AtlasCommandError => ({
    code: "DOCTOR_MULTIPLE_PLATFORMS",
    message: `name at most one platform — got: ${platforms.join(", ")}`,
    platforms,
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): AtlasCommandError =>
    listed({ code: "FLAGS_INVALID", reasons }),
  integerFlagInvalid: ({ min, name, raw }: { min: number; name: string; raw: string }): AtlasCommandError => ({
    code: "INTEGER_FLAG_INVALID",
    message: `--${name} takes a whole number of ${String(min)} or more, not "${raw}"`,
    min,
    name,
    raw,
  }),
  linearApiKeyMissing: (): AtlasCommandError => ({
    code: "LINEAR_API_KEY_MISSING",
    message: "no Linear API key is configured — run: slopweaver secrets set linear-token",
  }),
  linearBrowserTokenMissing: (): AtlasCommandError => ({
    code: "LINEAR_BROWSER_TOKEN_MISSING",
    message:
      "no Playwright Extension consent token is configured, so the owner's own Chrome cannot be reached — write one to $SLOPWEAVER_HOME/secrets/playwright-extension-token",
  }),
  linearLimitInvalid: (): AtlasCommandError => ({
    code: "LINEAR_LIMIT_INVALID",
    message: "--limit takes a positive integer",
  }),
  linearPlanInvalid: ({ problems, usage }: { problems: readonly string[]; usage: string }): AtlasCommandError =>
    listed({ code: "LINEAR_PLAN_INVALID", reasons: [...problems, usage] }),
  readLimitInvalid: ({ max, min, raw }: { max: number; min: number; raw: string }): AtlasCommandError => ({
    code: "READ_LIMIT_INVALID",
    max,
    message: `--limit must be a whole number from ${String(min)} to ${String(max)}, got: ${raw}`,
    min,
    raw,
  }),
  resetConfirmRequired: (): AtlasCommandError => ({
    code: "RESET_CONFIRM_REQUIRED",
    message:
      "reset is a HARD reset: it archives the current generation and installs an empty one in its place. Re-run with --confirm archive; the success line prints the exact command that restores what it archived, before any sync is needed",
  }),
  resetEmptyConfirmRequired: ({ word }: { word: string }): AtlasCommandError => ({
    code: "RESET_EMPTY_CONFIRM_REQUIRED",
    message: `reset needs --confirm ${word}: it replaces the current generation with an empty one`,
    word,
  }),
  restoreConfirmRequired: (): AtlasCommandError => ({
    code: "RESTORE_CONFIRM_REQUIRED",
    message:
      "restore needs --confirm archive-current: it archives the generation that is live now and installs the named one in its place",
  }),
  restoreConfirmWithoutArchive: (): AtlasCommandError => ({
    code: "RESTORE_CONFIRM_WITHOUT_ARCHIVE",
    message: "--confirm names an archive to install, so it needs --archive <archive-id> beside it",
  }),
  screenshotUnreadable: ({ cause, path }: { cause: unknown; path: string }): AtlasCommandError => ({
    cause,
    code: "SCREENSHOT_UNREADABLE",
    message: `could not read the screenshot for ${path}: ${thrown({ cause })}`,
    path,
  }),
  sdkTypingsUnavailable: ({ problems }: { problems: readonly string[] }): AtlasCommandError =>
    listed({
      code: "SDK_TYPINGS_UNAVAILABLE",
      reasons: [
        ...problems,
        "run `yarn install` — the API surface is read from the installed SDK, never a stored list",
      ],
    }),
  sdkTypingsUnreadable: ({ cause }: { cause: unknown }): AtlasCommandError => ({
    cause,
    code: "SDK_TYPINGS_UNREADABLE",
    message: `cannot read the installed @slack/web-api typings: ${errorMessage({ error: cause })}`,
  }),
  slackApiHarPathEmpty: (): AtlasCommandError => ({
    code: "SLACK_API_HAR_PATH_EMPTY",
    message: "--from-har needs the path to a .har capture",
  }),
  slackApiTermEmpty: (): AtlasCommandError => ({
    code: "SLACK_API_TERM_EMPTY",
    message: "--method and --field need a term; pass one or drop the flag",
  }),
  slackDriveSessionMisused: (): AtlasCommandError => ({
    code: "SLACK_DRIVE_SESSION_MISUSED",
    message:
      "`slack-drive sync` needs --session <path>, the walk document `slack-drive plan` briefed, and " +
      "`slack-drive refresh` reads no walk document at all — it is the unattended half",
  }),
  slackDriveVerbUnknown: ({ verb }: { verb: string }): AtlasCommandError => ({
    code: "SLACK_DRIVE_VERB_UNKNOWN",
    message: `unknown sub-verb ${verb} — this verb takes plan, sync, refresh or report`,
    verb,
  }),
  slackWorkspaceUndeclared: (): AtlasCommandError => ({
    code: "SLACK_WORKSPACE_UNDECLARED",
    message:
      "no Slack `org` structure row carries a workspace URL, so the declared surface map has no addresses to" +
      " publish — run `slopweaver refresh --source slack` first",
  }),
  walkDocumentInvalid: ({ problems }: { problems: readonly string[] }): AtlasCommandError =>
    listed({
      code: "WALK_DOCUMENT_INVALID",
      reasons: [...problems, "nothing was published — a surface is not filled by a document that will not parse"],
    }),
  walkDocumentUnreadable: ({ cause, path }: { cause: unknown; path: string }): AtlasCommandError => ({
    cause,
    code: "WALK_DOCUMENT_UNREADABLE",
    message: `${path} could not be read: ${thrown({ cause })}`,
    path,
  }),
} as const;

/**
 * The lines an {@link AtlasCommandError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function atlasCommandErrorLines({ error }: { error: AtlasCommandError }): readonly string[] {
  if (
    error.code === "FLAGS_INVALID" ||
    error.code === "SDK_TYPINGS_UNAVAILABLE" ||
    error.code === "WALK_DOCUMENT_INVALID" ||
    error.code === "ARTIFACT_WRITE_FAILED" ||
    error.code === "LINEAR_PLAN_INVALID"
  ) {
    return error.reasons;
  }
  return [error.message];
}
