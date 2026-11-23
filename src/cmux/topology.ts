/**
 * Every workspace and every surface process the cmux app holds, off ONE `system.top` reply — read whole or not at all.
 *
 * `listWorkspacesStrict` (`./strictInventory.ts`) is whole per reply, but it lists each window in its own call, so a
 * workspace moved between windows during that fan-out can be in neither reply. That is harmless to a caller looking
 * for something PRESENT; it is fatal to one concluding a workspace is ABSENT. `system.top` answers every window in a
 * single reply, so absence read from it is absence at one instant. MEASURED on one window and 12
 * workspaces, every row carrying `ref`:
 * `SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"include_processes":true}' --json | jq -c '[.windows[]?.workspaces[]? | .ref]'`.
 *
 * The processes ride the same reply, so "which pids run inside some surface" and "which workspaces exist" describe
 * the same instant too. A reply with no workspace at all is refused: the caller of this read runs inside one.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxProcess } from "./client.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { workspaceSurfaceProcesses } from "./processTree.js";

/** What one `system.top` reply says exists. */
export interface CmuxTopology {
  /** Every workspace ref, across every window. */
  readonly workspaceRefs: readonly string[];
  /** Every pid any surface's process tree holds, children included. */
  readonly surfacePids: readonly number[];
}

/** A required array-valued field, or `undefined` when the value is not a record or the field is not an array. */
function requiredArray({ value, field }: { value: unknown; field: string }): readonly unknown[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value[field];
  return Array.isArray(raw) ? raw : undefined;
}

/** Every pid in a process forest, depth first. */
function pidsOf({ roots }: { roots: readonly CmuxProcess[] }): number[] {
  return roots.flatMap((root) => [root.pid, ...pidsOf({ roots: root.children })]);
}

/** The refusal every malformed part of a reply shares, naming the part. */
function malformed({ detail }: { detail: string }): CmuxError {
  return CmuxErrors.malformedReply({ detail, method: "system.top" });
}

/** A ref the app hands out: `workspace:<index>`, nothing else (`./client.ts`). */
const WORKSPACE_REF = /^workspace:\d+$/u;

/**
 * One workspace row's ref and every pid its surfaces hold, or why the row will not decode. A ref of any other shape,
 * or a pid that is not a positive whole number, is a reply this read cannot trust absence off.
 */
function workspaceRow({ row }: { row: unknown }): Result<{ ref: string; pids: number[] }, CmuxError> {
  const ref = isRecord(row) ? row["ref"] : undefined;
  if (typeof ref !== "string" || !WORKSPACE_REF.test(ref)) {
    return err(malformed({ detail: "a workspace row carries no workspace:<n> ref" }));
  }
  const roots = workspaceSurfaceProcesses({ workspace: row });
  const pids = roots === undefined ? undefined : pidsOf({ roots });
  if (pids === undefined || !pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)) {
    return err(malformed({ detail: `a pane, surface, process or child in ${ref} would not decode` }));
  }
  return ok({ pids, ref });
}

/**
 * Decode one `system.top` reply into the workspaces and surface pids it holds.
 *
 * @param value the decoded reply
 * @returns every ref and pid, or `MALFORMED_REPLY` when any window, workspace row, ref or process tree will not
 *   decode, or the reply holds no workspace at all
 */
export function parseTopology({ value }: { value: unknown }): Result<CmuxTopology, CmuxError> {
  const windows = requiredArray({ field: "windows", value });
  if (windows === undefined) {
    return err(malformed({ detail: "the reply carries no windows list" }));
  }
  const workspaceRefs: string[] = [];
  const surfacePids: number[] = [];
  for (const window of windows) {
    const workspaces = requiredArray({ field: "workspaces", value: window });
    if (workspaces === undefined) {
      return err(malformed({ detail: "a window carries no workspaces list" }));
    }
    for (const row of workspaces) {
      const decoded = workspaceRow({ row });
      if (decoded.isErr()) {
        return err(decoded.error);
      }
      workspaceRefs.push(decoded.value.ref);
      surfacePids.push(...decoded.value.pids);
    }
  }
  if (workspaceRefs.length === 0) {
    return err(malformed({ detail: "the reply lists no workspace, though the caller runs inside one" }));
  }
  return ok({ surfacePids, workspaceRefs });
}
