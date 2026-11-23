/**
 * The pure core of the memory hooks: decide, from a hook payload, whether anything needs checking and what.
 * The effectful shell reads stdin and resolves symlinks; everything here is a decision over plain values.
 *
 * ## Why a `Write` counts and an `Edit` does not
 *
 * A `Write` replaces a whole file, so its content is the author's complete intent for that file and its
 * frontmatter can be judged immediately. An `Edit` is a patch, and a logical change can span several of them —
 * blanking a `description` in one edit and filling it in the next leaves the file transiently invalid through
 * no fault of the author. Reporting that would be exactly the false positive this design exists to avoid, so
 * `Edit` is left to the session-start pass, which sees only settled state.
 */

import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isRecord } from "../lib/parsers.js";
import { classifyMemoryFile } from "./corpus.js";

/**
 * What a payload asks for. `ignore` is by far the commonest outcome — the write hook fires on every `Write`,
 * and almost none of them touch a memory file.
 *
 * `check-corpus` carries no path because a session-start payload has none: there is no tool, so the directory
 * can only come from the hook's own configuration. That is the same reason `--dir` is required rather than
 * derived.
 */
export type MemoryHookRequest =
  | { readonly kind: "ignore" }
  | { readonly kind: "check-leaf"; readonly filePath: string }
  | { readonly kind: "check-corpus" };

/**
 * Which hook fired, read from the payload rather than a flag, so one verb serves both wirings and cannot be
 * configured with an event it is not actually receiving.
 *
 * @param payload the parsed hook JSON
 * @returns the event name, or `null` when the payload does not declare one
 */
export function hookEventName({ payload }: { payload: unknown }): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const event = payload["hook_event_name"];
  return typeof event === "string" ? event : null;
}

/**
 * Decode a `PostToolUse` payload into the one thing this hook can act on: a whole-file write whose path is a
 * usable string. Anything else is `ignore` — a malformed payload is not worth a diagnostic, because the hook's
 * contract is to be silent unless a memory is actually broken.
 *
 * @param payload the parsed hook JSON
 * @returns the file to check, or `ignore`
 */
export function decodeMemoryHookPayload({ payload }: { payload: unknown }): MemoryHookRequest {
  const event = hookEventName({ payload });
  if (event === "SessionStart") {
    return { kind: "check-corpus" };
  }
  if (event !== "PostToolUse" || !isRecord(payload) || payload["tool_name"] !== "Write") {
    return { kind: "ignore" };
  }
  const input = payload["tool_input"];
  if (!isRecord(input)) {
    return { kind: "ignore" };
  }
  const filePath = input["file_path"];
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { kind: "ignore" };
  }
  return { filePath, kind: "check-leaf" };
}

/**
 * Decide whether a written path is a leaf directly inside the corpus.
 *
 * Both arguments must ALREADY be symlink-resolved — this function is lexical on purpose so it stays pure, and
 * the caller owns the `realpath` calls. That split matters: a corpus reached through a symlink (the documented
 * `~/.claude/projects/<project>/memory` path is frequently one) produces a payload path and a configured
 * `--dir` that name the same directory in different words. Comparing them unresolved silently matches nothing,
 * which disables the hook while leaving it looking installed.
 *
 * @param resolvedDir the corpus directory, symlinks resolved
 * @param resolvedFile the written file's absolute path, symlinks resolved
 * @returns the leaf's basename when it is one, otherwise `null`
 */
export function memoryLeafBasename({
  resolvedDir,
  resolvedFile,
}: {
  resolvedDir: string;
  resolvedFile: string;
}): string | null {
  const withoutTrailingSlash = resolvedDir.replace(/\/+$/, "");
  const slash = resolvedFile.lastIndexOf("/");
  if (slash === -1 || resolvedFile.slice(0, slash) !== withoutTrailingSlash) {
    return null;
  }
  const basename = resolvedFile.slice(slash + 1);
  if (!basename.endsWith(".md")) {
    return null;
  }
  // Indexes are graph objects, not leaves: nothing about an index is decidable from the index alone, so a
  // write to one has nothing this path can honestly report.
  return classifyMemoryFile({ file: basename }) === "leaf" ? basename : null;
}

/**
 * Derive the corpus directory from a Write payload only when the path itself proves it is a direct Claude
 * auto-memory leaf. This is deliberately narrower than deriving from the cwd: worktrees do not name the
 * memory key, while the tool payload names the exact file Claude just wrote.
 *
 * The path is checked without resolving symlinks. Auto-memory directories are commonly symlinks to a durable
 * store, and resolving first would erase the trusted `~/.claude/projects/<project>/memory` envelope that makes
 * this derivation safe. The ordinary hook path resolves both file and directory after this classification.
 *
 * @param filePath the whole-file path from the PostToolUse payload
 * @param userHome the current user's home directory
 * @returns the direct auto-memory parent, or `null` for every other write
 */
export function autoMemoryDirFromWritePath({
  filePath,
  userHome,
}: {
  filePath: string;
  userHome: string;
}): string | null {
  if (!isAbsolute(filePath)) {
    return null;
  }
  const projectsRoot = resolve(userHome, ".claude", "projects");
  const absoluteFile = resolve(filePath);
  const fromProjects = relative(projectsRoot, absoluteFile);
  const parts = fromProjects.split(sep);
  if (fromProjects.startsWith(`..${sep}`) || parts.length !== 3 || parts[0] === "" || parts[1] !== "memory") {
    return null;
  }
  return parts[2]!.endsWith(".md") ? dirname(absoluteFile) : null;
}

/**
 * The corpus one hook firing checks: the configured `--dir` when there is one, else — for a leaf write only —
 * the auto-memory directory the written path itself proves. A session start with no `--dir` has no path to
 * derive one from, so it checks nothing.
 *
 * @param dir the configured `--dir`, or `null` when the hook was wired without one
 * @param request the decoded payload
 * @param userHome reads the current user's home directory, called only when a write path must be judged
 * @returns the corpus directory, or `null` when neither the configuration nor the payload names one
 */
export function hookCorpusDir({
  dir,
  request,
  userHome,
}: {
  dir: string | null;
  request: MemoryHookRequest;
  userHome: () => string;
}): string | null {
  if (dir !== null) {
    return dir;
  }
  if (request.kind !== "check-leaf") {
    return null;
  }
  return autoMemoryDirFromWritePath({ filePath: request.filePath, userHome: userHome() });
}
