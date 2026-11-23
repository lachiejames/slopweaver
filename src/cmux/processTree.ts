/**
 * The process trees a `system.top` reply attributes to a workspace — read whole or not at all.
 *
 * A tree read short is read wrong: the cold-seat judgement (`../sessions/coldSeat.ts`) types a resume line only into a
 * tab that is exactly one childless shell, so a dropped child or a container read as empty would make a shell with a
 * `claude` under it look like a bare prompt. Every part of a matched workspace must decode, or the
 * read is `MALFORMED_REPLY`.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxProcess } from "./client.js";
import { type CmuxError, CmuxErrors } from "./errors.js";
import { optionalString } from "./replyFields.js";

/** What a process with no name cmux could read is called, so the pid is never printed beside a blank. */
const UNNAMED_PROCESS = "(unnamed)";

/**
 * The surface field cmux 0.65.2 added for processes on the surface's tty it attributes to no tree. MEASURED
 * on a reopened tab at its prompt (`SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"include_processes":true,"workspace_id":"workspace:1000000001"}'`):
 * `processes: []`, `pids: []`, and `unattributed_tty_process_pids: [60561, 60562]` — `/usr/bin/login` and its
 * `-/bin/zsh`. On 0.64.22 the same tab read `processes: [zsh]`, so a judge reading `processes` alone now sees an empty
 * tab where a bare shell is, and the whole fleet recovery refused `NO_LIVE_SESSION` on the pinned chair.
 */
const UNATTRIBUTED_TTY_PIDS = "unattributed_tty_process_pids";

/**
 * The surface field naming the tab's own pty (`"ttys001"`, the spelling `ps -o tty=` prints). It is a property of the
 * terminal cmux opened, not of the process attribution beside it, so it still names the tab when attribution does not.
 * MEASURED on one tab: two reads a minute apart attributed the same tab's `login` and
 * shells as `tty-collision` then as `explicit-root-pid`/`tty-descendant`, while `tty` read `ttys001` both times (repro:
 * `SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"include_processes":true}'`, each surface's `tty` and
 * `tty_ownership_reasons`). Optional: an older cmux does not send it.
 */
const SURFACE_TTY = "tty";

/** What `system.top` reports for one workspace's surfaces: the trees it attributes, and the tty pids it does not. */
export interface CmuxWorkspaceTop {
  /**
   * How many surfaces the workspace's panes hold. A typed line reaches the SELECTED surface only, while `trees` and
   * `unattributedTtyPids` are read across every surface, so a judge that types refuses a workspace holding more than
   * one (a bare shell on a hidden split would otherwise vouch for the selected
   * surface that reported nothing).
   */
  readonly surfaces: number;
  readonly trees: readonly CmuxProcess[];
  /**
   * {@link SURFACE_TTY} off each surface that sends one, in surface order: the tie between a tab and a process that
   * holds when cmux attributes no process to the tab at all (`../sessions/liveInTab.ts`). Empty on a cmux that sends
   * none.
   */
  readonly ttys: readonly string[];
  /**
   * {@link UNATTRIBUTED_TTY_PIDS}, flattened across the surfaces: on cmux 0.65.2 the tab's own `login` and shell, which
   * `trees` no longer carries. Empty on a cmux that does not report the field, so the field is OPTIONAL per surface
   * where `processes` is required: an older cmux is not a malformed reply.
   */
  readonly unattributedTtyPids: readonly number[];
}

/** Decode one process node and its children, or `undefined` when it or ANY descendant will not decode. */
function parseProcess({ entry }: { entry: unknown }): CmuxProcess | undefined {
  if (!isRecord(entry) || typeof entry["pid"] !== "number") {
    return undefined;
  }
  const rawChildren: unknown = entry["children"];
  const children: CmuxProcess[] = [];
  if (rawChildren === undefined) {
    return { children, name: processName({ entry }), pid: entry["pid"] };
  }
  if (!Array.isArray(rawChildren)) {
    return undefined;
  }
  for (const child of rawChildren) {
    const parsed = parseProcess({ entry: child });
    if (parsed === undefined) {
      return undefined;
    }
    children.push(parsed);
  }
  return { children, name: processName({ entry }), pid: entry["pid"] };
}

