/**
 * The one effect the script-wrapper classifier delegates: reading a script's text from disk. Kept apart
 * from the pure walk in `scriptWrapper.ts` so that walk stays unit-tested with a fake reader, and this
 * reader is tested on its own against a real temp file.
 *
 * Reads nothing it should not: a path that resolves to a directory, a file over the size cap, or a file with
 * a NUL in its first bytes (a binary such as `/usr/bin/gh` handed in as a "script") all read as `undefined`,
 * and so does any error at all — the classifier then judges the command by name, exactly as it did before
 * this reader existed. A hook that could be wedged by an unreadable file would be worse than the gap.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Scripts are small; a file past this is not something a session wrote to wrap `gh` and is not opened. */
const MAX_SCRIPT_BYTES = 512 * 1024;

/** How many leading bytes are inspected for a NUL before the file is treated as text. */
const BINARY_PROBE_BYTES = 8 * 1024;

/** A script path made absolute: as written, else against the payload's `cwd`, else against the process's. */
function absoluteScriptPath({ cwd, path }: { cwd: string | undefined; path: string }): string {
  if (isAbsolute(path)) {
    return path;
  }
  if (cwd === undefined) {
    return resolve(process.cwd(), path);
  }
  return resolve(cwd, path);
}

/**
 * Read a script's text for the classifier, resolving a relative path against the hook payload's `cwd`.
 *
 * @param cwd the directory the tool call runs in — the payload's own `cwd`, or `undefined` to use the process's
 * @param path the script path token as it appeared in the command
 * @returns the script's UTF-8 text, or `undefined` when it is not a readable text file of reasonable size
 */
export function readScriptSource({ cwd, path }: { cwd: string | undefined; path: string }): string | undefined {
  try {
    const resolved = absoluteScriptPath({ cwd, path });
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_SCRIPT_BYTES) {
      return undefined;
    }
    const bytes = readFileSync(resolved);
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
      return undefined;
    }
    return bytes.toString("utf8");
  } catch {
    return undefined;
  }
}
