/**
 * The zeroed exclusion tally, alone in its own module so that BOTH halves of recovery can build one without
 * either importing the other's runtime.
 *
 * It would read more naturally in `recoverShared.ts` beside the rest of the coverage vocabulary, and that is
 * exactly where it cannot go: `recoverShared.ts` imports `candidateFromMessage` from `./recover.ts` as a
 * VALUE, so `recover.ts` importing a value back would close a runtime cycle. Here the only dependency is the
 * `RecoveryExclusion` TYPE, which erases at build time — so `recover.ts` (the classifier, which fills a tally
 * in from real verdicts) and `../../cli/commands/listen/manualRecoverReport.ts` (a pass that read nothing at
 * all and still owes its reader a complete document) each reach one copy with no cycle in either direction.
 */
import type { RecoveryExclusion } from "./recover.js";

/**
 * A tally with every exclusion present and zero, so a reader never has to tell "none of these" apart from
 * "this pass did not count that one". Exhaustive by the compiler: a new {@link RecoveryExclusion} fails to
 * build here rather than going silently uncounted.
 *
 * @returns a fresh, mutable tally with every exclusion at zero
 */
export function zeroExclusionCounts(): Record<RecoveryExclusion, number> {
  return {
    "already-answered": 0,
    "already-resolved": 0,
    "already-worked": 0,
    "answered-in-thread": 0,
    "blocked-on-human": 0,
    "deliberately-ignored": 0,
    "deliberately-ignored-conversation": 0,
    "in-flight": 0,
    "not-addressed": 0,
    "terminal-lifecycle": 0,
    "too-old": 0,
    "wrong-place": 0,
  };
}
