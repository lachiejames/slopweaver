/**
 * The `--queue` durability path. `slopweaver listen --queue <path>` appends one JSONL line per captured tag
 * here, independent of whatever `--json`/`--follow` decided to print on stdout. If the consuming session
 * dies mid-turn, the tags it never got to are still sitting on disk rather than lost with the socket that
 * carried them.
 *
 * fsync'd per line (`appendLines`, durable) rather than buffered: the whole point is surviving a crash, and a
 * write the OS still holds in its page cache is exactly what a crash loses. A line a crash cut short is then
 * separated from the next one rather than fused with it.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "../../lib/appendSeparator.js";

/**
 * Append one line to the queue file, creating it (and its parent directory) if missing, fsync'd so a reader
 * tailing the file — or the file surviving a crash — sees the write immediately rather than whatever the OS
 * still had buffered.
 *
 * @param path the queue file's path
 * @param line the JSON line to append (no trailing newline — one is added)
 */
export function appendQueueLine({ path, line }: { path: string; line: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  appendLines({ durable: true, path, text: `${line}\n` });
}
