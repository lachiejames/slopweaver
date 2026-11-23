/**
 * The file edge of the JSON array splitter (`jsonArrayElements.ts`): one file whose top level is a JSON array, read
 * a chunk at a time and handed over one element at a time, so the file is never one JS string.
 */
import { closeSync, openSync, readSync } from "node:fs";

import { createJsonArraySplitter } from "./jsonArrayElements.js";
import { type JsonArrayError, JsonArrayErrors } from "./jsonArrayErrors.js";
import { err, ok, type Result } from "./result.js";

/** Bytes per read — the same order as `readJsonlLines`' chunk, small enough to never matter to the heap. */
const READ_CHUNK_BYTES = 1024 * 1024;

/** Hand one chunk's finished elements to `onElement` in order, stopping where it answers `false`. */
function handOver({
  texts,
  firstIndex,
  onElement,
}: {
  texts: readonly string[];
  firstIndex: number;
  onElement: (args: { text: string; index: number }) => boolean;
}): { handed: number; stopped: boolean } {
  let handed = 0;
  for (const text of texts) {
    const keepGoing = onElement({ index: firstIndex + handed, text });
    handed += 1;
    if (!keepGoing) {
      return { handed, stopped: true };
    }
  }
  return { handed, stopped: false };
}

/**
 * One read's text, or `undefined` when its bytes are not UTF-8. `fatal` makes the decoder throw on a bad byte rather
 * than replace it with U+FFFD, which would hand on valid-looking text the file never held; `stream` keeps a character
 * split across two reads whole; `ignoreBOM` keeps a byte-order mark in the text, for the splitter to refuse.
 */
function decodeChunk({ decoder, bytes }: { decoder: TextDecoder; bytes: Uint8Array | undefined }): string | undefined {
  try {
    if (bytes === undefined) {
      return decoder.decode();
    }
    return decoder.decode(bytes, { stream: true });
  } catch {
    // A fatal decoder throws only a TypeError for bytes that are not UTF-8; the caller names the file.
    return undefined;
  }
}

/** Split an already-open file chunk by chunk; a throw from a read is the caller's to name. */
function readOpenFile({
  fd,
  path,
  onElement,
}: {
  fd: number;
  path: string;
  onElement: (args: { text: string; index: number }) => boolean;
}): Result<{ elements: number; stoppedEarly: boolean }, JsonArrayError> {
  const splitter = createJsonArraySplitter();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let elements = 0;
  for (;;) {
    const read = readSync(fd, buffer, 0, READ_CHUNK_BYTES, null);
    const chunk = decodeChunk({ bytes: read === 0 ? undefined : buffer.subarray(0, read), decoder });
    if (chunk === undefined) {
      return err(JsonArrayErrors.notUtf8({ path }));
    }
    const pushed = splitter.push({ chunk });
    if (pushed.isErr()) {
      return err(JsonArrayErrors.inFile({ error: pushed.error, path }));
    }
    const handed = handOver({ firstIndex: elements, onElement, texts: pushed.value });
    elements += handed.handed;
    if (handed.stopped) {
      return ok({ elements, stoppedEarly: true });
    }
    if (read === 0) {
      break;
    }
  }
  const ended = splitter.end();
  if (ended.isErr()) {
    return err(JsonArrayErrors.inFile({ error: ended.error, path }));
  }
  return ok({ elements, stoppedEarly: false });
}

/**
 * Read one file whose top level is a JSON array, handing each element's text to `onElement` as it completes.
 *
 * Synchronous and chunked, like `readJsonlLines`: the file is never held whole, and a streaming decoder keeps a
 * multi-byte character split across two reads intact. A file that is not UTF-8 is refused, never read with a
 * replacement character standing in for what it held.
 *
 * @param path the file to read
 * @param onElement called once per element, in document order; returning `false` stops the read early
 * @returns how many elements were handed over, or why the document is not a whole array
 */
export function readJsonArrayElements({
  path,
  onElement,
}: {
  path: string;
  onElement: (args: { text: string; index: number }) => boolean;
}): Result<{ elements: number; stoppedEarly: boolean }, JsonArrayError> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error: unknown) {
    return err(JsonArrayErrors.fileUnreadable({ cause: error, path, verb: "open" }));
  }
  try {
    return readOpenFile({ fd, onElement, path });
  } catch (error: unknown) {
    return err(JsonArrayErrors.fileUnreadable({ cause: error, path, verb: "read" }));
  } finally {
    closeSync(fd);
  }
}
