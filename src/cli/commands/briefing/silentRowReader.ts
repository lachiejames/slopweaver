/**
 * The briefing's view of which standing rows have gone quiet, for `../../../briefing/silentRows.ts` to gate
 * the page on.
 *
 * The three-store join itself lives in `../../../live/automation/silentRowReader.ts`, which the `recipe-stopped`
 * monitor reads too. This adapter keeps the briefing's own contract on top of it.
 *
 * Every FAILURE here answers the empty list, and that is deliberate rather than lazy. The gate half this
 * feeds can only ever ADD a refusal, so an installation with no recipe store, an unreadable runs file or a
 * ledger that will not open must make the leg silent instead of refusing a page on a measurement that never
 * happened. What it must NOT do is report that silence as a clean zero — `briefingCheck`'s own
 * `rowsChecked` count is what keeps those two apart, and that distinction is this whole finding in miniature.
 * The monitor, which CAN settle a card, reads the same failure as `unmeasurable` instead.
 */
import { readSilentRecipeRows } from "../../../live/automation/silentRowReader.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";

/**
 * Every live standing row that has gone quiet past its own threshold.
 *
 * @param home the state home whose recipe store, run stamps and slot ledger are read
 * @param nowIso the instant every row's due-ness and period are judged at
 * @returns the silent rows, worst first — empty when every row is posting OR when nothing could be read
 */
export function silentRecipeRows({ home, nowIso }: { home: string; nowIso: string }): readonly SilentRow[] {
  const reading = readSilentRecipeRows({ home, nowIso });
  if (reading.isErr()) {
    return [];
  }
  return reading.value.silent;
}
