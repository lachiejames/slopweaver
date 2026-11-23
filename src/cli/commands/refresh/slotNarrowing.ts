/**
 * Taking each selected source's refresh slot before a `refresh` run fetches anything, and saying whether the
 * run has anything left to do once the held sources are dropped. `./run.ts` is the shell that calls it.
 */

import { refreshSlotRefusalLines, slotUnavailableLines } from "../../../corpus/refreshSlot.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { EXIT_DEFERRED } from "../../exitCodes.js";
import type { RefreshOptions } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import { refreshSlotAcquirer } from "./requestDefaults.js";

/**
 * Drop the sources whose refresh slot is already held by another live process.
 *
 * EVERY refresh path narrows through this, not only `--jit` — the owner's ruling, quoted in full in
 * {@link ../../../corpus/refreshSlot}: a lock for corpus refresh in general, because two of them at once is
 * undefined behaviour. `--jit` no longer decides whether the slot is taken; it decides only which remedy
 * the refusal names.
 *
 * A DROP rather than a refusal of the whole run: a run over slack and linear, where another process is
 * already refreshing slack, should still refresh linear. The caller checks whether ANYTHING survived — a
 * run whose sources were all dropped fetched nothing, and reporting that as a success is the failure this
 * whole verb exists to avoid.
 *
 * A refusal naming no holder — a slot that could not be taken at all — drops its source too, with its obstacles
 * printed: fetching without the slot would be a writer the next refresh could not see.
 *
 * @param deps the effectful seams (the slot acquirer and the line sink)
 * @param options the parsed options, read for `--jit`'s remedy wording
 * @param sources the sources already selected
 * @returns the sources this run may actually fetch, in selection order
 */
function narrowToAdmitted({
  deps,
  options,
  sources,
}: {
  deps: RefreshDeps;
  options: RefreshOptions;
  sources: readonly CorpusSource[];
}): readonly CorpusSource[] {
  const take = refreshSlotAcquirer({ deps });
  return sources.filter((source) => {
    const verdict = take({ source });
    if (verdict.admitted) {
      return true;
    }
    const holder = verdict.holders[0];
    let lines: readonly string[];
    if (holder === undefined) {
      lines = slotUnavailableLines({ obstacles: verdict.obstacles, source, verb: "refresh" });
    } else {
      lines = refreshSlotRefusalLines({
        holder: { pid: holder.pid, source, startedAtIso: holder.startedAtIso },
        jit: options.jit,
        source,
      });
    }
    lines.forEach((line) => {
      deps.logger.error({ msg: line });
    });
    return false;
  });
}

/**
 * Take each selected source's slot and say whether this run has anything left to do.
 *
 * The all-dropped verdict lives here rather than inline in the shell so the shell stays a plain sequence of
 * stages, and because the two halves are one decision: taking the slots is what produces the empty
 * selection that makes the run pointless.
 *
 * @param deps the effectful seams (the slot acquirer and the line sink)
 * @param options the parsed options
 * @param sources the sources already selected
 * @returns the sources to fetch, or the exit code when every one of them was dropped
 */
export function narrowOrReport({
  deps,
  options,
  sources,
}: {
  deps: RefreshDeps;
  options: RefreshOptions;
  sources: readonly CorpusSource[];
}): { admitted: readonly CorpusSource[] } | { code: number } {
  const admitted = narrowToAdmitted({ deps, options, sources });
  if (sources.length === 0 || admitted.length > 0) {
    return { admitted };
  }
  // Every selected source is being refreshed by somebody else. Nothing was fetched, so this is not a
  // success — and it is not a usage error or a fault either, because the argv was fine and the machine was
  // busy. It is NOT YET: the same run is correct once the holder finishes, so a scheduler leaves the row due
  // rather than cooling and holding it, exactly as `compact` answers the same slot. MEASURED:
  // exiting 1 here held `resync-corpus-slack` and carded a finding while slack was being refreshed.
  deps.logger.error({
    msg: "refresh: every selected source was dropped — each is already being refreshed by another process, or its slot could not be taken as said above — nothing to do here",
  });
  return { code: EXIT_DEFERRED };
}
