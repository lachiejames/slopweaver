/**
 * One in-process recipe leg run with its stdout COLLECTED and its stderr TEED, so the leg answers all three of
 * what a runner needs: its exit code, the document it printed, and why it stopped.
 *
 * A collected leg (an alert-summary or alert-digest read, a card's `slack post`, a landing read) runs in this
 * process, because its stdout is the document the next leg consumes; a generic row's verb runs in a child
 * instead (`./runDueVerbProcess.ts`). So a collected leg's stderr is this process's stderr and nothing else keeps
 * it. A failed leg's record carries
 * that tail as `· why: …` (`../../../live/automation/verbFailureWhy.ts`), which is how the slot record, the
 * failure finding and the Automations page say what broke without anyone re-running the firing.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { teeWrites } from "#lib/writeTee.js";

import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";

/**
 * How much of a leg's stderr is held while it runs, in UTF-16 code units rather than bytes: a bound on memory for a
 * verb that logs a great deal, far more than the few closing lines `verbFailureWhy` keeps from it. Two residues,
 * each accepted rather than closed:
 * - one stderr line longer than this whole window reaches the reducer already cut, so its kept head is the head of
 *   its tail;
 * - the capture swaps the PROCESS's `stderr.write` for the leg's run window, so a write an earlier leg left
 *   scheduled past its own return lands in this leg's capture. Closing that needs an `AsyncLocalStorage` scope per
 *   leg; every verb a row runs today awaits its work before it returns, so none does this.
 */
const LEG_DIAGNOSTICS_KEPT_CHARS = 64 * 1024;

/**
 * What one in-process leg whose stdout is collected answers: its exit code, the lines it printed, and the tail of
 * what it wrote to stderr, which is where a verb states why it failed.
 */
export interface CollectedLeg {
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly diagnostics: string;
}

/**
 * Run one in-process leg with this process's stderr teed to {@link LEG_DIAGNOSTICS_KEPT_CHARS}.
 *
 * A leg that THROWS still wrote its reason first, so the rejection is rethrown with that tail appended to its
 * message: the row's `THREW` line, built from the message alone, then ends with the leg's own why as a non-zero
 * exit's line does. The original error rides as the `cause`.
 *
 * @param run the leg
 * @returns the leg's own value and the tail of what it wrote to stderr
 */
export async function teeLeg<T>({
  run,
}: {
  run: () => Promise<T>;
}): Promise<{ readonly value: T; readonly text: string }> {
  const teed = await teeWrites({
    keepChars: LEG_DIAGNOSTICS_KEPT_CHARS,
    run: async (): Promise<Result<T, unknown>> => {
      try {
        return ok(await run());
      } catch (error: unknown) {
        return err(error);
      }
    },
    stream: process.stderr,
  });
  if (teed.value.isErr()) {
    const line = errorMessage({ error: teed.value.error });
    throw new Error(appendVerbFailureWhy({ diagnostics: teed.text, line }), { cause: teed.value.error });
  }
  return { text: teed.text, value: teed.value.value };
}

/**
 * Run one leg with its stdout lines collected and its stderr teed through {@link teeLeg}.
 *
 * @param run the leg, handed the sink its stdout lines go to; it answers its exit code
 * @returns the leg's exit code, its collected lines and the tail of its stderr
 */
export async function collectLeg({
  run,
}: {
  run: (sink: { readonly writeOut: (line: string) => void }) => Promise<number>;
}): Promise<CollectedLeg> {
  const lines: string[] = [];
  const { text, value } = await teeLeg({
    run: () =>
      run({
        writeOut: (line) => {
          lines.push(line);
        },
      }),
  });
  return { diagnostics: text, exitCode: value, lines };
}
