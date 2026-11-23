/**
 * The sidebar row decorations — the one part of cmux with NO socket method, so the one part still shelled.
 *
 * MEASURED against cmux 0.64.22, and worth stating precisely because "wrap the socket, not the CLI" would
 * otherwise read as an unfinished job here:
 *
 * - `cmux capabilities` lists 303 v2 methods. Not one of them names a status pill.
 * - `extension.sidebar.snapshot` DOES exist and is a real socket read, but its workspace rows carry no pill
 *   field at all — verified by writing one through the CLI and re-reading the snapshot.
 *
 * So these go through the `cmux` binary. The process boundary is real and is not pretended away; what this
 * module buys is that no caller anywhere else in the repository composes a `cmux` argv by hand, which is what
 * rule 3 ("one door") is actually protecting.
 *
 * ## Identity only — no checklist, no status lane, no progress bar
 *
 * What a row carries is who it is: its title, its role colour and its `workspace:N` ref pill. Nothing here
 * writes the row's checklist, status lane or progress bar. The owner reads none of
 * them, so a seat's state reaches the owner only as a Queue card or a floating note.
 */
import { execFileSync } from "node:child_process";

import { isRecord } from "../lib/parsers.js";
import { trackEffect } from "../lib/pendingEffects.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { cliFailureOutcome, liveInsideRecorder } from "./insideCalls.js";

/** How long any one `cmux` invocation may block. */
const SIDEBAR_TIMEOUT_MS = 10_000;

/**
 * The status-pill key a workspace's own `workspace:N` ref is published under.
 *
 * `set-status` keys an entry so that "different tools (e.g. `claude_code`, `build`) can manage their own" —
 * Claude Code itself already writes a `claude_code` pill, so this one has its own key and republishing it
 * REPLACES rather than accumulates. The key is never rendered; only the value is (measured).
 */
export const WORKSPACE_REF_STATUS_KEY = "ws";

/** The SF Symbol shown beside the ref pill. */
export const WORKSPACE_REF_STATUS_ICON = "number";

/**
 * Sort priority for the ref pill — higher appears first, and cmux renders one pill per line in a sidebar this
 * narrow (measured), so this is the difference between the ref being the first thing under the title and it
 * being pushed below whatever else a tool publishes.
 */
export const WORKSPACE_REF_STATUS_PRIORITY = 100;

/** The seam the sidebar family runs through, so its argv is assertable without a running cmux. */
export interface CmuxCli {
  /**
   * Run one `cmux` invocation.
   *
   * @param argv the arguments after `cmux` itself
   * @returns the raw stdout
   */
  readonly run: (options: { argv: readonly string[] }) => Result<string, CmuxError>;
}

/**
 * The subcommand a failed `cmux` run names in its error. An empty argv runs bare `cmux`, which names no
 * subcommand at all, so the error says that rather than naming one.
 */
function failedSubcommand({ argv }: { argv: readonly string[] }): string {
  const subcommand = argv[0];
  if (subcommand === undefined) {
    return "(no subcommand)";
  }
  return subcommand;
}

/**
 * The real `cmux` binary, invoked with an argv array — no shell string, so there is nothing to quote.
 *
 * @returns the production {@link CmuxCli}
 */
export function realCmuxCli(): CmuxCli {
  // Every run is evidence for `cmux revive` when this process is a seat: a printed answer, or a timeout.
  const record = liveInsideRecorder();
  return {
    run: ({ argv }) => {
      try {
        const stdout = execFileSync("cmux", [...argv], { encoding: "utf8", timeout: SIDEBAR_TIMEOUT_MS });
        if (record !== undefined) {
          trackEffect({ effect: record({ outcome: "answered" }) });
        }
        return ok(stdout);
      } catch (error) {
        const outcome = cliFailureOutcome({ error });
        // The contract is synchronous, so the dialog decline's journal write is held for the process exit instead.
        if (outcome !== undefined && record !== undefined) {
          trackEffect({ effect: record({ outcome }) });
        }
        return err(
          CmuxErrors.callFailed({
            cmuxCode: "cli_failed",
            message: error instanceof Error ? error.message : String(error),
            method: `cmux ${failedSubcommand({ argv })}`,
          }),
        );
      }
    },
  };
}

