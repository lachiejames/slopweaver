/**
 * Small JSON-file IO shared by the silver/gold stages: pretty-print writes (with a trailing newline, so
 * files diff cleanly, and atomic + crash-durable via {@link writeFileAtomic} — a stage killed mid-write used
 * to be able to leave a truncated file at the real path) and a tolerant read that returns undefined rather
 * than throwing on a missing/corrupt file. The effectful edge; pure logic stays in the stage modules. Both the write and the
 * read+parse go through {@link safeFs} so every failure is a typed `io` error — the write re-throws it
 * (fail-loud, unchanged), the read swallows it to `undefined` (the tolerant contract, unchanged).
 */
import { readFileSync } from "node:fs";
import { orThrow, safeFs } from "./safeBoundary.js";

import { writeFileAtomic } from "./writeAtomic.js";

/**
 * Write `value` as pretty JSON, atomically and durably, creating parent dirs. Throws (via {@link orThrow})
 * on an fs failure.
 *
 * @param path the file to write
 * @param value the JSON-serialisable value
 */
export function writeJsonFile({ path, value }: { path: string; value: unknown }): void {
  orThrow({
    result: safeFs({
      execute: () => {
        writeFileAtomic({ contents: `${JSON.stringify(value, null, 2)}\n`, path });
      },
      operation: "writeJsonFile",
      path,
    }),
  });
}

/**
 * Read + parse a JSON file, or undefined when it's missing or unparseable (the tolerant read).
 *
 * @param path the file to read
 * @returns the parsed value, or undefined
 */
export function readJsonFile({ path }: { path: string }): unknown {
  const result = safeFs({ execute: () => JSON.parse(readFileSync(path, "utf8")), operation: "readJsonFile", path });
  return result.isOk() ? result.value : undefined;
}
