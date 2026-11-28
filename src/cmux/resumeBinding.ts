/**
 * What cmux saved about the Claude session a surface last ran — read so the fleet can resume that session ITSELF,
 * on its own credential, instead of letting cmux relaunch it bare.
 *
 * ## Why the fleet reads this and never lets cmux act on it
 *
 * cmux's Claude hook records a `resume_binding` per surface and, with `terminal.autoResumeAgentSessions` on, runs
 * it on reopen. MEASURED (`cmux rpc surface.resume.get '{"workspace_id":"<id>"}'`): its environment
 * carries only `CLAUDE_SECURESTORAGE_CONFIG_DIR`, never the descriptor a setup-token seat boots on, and cmux's own
 * docs say sensitive environment keys are dropped before storage. So that relaunch leaves a token seat on its unbound
 * store without its token; a store seat's binding names its plan store, and its sign-in after that relaunch is
 * unmeasured. Every seat comes back in no order, the supervisor included; restoring through Slopweaver's own commands
 * is the accepted route. With the setting off (`fleet restore-policy --apply`) the panes come back as idle shells and
 * `fleet resume` reads the session id from here and relaunches it through `cmux reseat`'s line.
 *
 * ## Two records, read in order
 *
 * `resume_binding` is the hook's live record; `restore_record` (`source: session-snapshot`) is what cmux restored
 * the pane from. Both carry `checkpoint_id` (the Claude session id) and the seat's ORIGINAL argv
 * (`launch_command.arguments`). A tab that never ran Claude answers both `null` (measured on an idle tab).
 *
 * Pure but for {@link readResumeBindingOver}, the one socket call `CmuxClient.readResumeBinding` makes: a decoded
 * reply in, a binding out.
 */
import { isRecord } from "../lib/parsers.js";
import type { Result } from "../lib/result.js";
import type { CmuxError } from "./errors.js";
import type { CmuxCall } from "./workspaceAddresses.js";

/** One surface's saved Claude session, as cmux recorded it. */
export interface CmuxResumeBinding {
  /** The Claude session id cmux would have passed to `--resume`. */
  readonly checkpointId: string;
  /** The directory the session ran in, when cmux recorded one. */
  readonly cwd: string | undefined;
  /** The seat's original launch argv joined by spaces, when every element was a string. */
  readonly argv: string | undefined;
  /** Which record it came from. */
  readonly source: "resume_binding" | "restore_record";
}

/** A non-empty string field on a record, else `undefined`. */
function textField({ value, field }: { value: Record<string, unknown>; field: string }): string | undefined {
  const raw = value[field];
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  return raw;
}

/** The launch argv a record carries, joined, or `undefined` when it carries none or a non-string element. */
function launchArgv({ record }: { record: Record<string, unknown> }): string | undefined {
  const launch = record["launch_command"];
  if (!isRecord(launch) || !Array.isArray(launch["arguments"])) {
    return undefined;
  }
  const args: unknown[] = launch["arguments"];
  if (args.length === 0 || !args.every((arg) => typeof arg === "string")) {
    return undefined;
  }
  return args.join(" ");
}

/** One record decoded, or `undefined` when it is absent, not Claude's, or names no session. */
function bindingOf({
  value,
  source,
}: {
  value: unknown;
  source: CmuxResumeBinding["source"];
}): CmuxResumeBinding | undefined {
  if (!isRecord(value) || value["kind"] !== "claude") {
    return undefined;
  }
  const checkpointId = textField({ field: "checkpoint_id", value });
  if (checkpointId === undefined) {
    return undefined;
  }
  return { argv: launchArgv({ record: value }), checkpointId, cwd: cwdOf({ value }), source };
}

/** The record's working directory: its `cwd`, else its `working_directory`, else `undefined`. */
function cwdOf({ value }: { value: Record<string, unknown> }): string | undefined {
  const cwd = textField({ field: "cwd", value });
  if (cwd !== undefined) {
    return cwd;
  }
  return textField({ field: "working_directory", value });
}

/**
 * Decode a `surface.resume.get` reply into the Claude session it saved. A Codex or other agent's binding is never
 * read as Claude's, and the session id's shape is the planner's to check (`UNSAFE_SESSION_ID`).
 *
 * @param value the decoded reply
 * @returns the hook's binding, else the restore record's, else `undefined` when the surface saved no Claude session
 *   or its binding was cleared
 */
export function parseResumeBinding({ value }: { value: unknown }): CmuxResumeBinding | undefined {
  // `cleared: true` is cmux saying the binding was withdrawn (`surface resume clear`): nothing to resume.
  if (!isRecord(value) || value["cleared"] === true) {
    return undefined;
  }
  const live = bindingOf({ source: "resume_binding", value: value["resume_binding"] });
  if (live !== undefined) {
    return live;
  }
  return bindingOf({ source: "restore_record", value: value["restore_record"] });
}

/** `CmuxClient.readResumeBinding`'s shape: one workspace in, its saved Claude session (or none) out. */
export type ReadResumeBinding = (options: {
  workspaceId: string;
}) => Promise<Result<CmuxResumeBinding | undefined, CmuxError>>;

/**
 * `surface.resume.get` for one workspace, decoded by {@link parseResumeBinding}.
 *
 * @param call the client's socket call
 * @returns the reader `CmuxClient.readResumeBinding` is
 */
export function readResumeBindingOver({ call }: { call: CmuxCall }): ReadResumeBinding {
  return async ({ workspaceId }) =>
    (await call({ method: "surface.resume.get", params: { workspace_id: workspaceId } })).map((value) =>
      parseResumeBinding({ value }),
    );
}