/** `--workspace <ref>` when one was named, nothing when the caller means its own workspace. */
function workspaceFlag({ workspaceRef }: { workspaceRef: string | undefined }): readonly string[] {
  return workspaceRef === undefined ? [] : ["--workspace", workspaceRef];
}

/** One row's two titles, which is what deciding whether it reads as bare needs. */
interface WorkspaceTitles {
  readonly ref: string;
  readonly workspaceId: string;
  readonly currentDirectory: string;
  readonly renderedTitle: string;
  readonly customTitle: string | undefined;
  readonly hasCustomTitle: boolean;
}

/**
 * Read every workspace's rendered title alongside its custom one.
 *
 * `workspace list --json` is the only surface that reports both. `sidebar-state` carries no title at all,
 * and the rendered `title` alone cannot answer the question this exists for, because once a custom title is
 * set the two are equal and the pane's own title is no longer visible from anywhere.
 *
 * @param cli the cmux seam
 * @returns one entry per workspace in the caller's window, or the typed failure
 */
export function readWorkspaceTitles({ cli }: { cli: CmuxCli }): Result<readonly WorkspaceTitles[], CmuxError> {
  return cli
    .run({ argv: ["workspace", "list", "--json"] })
    .andThen((stdout) => parseJsonStdout({ method: "cmux workspace list", stdout }))
    .map((value) => rowsOf({ value }).map((row) => titlesOf({ row })));
}

/**
 * The workspace rows out of a decoded `workspace list --json` reply.
 *
 * The reply is an OBJECT — `{ window_ref, workspaces }` — not the bare array it would be natural to assume,
 * and assuming wrongly here is silent: the repair would find no rows, report no error and do nothing on every
 * single run, which is indistinguishable from a fleet that never goes bare. Measured against the real binary
 * rather than inferred. A bare array is still accepted, so a future shape change degrades to
 * working rather than to quietly inert.
 *
 * @param value the decoded reply
 * @returns the rows, or none when the reply carries no recognisable list
 */
function rowsOf({ value }: { value: unknown }): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const nested = isRecord(value) ? value["workspaces"] : undefined;
  return Array.isArray(nested) ? nested : [];
}

/**
 * One {@link WorkspaceTitles} off a decoded `workspace list --json` row.
 *
 * `has_custom_title` is read rather than derived from `custom_title != null`, because cmux reports both and a
 * derived answer would silently disagree with it the day one of them changes shape.
 *
 * @param row one decoded row
 * @returns its refs, its working directory and both titles
 */
function titlesOf({ row }: { row: unknown }): WorkspaceTitles {
  return {
    currentDirectory: stringOr({ fallback: "", field: "current_directory", value: row }),
    customTitle: optionalStringField({ field: "custom_title", value: row }),
    hasCustomTitle: isRecord(row) && row["has_custom_title"] === true,
    renderedTitle: stringOr({ fallback: "", field: "title", value: row }),
    ref: stringOr({ fallback: "", field: "ref", value: row }),
    workspaceId: stringOr({ fallback: "", field: "id", value: row }),
  };
}

/**
 * Set a workspace's custom title, which is the one field a terminal pane cannot overwrite.
 *
 * Deliberately narrow: `./title.ts` decides WHETHER to call this, and it says yes only for a row that would
 * otherwise render as a host's generic default. Pinning a title unconditionally would throw away the pane
 * titles Claude Code writes from the task it is on, which are the best titles on the sidebar.
 *
 * @param cli the cmux seam
 * @param title the title to pin
 * @param workspaceRef the workspace to rename, defaulting to the caller's own
 * @returns nothing on success, or the typed failure
 */
export function setWorkspaceTitle({
  cli,
  title,
  workspaceRef,
}: {
  cli: CmuxCli;
  title: string;
  workspaceRef?: string;
}): Result<void, CmuxError> {
  return cli
    .run({ argv: ["workspace-action", "--action", "rename", "--title", title, ...workspaceFlag({ workspaceRef })] })
    .map(() => undefined);
}

/**
 * Publish one custom metadata pill onto a workspace's sidebar row.
 *
 * The pill row is the only per-workspace field cmux exposes that a tool may name for itself: the title and
 * description each have exactly one meaning and one writer, so anything else worth showing goes here. `sidebar.showCustomMetadata` (default
 * `true`) is the one setting that hides these, and it hides every tool's pills together, not just ours.
 *
 * @param cli the cmux seam
 * @param key the pill's key, unique per publishing tool — republishing the same key replaces that pill
 * @param value the text the pill renders; the key itself is never shown
 * @param icon the SF Symbol shown beside the value, or `undefined` for none
 * @param priority sort priority among the row's pills, higher first, or `undefined` for cmux's default of 0
 * @param workspaceRef the workspace to publish to, defaulting to the caller's own
 * @returns nothing on success, or the typed failure
 */
