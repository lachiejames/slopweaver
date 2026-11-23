/**
 * The machine's load-slot admission, as one CLI-level call.
 *
 * It lives here rather than beside any one caller because the verbs that take a slot share nothing else:
 * `derive`, `distil`, `audit`, `pane` and `slice verify` each commit a whole-corpus footprint, and reaching
 * the slot through one of their modules would pull that module's whole import graph into the others to ask
 * one question about a directory of slot lanes — the opposite of the thing being rationed.
 *
 * Why a slot exists at all, what the limit is derived from, and the measurement behind it:
 * {@link ../lib/loadSlots}.
 *
 * **What deliberately does NOT take one.** `store read` and `store cite` select from the Supabase store and
 * never load a corpus, so there is no footprint to ration.
 * `slopweaver dev heap-curve` loads the whole corpus on purpose to MEASURE this footprint, and a run it could
 * be refused from measures nothing; `slopweaver dev manifest` is a repo-development verb an agent runs one at
 * a time against the PR gate. All three are stated here rather than left as gaps, so a later reader can see
 * the line was drawn rather than missed.
 */
import { readHeap } from "../lib/heapBudget.js";
import { guardLoadSlot, type LoadSlotGuard, slotRefusalLines } from "../lib/loadSlots.js";
import type { Logger } from "../lib/logger.js";
import { EXIT_ERROR } from "./exitCodes.js";

/**
 * Take this machine's load slot, or refuse before a single byte is committed.
 *
 * Called immediately BEFORE the footprint exists, never after: the point is to stop one more process
 * committing gigabytes, and a check that runs once the memory is already committed protects nothing. For a
 * whole-corpus verb that means before its bronze read — `readCorpusDir` for `derive`, the corpus census for
 * `distil`, `audit`, `pane` and `slice verify` — which is every caller there is: a store query commits no
 * footprint and takes no slot.
 *
 * Nothing is queued and there is no release to forget: a slot belongs to a pid and is reclaimed by probing
 * it, so a killed verb frees its slot without anyone's help, and the remedy for a refusal is to retry.
 *
 * @param logger the diagnostic sink the refusal is printed to
 * @param guard the slot guard — the real machine unless a test injects one
 * @returns `{ admitted: true }` once this process holds a slot, or the exit code to return instead
 */
export function admitLoadSlot({
  logger: log,
  guard = guardLoadSlot,
}: {
  logger: Pick<Logger, "error">;
  guard?: LoadSlotGuard;
}): { admitted: true } | { code: number } {
  const refusal = loadSlotRefusal({ guard });
  if (refusal === undefined) {
    return { admitted: true };
  }
  refusal.forEach((line) => {
    log.error({ msg: line });
  });
  return { code: EXIT_ERROR };
}

/**
 * Take the slot, returning the refusal LINES instead of printing them.
 *
 * The shape for a caller that does not answer through a logger: the browser console renders its refusal
 * into the page, and `distil`'s plan carries it back as the `Result`'s own errors. Both need the same
 * arithmetic {@link admitLoadSlot} prints, so neither re-derives it.
 *
 * @param guard the slot guard — the real machine unless a test injects one
 * @returns the refusal lines when the machine is full or its slot state could not be established, or `undefined`
 *   once this process holds a slot
 */
export function loadSlotRefusal({ guard = guardLoadSlot }: { guard?: LoadSlotGuard } = {}):
  readonly string[] | undefined {
  const verdict = guard({});
  if (verdict.admitted) {
    return undefined;
  }
  return slotRefusalLines({
    ceilingMib: Math.round(readHeap().limitBytes / (1024 * 1024)),
    holders: verdict.holders,
    limit: verdict.limit,
    obstacles: verdict.obstacles,
  });
}
