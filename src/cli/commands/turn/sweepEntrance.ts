/**
 * The sweep's entrance gate — the effectful shell over `../../../live/turn/sweepIgnored.ts`'s pure partition.
 *
 * Its own module for the same reason `./abandoned.ts`, `./sweepCard.ts` and `./reviewSurface.ts` are:
 * `./dispatchSweep.ts` sits at the file-size ratchet, and this is a real seam — everything here happens
 * BEFORE either of the sweep's two passes, and nothing after it reads the registries again.
 *
 * All this layer does is read both ignore registries off disk once and report what they answered for. The
 * decision, the line and the whole measurement that made this necessary live in the pure module.
 */
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import { ignoredSweepLine, partitionIgnoredSweepAsks } from "../../../live/turn/sweepIgnored.js";
import type { SweepCounts } from "../../../live/turn/sweepSummary.js";

/**
 * Drop every ask a permanent ignore registry has already answered for, naming each one it dropped.
 *
 * Runs over the sweep's whole selection — `--ask`'s own filter included, so an operator naming a real ask
 * that is really ignored is told exactly that rather than "no ask in this home".
 *
 * @param counts the sweep's counters, whose `ignored` is incremented in place
 * @param entries the asks this sweep selected, in log order
 * @param home the resolved state home, which both registries are read from
 * @param writeLine where each suppressed ask's line is reported
 * @returns the asks the sweep may go on to judge, in the same order
 */
export function admittedSweepAsks({
  counts,
  entries,
  home,
  writeLine,
}: {
  counts: SweepCounts;
  entries: readonly AskLifecycle[];
  home: string;
  writeLine: (input: { line: string }) => void;
}): readonly AskLifecycle[] {
  const partition = partitionIgnoredSweepAsks({
    entries,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  for (const ask of partition.ignored) {
    writeLine({ line: ignoredSweepLine({ ask }) });
    counts.ignored++;
  }
  return partition.sweep;
}