export function setStatusPill({
  cli,
  key,
  value,
  icon,
  priority,
  workspaceRef,
}: {
  cli: CmuxCli;
  key: string;
  value: string;
  icon?: string;
  priority?: number;
  workspaceRef?: string;
}): Result<void, CmuxError> {
  return cli
    .run({
      argv: [
        "set-status",
        key,
        value,
        ...(icon === undefined ? [] : ["--icon", icon]),
        ...(priority === undefined ? [] : ["--priority", String(priority)]),
        ...workspaceFlag({ workspaceRef }),
      ],
    })
    .map(() => undefined);
}

/**
 * Paint one workspace's row colour, or strip it.
 *
 * The colour means the session's ROLE — see `./role.ts` for the mapping and why the majority role wears
 * none. `undefined` is a real instruction here rather than a no-op: it clears any colour the row already
 * had, so a workspace reused for different work never keeps a stale role from the last one.
 *
 * cmux renders the colour according to the global `workspaceColors.indicatorStyle`, which is the owner's
 * setting and not this function's business. Measured on cmux 0.64.22: of its nine style names
 * only three are distinct looks — `wash`, `solidFill`, `border`, `typography` and `lift` came back
 * pixel-identical to one another.
 *
 * @param cli the cmux seam
 * @param colour a cmux named colour, or `undefined` to leave the row plain
 * @param workspaceRef the workspace to paint, defaulting to the caller's own
 * @returns nothing on success, or the typed failure
 */
export function setWorkspaceColour({
  cli,
  colour,
  workspaceRef,
}: {
  cli: CmuxCli;
  colour: string | undefined;
  workspaceRef?: string;
}): Result<void, CmuxError> {
  return cli
    .run({
      argv:
        colour === undefined
          ? ["workspace-action", "--action", "clear-color", ...workspaceFlag({ workspaceRef })]
          : ["workspace-action", "--action", "set-color", "--color", colour, ...workspaceFlag({ workspaceRef })],
    })
    .map(() => undefined);
}

/**
 * The `workspace:N` ref of the workspace this process is running inside.
 *
 * `cmux identify --json` reports the CALLER'S refs alongside the focused window's, and the two differ every
 * time a session publishes while the owner is looking at another row — which is nearly always. Reading
 * `focused` here would label every sidebar row with whichever workspace happened to be selected.
 *
 * @param cli the cmux seam
 * @returns the caller's own workspace ref, or the typed failure
 */
export function readCallerWorkspaceRef({ cli }: { cli: CmuxCli }): Result<string, CmuxError> {
  return cli
    .run({ argv: ["identify", "--json"] })
    .andThen((stdout) => parseJsonStdout({ method: "cmux identify", stdout }))
    .andThen((value) => {
      const caller = isRecord(value) ? value["caller"] : undefined;
      const ref = isRecord(caller) ? caller["workspace_ref"] : undefined;
      return typeof ref === "string" && ref.length > 0
        ? ok(ref)
        : err(CmuxErrors.malformedReply({ detail: "no caller.workspace_ref", method: "cmux identify" }));
    });
}

/** Decode a `--json` stdout, or fail with a typed malformed-reply error. */
function parseJsonStdout({ stdout, method }: { stdout: string; method: string }): Result<unknown, CmuxError> {
  try {
    return ok(JSON.parse(stdout));
  } catch {
    return err(CmuxErrors.malformedReply({ detail: "stdout was not JSON", method }));
  }
}

/** One string field off a decoded reply, with a fallback. */
function stringOr({ value, field, fallback }: { value: unknown; field: string; fallback: string }): string {
  return isRecord(value) && typeof value[field] === "string" ? value[field] : fallback;
}

/** One string field off a decoded reply, or `undefined` — cmux sends `null` for an unset override. */
function optionalStringField({ value, field }: { value: unknown; field: string }): string | undefined {
  return isRecord(value) && typeof value[field] === "string" ? value[field] : undefined;
}
