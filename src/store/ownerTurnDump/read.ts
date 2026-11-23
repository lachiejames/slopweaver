/**
 * Reading a `pg_dump` of the owner-turn tables off disk — the effectful half of `./project.ts`.
 *
 * The file is streamed a line at a time and never held as one string: a keep of 30,000-odd locations is tens of
 * megabytes, and a dump is the shape that grows. A line ends at `\n`, `\r\n` or `\r`, the three COPY accepts; a COPY
 * data line never carries a raw newline or carriage return (both are written `\n` / `\r`), so a line IS a row.
 *
 * The bytes are decoded with a FATAL UTF-8 decoder, never Node's `utf8` stream encoding: that one replaces a malformed
 * byte with U+FFFD in silence, and the replacement then re-hashes cleanly, so a dump byte would be stored as a
 * different one with every check passing. A malformed byte refuses the whole file.
 */
import { createReadStream } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError } from "#lib/presentFile.js";
import { err, type Result } from "#lib/result.js";

import { type OwnerTurnDumpError, OwnerTurnDumpErrors } from "./errors.js";
import { createOwnerTurnDumpFold, type OwnerTurnDumpLoad } from "./project.js";

/** Every line break COPY accepts, bar a `\r` that closes the text so far, which may yet be half of a `\r\n`. */
const OPEN_BREAK = /\r\n|\n|\r(?!$)/u;
/** Every line break COPY accepts, for the text left once the file is read. */
const CLOSING_BREAK = /\r\n|\n|\r/u;

/**
 * The file's lines, decoded as exact UTF-8.
 *
 * @param path the file
 * @yields each line without its break; a final empty line after the last break is not one
 */
async function* exactLines({ path }: { path: string }): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let carry = "";
  // No `encoding` option, so the stream yields bytes; typing the binding states that without asserting it.
  const chunks: AsyncIterable<Uint8Array> = createReadStream(path);
  for await (const chunk of chunks) {
    carry += decoder.decode(chunk, { stream: true });
    const parts = carry.split(OPEN_BREAK);
    carry = parts.pop()!;
    yield* parts;
  }
  carry += decoder.decode();
  const parts = carry.split(CLOSING_BREAK);
  const last = parts.pop()!;
  yield* parts;
  if (last !== "") {
    yield last;
  }
}

/**
 * Fold a whole dump file.
 *
 * @param path the `.sql` file `pg_dump` wrote
 * @returns every body and location in it with any refused row named, or why the file as a whole is not loadable
 */
export async function readOwnerTurnDump({
  path,
}: {
  path: string;
}): Promise<Result<OwnerTurnDumpLoad, OwnerTurnDumpError>> {
  const fold = createOwnerTurnDumpFold();
  try {
    let lineNumber = 0;
    for await (const line of exactLines({ path })) {
      lineNumber += 1;
      fold.feed({ line, lineNumber });
    }
  } catch (cause) {
    // Only a genuinely absent file is "no such file", judged on the read itself: `existsSync` would say the same of a
    // file it cannot reach.
    const reason = isAbsentError({ error: cause, path }) ? "no such file" : errorMessage({ error: cause });
    return err(OwnerTurnDumpErrors.unreadable({ cause: reason, path }));
  }
  return fold.finish();
}