/** A process node's name, or {@link UNNAMED_PROCESS} when cmux read none — a nameless process is still a process. */
function processName({ entry }: { entry: Record<string, unknown> }): string {
  const name = optionalString({ field: "name", value: entry });
  if (name === undefined) {
    return UNNAMED_PROCESS;
  }
  return name;
}

/** Every element of one array-valued field on a record, or an empty list. */
function arrayField({ value, field }: { value: unknown; field: string }): readonly unknown[] {
  if (!isRecord(value)) {
    return [];
  }
  const raw = value[field];
  return Array.isArray(raw) ? raw : [];
}

/**
 * One REQUIRED array-valued field off every parent, concatenated, or `undefined` when a parent is not a record or its
 * field is absent or not an array. cmux sends an empty list for an empty container, never no field.
 * MEASURED on 11 workspaces, 11 panes and 11 surfaces, every one carrying its field, two with `processes: []`:
 * `SLOPWEAVER_ALLOW_RAW=1 cmux rpc system.top '{"include_processes":true}' --json | jq -c '[.windows[]?.workspaces[]?.panes[]?.surfaces[]? | has("processes")]'`.
 */
function strictListField({
  parents,
  field,
}: {
  parents: readonly unknown[];
  field: string;
}): readonly unknown[] | undefined {
  const out: unknown[] = [];
  for (const parent of parents) {
    const raw = isRecord(parent) ? parent[field] : undefined;
    if (!Array.isArray(raw)) {
      return undefined;
    }
    out.push(...raw);
  }
  return out;
}

/**
 * Every root process attributed to one `system.top` workspace row's surfaces.
 *
 * @param workspace one row of a reply's `windows[].workspaces[]`
 * @returns the roots, or `undefined` when any pane, surface, process or child will not decode
 */
export function workspaceSurfaceProcesses({ workspace }: { workspace: unknown }): readonly CmuxProcess[] | undefined {
  const panes = strictListField({ field: "panes", parents: [workspace] });
  const surfaces = panes === undefined ? undefined : strictListField({ field: "surfaces", parents: panes });
  const entries = surfaces === undefined ? undefined : strictListField({ field: "processes", parents: surfaces });
  if (entries === undefined) {
    return undefined;
  }
  const out: CmuxProcess[] = [];
  for (const entry of entries) {
    const parsed = parseProcess({ entry });
    if (parsed === undefined) {
      return undefined;
    }
    out.push(parsed);
  }
  return out;
}

/** `raw` as a list of integers, or `undefined` when it is not a list or holds anything else. */
function integerList({ raw }: { raw: unknown }): readonly number[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== "number" || !Number.isInteger(entry)) {
      return undefined;
    }
    out.push(entry);
  }
  return out;
}

/**
 * How many surfaces one workspace row's panes hold.
 *
 * @param workspace one row of a reply's `windows[].workspaces[]`
 * @returns the count; `undefined` when a pane or surface list will not decode
 */
function workspaceSurfaceCount({ workspace }: { workspace: unknown }): number | undefined {
  const panes = strictListField({ field: "panes", parents: [workspace] });
  const surfaces = panes === undefined ? undefined : strictListField({ field: "surfaces", parents: panes });
  return surfaces?.length;
}

/**
 * Every {@link UNATTRIBUTED_TTY_PIDS} entry across one workspace row's surfaces.
 *
 * @param workspace one row of a reply's `windows[].workspaces[]`
 * @returns the pids, empty when no surface carries the field; `undefined` when a pane or surface will not decode, or
 *   a surface carries the field as anything but a list of integers
 */
