/**
 * The one repair the hand-step register makes to itself: the end of a cut-short append, mended under the lock.
 *
 * Every writer appends whole lines, each ending in a newline, under `./store.ts`'s lock — so a register whose last
 * byte is not a newline was cut short. Two shapes follow. A last line that does not parse is a TORN row: left in
 * place it blocks the retry that would finish the write, because a re-cut refuses a register with an unread line (the
 * line may be the step it supersedes), and a tear inside the re-cut's own settling kept both cards up for good. A last line that parses is a whole row missing only its newline, and the next append would be
 * glued onto it. The first is dropped; the second gets its newline.
 *
 * Found here and mended by `./store.ts`'s `appendText`, the one append every writer goes through, so a call that
 * refuses writes nothing and no append is ever glued onto a cut-short end. A terminated line that does not parse is
 * left exactly as it is.
 *
 * Reads only the last line, found by stepping back from the end a chunk at a time, never the whole register through
 * one string (`.claude/rules/typescript-patterns.md`). A line of any length is found: a fixed window once left a
 * torn line longer than it unmendable, and its re-cut refused for good.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { parseHandLine } from "./row.js";

/** How much is read per step back from the end while looking for the last line's start. */
const CHUNK_BYTES = 64 * 1024;

/** The newline byte every whole row ends with. */
const NEWLINE = 0x0a;

/** How a cut-short register's end is mended: bytes cut back to the last whole line, or one newline added. */
export type TailMend =
  | { readonly kind: "torn"; readonly keepBytes: number; readonly droppedBytes: number }
  | { readonly kind: "unterminated" };

/**
 * How the register's end must be mended before an append, when it must. Reads only.
 *
 * Call only under the register's lock, so nothing appends between this read and the mend.
 *
 * @param path the register file
 * @returns the mend, `undefined` when the file is absent or ends a whole line, or the failure
 */
export function findTailMend({ path }: { path: string }): Result<TailMend | undefined, HandStepError> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(undefined);
    }
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size === 0 || (readSync(fd, last, { length: 1, position: size - 1 }) === 1 && last[0] === NEWLINE)) {
      return ok(undefined);
    }
    const start = lastLineStart({ fd, size });
    const line = Buffer.alloc(size - start);
    readSync(fd, line, { length: line.length, position: start });
    return ok(mendOf({ line, start }));
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  } finally {
    try {
      closeSync(fd);
    } catch {
      // A descriptor opened only to read: failing to close it loses nothing, and must not replace the answer above with
      // a throw.
    }
  }
}

/**
 * Where the file's last line starts: one past the last newline, or 0 when there is none, stepping back a chunk at a
 * time so a line of any length is found without reading the register whole.
 *
 * @param fd the register, open for reading
 * @param size its length in bytes
 * @returns the byte offset of the last line's first byte
 */
function lastLineStart({ fd, size }: { fd: number; size: number }): number {
  const chunk = Buffer.alloc(CHUNK_BYTES);
  let end = size;
  while (end > 0) {
    const position = Math.max(0, end - CHUNK_BYTES);
    const length = end - position;
    readSync(fd, chunk, { length, position });
    const newline = chunk.subarray(0, length).lastIndexOf(NEWLINE);
    if (newline !== -1) {
      return position + newline + 1;
    }
    end = position;
  }
  return 0;
}

/**
 * The mend an unterminated last line needs: a newline when it parses, dropping it when it does not.
 *
 * A blank one is not a torn ROW: the reader skips it rather than counting it unread, so calling it torn let
 * `./store.ts`'s `unreadBesideTornTail` forgive the skipped line BEFORE it in its place. Terminated, it is
 * a blank line the reader skips.
 *
 * @param line the last line's bytes, which end without a newline
 * @param start where in the file `line` starts
 * @returns the mend
 */
function mendOf({ line, start }: { line: Buffer; start: number }): TailMend {
  const text = line.toString("utf8");
  if (text.trim().length === 0 || parseHandLine({ line: text, lineNumber: 0 }).isOk()) {
    return { kind: "unterminated" };
  }
  return { droppedBytes: line.length, keepBytes: start, kind: "torn" };
}
