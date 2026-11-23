/**
 * Refuses a file-tool call that reaches an owner-protected path — the `Read`/`Edit`/`Write`/`NotebookEdit`/`Grep`/
 * `Glob` half of the protected-path tripwire. The `Bash` half is `./protectedPathBash.ts`; the registry and the rule
 * are `../protectedPaths/`. Pure, no I/O, and it names no path: the registry's entries are handed in.
 *
 * What each tool is judged as:
 *
 * - `Edit`, `Write`, `MultiEdit` (`file_path`) and `NotebookEdit` (`notebook_path`) — a WRITE.
 * - `Read` (`file_path`) — a READ.
 * - `Grep` and `Glob` (`path`, else the session's directory) — a SEARCH, refused at, under or ABOVE a `no-access` path,
 *   since a search from an ancestor reads into it (`../protectedPaths/decide.ts`).
 *
 * A relative path is resolved against the payload's `cwd`. A field of the wrong type, or no `cwd` to resolve against,
 * is a call this cannot judge, and it is allowed: a tripwire, not a fence.
 */
import { isAbsolute, resolve } from "node:path";

import { type PathAccess, protectionHitAny } from "../protectedPaths/decide.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

/** Each file tool this judges, the `tool_input` field naming its path, and what reaching that path is. */
const TOOL_ACCESS: Readonly<Record<string, { field: string; access: PathAccess }>> = {
  Edit: { access: "write", field: "file_path" },
  Glob: { access: "search", field: "path" },
  Grep: { access: "search", field: "path" },
  MultiEdit: { access: "write", field: "file_path" },
  NotebookEdit: { access: "write", field: "notebook_path" },
  Read: { access: "read", field: "file_path" },
  Write: { access: "write", field: "file_path" },
};

/** One refused file-tool call. */
export interface ProtectedPathToolHit {
  /** The absolute path the call reaches. */
  readonly target: string;
  /** What the call would have done there. */
  readonly access: PathAccess;
  /** The entry it reaches. */
  readonly entry: ProtectedPath;
}

/**
 * The absolute path one file-tool call names and what it would do there, or `undefined` when it is not a file tool
 * this judges or names no path it can resolve.
 *
 * @param toolName the payload's `tool_name`
 * @param toolInput the payload's `tool_input`
 * @param cwd the payload's `cwd`, which a relative path and a searching tool's default root resolve against
 * @returns the target and its access
 */
export function fileToolTarget({
  toolName,
  toolInput,
  cwd,
}: {
  toolName: string;
  toolInput: Readonly<Record<string, unknown>>;
  cwd: string | undefined;
}): { target: string; access: PathAccess } | undefined {
  const spec = TOOL_ACCESS[toolName];
  if (spec === undefined) {
    return undefined;
  }
  const named = toolInput[spec.field];
  const searchesCwd = spec.access === "search" && named === undefined;
  if (searchesCwd) {
    return cwd === undefined ? undefined : { access: spec.access, target: resolve(cwd) };
  }
  if (typeof named !== "string" || named.length === 0) {
    return undefined;
  }
  if (isAbsolute(named)) {
    return { access: spec.access, target: resolve(named) };
  }
  return cwd === undefined ? undefined : { access: spec.access, target: resolve(cwd, named) };
}

/**
 * The protected entry one file-tool call reaches, judged on every spelling of its target.
 *
 * @param toolName the payload's `tool_name`
 * @param toolInput the payload's `tool_input`
 * @param cwd the payload's `cwd`
 * @param entries the registry's entries, the registry file itself among them
 * @param spellings every spelling of a target the caller could resolve — the path as asked and where it resolves
 * @returns the hit, or `undefined` to allow
 */
export function evaluateProtectedPathTool({
  toolName,
  toolInput,
  cwd,
  entries,
  spellings,
}: {
  toolName: string;
  toolInput: Readonly<Record<string, unknown>>;
  cwd: string | undefined;
  entries: readonly ProtectedPath[];
  spellings: (args: { target: string }) => readonly string[];
}): ProtectedPathToolHit | undefined {
  const named = fileToolTarget({ cwd, toolInput, toolName });
  if (named === undefined || entries.length === 0) {
    return undefined;
  }
  const entry = protectionHitAny({
    access: named.access,
    entries,
    targets: [named.target, ...spellings({ target: named.target })],
  });
  return entry === undefined ? undefined : { access: named.access, entry, target: named.target };
}
