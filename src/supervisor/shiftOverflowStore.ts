/**
 * The one write an overflowed sweep prompt owes: the whole authored shift state, at the path its pointer names.
 *
 * The path is the content's own SHA-256 (`./sweepPromptOverflow.ts`), so a rewrite can only ever put the same
 * bytes back — which is why a plain atomic replace is enough and a rerun of an interrupted close is idempotent.
 * Both edges call this BEFORE printing the prompt, so no printed prompt ever points at a file that is not there.
 */

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import type { OverflowedShift } from "./sweepPromptArm.js";

/**
 * Write an overflowed shift state whole, atomically, creating its scratch directory.
 *
 * @param contents the exact authored shift state
 * @param path the content-addressed path the prompt's pointer names
 * @returns the path written, or the one line saying why it could not be
 */
export function keepShiftOverflow({ contents, path }: { contents: string; path: string }): Result<string> {
  try {
    writeFileAtomic({ contents, path });
    return ok(path);
  } catch (cause: unknown) {
    return err([`cannot keep the overflowed shift state at ${path}: ${errorMessage({ error: cause })}`]);
  }
}

/**
 * Keep a render's overflow when it had one, and say where its words now live.
 *
 * @param overflow what the render moved off the prompt, undefined when the shift state fit
 * @returns the diagnostic line to print, none when nothing overflowed, or why the file could not be kept
 */
export function keepOverflowed({ overflow }: { overflow: OverflowedShift | undefined }): Result<readonly string[]> {
  if (overflow === undefined) {
    return ok([]);
  }
  return keepShiftOverflow({ contents: overflow.contents, path: overflow.path }).map((path) => [
    `shift state overflowed; ${String(overflow.words)} words are only in ${path}`,
  ]);
}