function workspaceSurfaceTtyPids({ workspace }: { workspace: unknown }): readonly number[] | undefined {
  const panes = strictListField({ field: "panes", parents: [workspace] });
  const surfaces = panes === undefined ? undefined : strictListField({ field: "surfaces", parents: panes });
  if (surfaces === undefined) {
    return undefined;
  }
  const out: number[] = [];
  for (const surface of surfaces) {
    const raw = isRecord(surface) ? surface[UNATTRIBUTED_TTY_PIDS] : undefined;
    if (raw === undefined) {
      continue;
    }
    const pids = integerList({ raw });
    if (pids === undefined) {
      return undefined;
    }
    out.push(...pids);
  }
  return out;
}

/**
 * Every {@link SURFACE_TTY} across one workspace row's surfaces, in surface order.
 *
 * @param workspace one row of a reply's `windows[].workspaces[]`
 * @returns the tty names, empty when no surface carries the field; `undefined` when a pane or surface will not decode,
 *   or a surface carries the field as anything but a string
 */
function workspaceSurfaceTtys({ workspace }: { workspace: unknown }): readonly string[] | undefined {
  const panes = strictListField({ field: "panes", parents: [workspace] });
  const surfaces = panes === undefined ? undefined : strictListField({ field: "surfaces", parents: panes });
  if (surfaces === undefined) {
    return undefined;
  }
  const out: string[] = [];
  for (const surface of surfaces) {
    const raw = isRecord(surface) ? surface[SURFACE_TTY] : undefined;
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== "string") {
      return undefined;
    }
    out.push(raw);
  }
  return out;
}

/**
 * One workspace row's trees, unattributed tty pids, ttys and surface count, or `undefined` when any of them will not
 * decode.
 *
 * @param workspace one row of a reply's `windows[].workspaces[]`
 * @returns the four reads, or `undefined`
 */
function workspaceTopRow({ workspace }: { workspace: unknown }): CmuxWorkspaceTop | undefined {
  const trees = workspaceSurfaceProcesses({ workspace });
  const unattributedTtyPids = trees === undefined ? undefined : workspaceSurfaceTtyPids({ workspace });
  const ttys = unattributedTtyPids === undefined ? undefined : workspaceSurfaceTtys({ workspace });
  const surfaces = ttys === undefined ? undefined : workspaceSurfaceCount({ workspace });
  if (trees === undefined || unattributedTtyPids === undefined || ttys === undefined || surfaces === undefined) {
    return undefined;
  }
  return { surfaces, trees, ttys, unattributedTtyPids };
}

/**
 * What a reply says of its own process enumeration, off `sample.enumeration_complete`. An incomplete enumeration is a
 * sample that may have dropped any process, so an empty surface in it is not an empty tab — read that way it is the
 * `no-process` a running seat was refused on. MEASURED: `true` on every `include_processes:true` read (six
 * fleet-wide reads, 11 terminals each), `false` on an `include_processes:false` one (repro: `SLOPWEAVER_ALLOW_RAW=1 cmux
 * rpc system.top '{"include_processes":true}'`, its `sample`). Absent on an older cmux, which is no malformed reply.
 *
 * @param value the decoded reply
 * @returns `absent`, `complete`, `incomplete`, or `malformed` when `sample` or its field is the wrong shape
 */
function enumerationReading({ value }: { value: unknown }): "absent" | "complete" | "incomplete" | "malformed" {
  if (!isRecord(value) || value["sample"] === undefined) {
    return "absent";
  }
  const sample = value["sample"];
  if (!isRecord(sample)) {
    return "malformed";
  }
  const complete = sample["enumeration_complete"];
  if (complete === undefined) {
    return "absent";
  }
  if (typeof complete !== "boolean") {
    return "malformed";
  }
  return complete ? "complete" : "incomplete";
}

