/**
 * The bound on the store lifecycle's git reads of `origin/main`, what a read stopped at it reports, and the parse
 * of the one batched read of every landed migration. Split from `./lifecycle.ts`, which runs the reads, so each is
 * a pure function a test can hand the exact bytes or error git and Node produce.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../lib/parsers.js";

import { firstLineOf } from "./migrate.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
export const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Why the landed migrations could not be read: a git read killed at {@link GIT_READ_TIMEOUT_MS} says it was
 * stopped, so a hung `origin/main` read never reads like an ordinary missing ref.
 *
 * @param baseRef the ref the read was walking
 * @param error what the git call threw
 * @returns one line naming the timeout, or the error's own first line
 */
export function landedUnreadable({ baseRef, error }: { baseRef: string; error: unknown }): string {
  if (isRecord(error) && error["code"] === "ETIMEDOUT") {
    return `git was still reading ${baseRef} after ${String(GIT_READ_TIMEOUT_MS / 60_000)} minutes, so it was stopped`;
  }
  return firstLineOf({ error });
}

/**
 * Decode a migration's bytes as UTF-8, THROWING on any byte sequence that is not valid UTF-8 rather than
 * replacing it with U+FFFD. Drizzle hashes a migration's decoded TEXT, so a lenient decode would let two files
 * differing only in invalid bytes hash alike and pass a byte-for-byte landed check; valid
 * UTF-8 decodes one way only, so on it equal text is equal bytes. The BOM is kept, as `Buffer#toString` keeps it,
 * so the text — and its hash — is exactly what drizzle's own read produces.
 *
 * @param bytes the file's raw contents
 * @returns the decoded text
 */
export function strictUtf8({ bytes }: { bytes: Uint8Array }): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

/**
 * Split what `git cat-file --batch` printed for a list of blob names into each blob's text, in the order asked.
 * ONE git process reads every landed migration rather than one `git show` each: measured on this tree's 43
 * migrations, the per-file spawns took 3.7 to 11 seconds a read, on every catch-up and every
 * `store push`; this read took 128 to 206 milliseconds with identical hashes. Repro, in milliseconds: `yarn tsx -e
 * 'import("./src/store/lifecycle.ts").then((m) => { const t = performance.now(); m.readLandedMigrations({ cwd: "."
 * }); console.log(performance.now() - t); })'`.
 *
 * Each record is `<oid> blob <size>\n<size bytes>\n`. A name git cannot resolve prints `<name> missing`, and that
 * throws rather than being skipped, so a landed file never silently drops out of the comparison; so does a blob that
 * is not valid UTF-8 ({@link strictUtf8}), so two byte-different blobs never compare equal.
 *
 * @param output the batch's whole stdout, as bytes, since a size counts bytes rather than characters
 * @param count how many names were asked for
 * @returns each blob's text, strictly decoded as UTF-8
 */
export function parseCatFileBatch({ output, count }: { output: Buffer; count: number }): readonly string[] {
  const texts: string[] = [];
  let at = 0;
  while (texts.length < count) {
    const end = output.indexOf(0x0a, at);
    if (end === -1) {
      throw new Error(`git cat-file --batch stopped after ${String(texts.length)} of ${String(count)} blobs`);
    }
    const header = output.subarray(at, end).toString("utf8");
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (match === null) {
      throw new Error(`git cat-file --batch printed "${header}" where a blob was expected`);
    }
    const size = Number(match[1]);
    if (output[end + 1 + size] !== 0x0a) {
      throw new Error(`git cat-file --batch cut blob ${String(texts.length + 1)} short of its ${String(size)} bytes`);
    }
    try {
      texts.push(strictUtf8({ bytes: output.subarray(end + 1, end + 1 + size) }));
    } catch {
      throw new Error(`git cat-file --batch blob ${String(texts.length + 1)} is not valid UTF-8`);
    }
    at = end + 1 + size + 1;
  }
  return texts;
}

/**
 * Each landed migration's tag and the sha256 of its text, from the one batched read of `names`.
 *
 * @param names the `.sql` file names asked for, in the order the batch was fed them
 * @param output the batch's whole stdout
 * @returns tag to hex digest, the same digest a per-file `git show` read gave
 */
export function landedHashes({ names, output }: { names: readonly string[]; output: Buffer }): Map<string, string> {
  const texts = parseCatFileBatch({ count: names.length, output });
  return new Map(
    names.map((name, i) => [name.slice(0, -".sql".length), createHash("sha256").update(texts[i]!).digest("hex")]),
  );
}