/**
 * Pull every surface-attributed process tree, and every tty pid cmux attributes to no tree, out of a `system.top`
 * reply for one workspace.
 *
 * The trees hang off SURFACES, not off the workspace row — measured, after `include_processes` looked like it
 * did nothing at all at the two levels a reader would try first (the window and the workspace).
 *
 * @param value the decoded reply
 * @param workspaceId the workspace whose surfaces to collect, or `undefined` for every workspace in the reply
 * @returns each surface's root processes, unattributed tty pids and tty, flattened across the workspace's surfaces, and
 *   how many surfaces there were; `MALFORMED_REPLY` when it reports no pid and says its enumeration was incomplete, or any pane,
 *   surface, process, child, tty pid list or tty in a matched workspace will not decode
 */
export function parseWorkspaceTop({
  value,
  workspaceId,
}: {
  value: unknown;
  workspaceId: string | undefined;
}): Result<CmuxWorkspaceTop, CmuxError> {
  const trees: CmuxProcess[] = [];
  const unattributedTtyPids: number[] = [];
  const ttys: string[] = [];
  let surfaces = 0;
  for (const window of arrayField({ field: "windows", value })) {
    for (const workspace of arrayField({ field: "workspaces", value: window })) {
      const matches = workspaceId === undefined || optionalString({ field: "id", value: workspace }) === workspaceId;
      if (!matches) {
        continue;
      }
      const row = workspaceTopRow({ workspace });
      if (row === undefined) {
        return err(
          CmuxErrors.malformedReply({
            detail: "a pane, surface, process, child, tty pid list or tty in the tab would not decode",
            method: "system.top",
          }),
        );
      }
      trees.push(...row.trees);
      unattributedTtyPids.push(...row.unattributedTtyPids);
      ttys.push(...row.ttys);
      surfaces += row.surfaces;
    }
  }
  const refusal = emptyReadRefusal({ reportsNoPid: trees.length === 0 && unattributedTtyPids.length === 0, value });
  if (refusal !== undefined) {
    return err(refusal);
  }
  return ok({ surfaces, trees, ttys, unattributedTtyPids });
}

/**
 * Why a reply reporting no pid cannot be read as an empty tab. Only an EMPTY read leans on the enumeration being whole:
 * a pid the reply does report is read exactly as before, whatever the sample says.
 *
 * @param reportsNoPid whether the matched workspaces carried neither a tree nor an unattributed tty pid
 * @param value the decoded reply, whose `sample` says whether its enumeration was whole
 * @returns the `MALFORMED_REPLY` to refuse with, or `undefined` when the read stands
 */
function emptyReadRefusal({ reportsNoPid, value }: { reportsNoPid: boolean; value: unknown }): CmuxError | undefined {
  const enumeration = enumerationReading({ value });
  if (!reportsNoPid) {
    return undefined;
  }
  if (enumeration === "incomplete") {
    return CmuxErrors.malformedReply({
      detail: "cmux says its process enumeration was incomplete, so an empty tab in it may be a running one",
      method: "system.top",
    });
  }
  if (enumeration === "malformed") {
    return CmuxErrors.malformedReply({
      detail: "the reply's sample.enumeration_complete would not decode",
      method: "system.top",
    });
  }
  return undefined;
}

/**
 * The attributed trees alone ({@link parseWorkspaceTop}'s `trees`): what every reader but the cold-seat judge wants.
 *
 * @param value the decoded reply
 * @param workspaceId the workspace whose surfaces to collect, or `undefined` for every workspace in the reply
 * @returns each surface's root processes, flattened across the workspace's surfaces; `MALFORMED_REPLY` when any
 *   pane, surface, process or child in a matched workspace will not decode
 */
export function parseProcessTrees({
  value,
  workspaceId,
}: {
  value: unknown;
  workspaceId: string | undefined;
}): Result<readonly CmuxProcess[], CmuxError> {
  return parseWorkspaceTop({ value, workspaceId }).map((top) => top.trees);
}
