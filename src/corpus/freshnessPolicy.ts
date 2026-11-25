/**
 * How stale each fetchable corpus source may get before a scheduled pass brings it current.
 *
 * The atlas half of this policy lives on the descriptor
 * (`atlas/kit/freshnessWindow.ts`: four hours by default, per atlas by declaration). The same logic applies
 * to BOTH halves: per-source windows defaulting to four hours. `refresh --if-stale` takes its threshold
 * from whatever `--stale-after` a caller types, so without a declaration the policy would live in the invocation
 * rather than in the repository and no reader could ask what it was.
 *
 * This is that declaration. It is deliberately NOT what `retrieval/justInTime.ts` judges a recency question
 * against: that gate's `BEHIND_AFTER_MINUTES` stays four hours for every source, because a question about
 * this afternoon needs this afternoon's data whatever the background cadence is. The two are a pair — a
 * source scheduled every twelve hours leans on the gate to catch the question that cannot wait, which is
 * what makes a slower cadence cheap rather than lossy.
 *
 * ## Why a source declares its own
 *
 * The shape is per-source rather than one constant because the sources genuinely differ — a mailbox and a
 * meeting recorder move on nothing like a shared repository's cadence — and the alternative is that a
 * source needing a different window gets it written into a scheduled row instead, outside the repository,
 * where nothing reviews it. An override belongs here, beside the default it replaces.
 */
import type { CorpusSource } from "./types.js";

/**
 * The window a corpus source that declares none is judged against.
 *
 * @internal
 */
export const DEFAULT_CORPUS_FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Sources whose own cadence differs from the default.
 *
 * The four-hour default is an unmeasured starting number, tuned per source once the syncs work. MEASURED on the cadence page
 * (`$SLOPWEAVER_HOME/pages/scheduled-asks-cadence/index.html`, repro there), per source — rows a sync
 * brought, and who reads it:
 *
 * - notion: a median of 3 new rows per sync, read only by the bot's store search, so eight hours.
 * - gmail: a median of 0 new rows, and `session-start` reads the mailbox LIVE rather than the corpus, so
 *   twelve hours.
 * - calendar: every calendar verb reads Google live, and the corpus drew 4 reads in fourteen days, so daily.
 * - outlook: UNMEASURED, given Gmail's twelve hours because its verbs also read the mailbox live; re-measure
 *   once it has synced a fortnight.
 * - outlook-calendar: UNMEASURED, given the Google diary's day because its verbs also read live; re-measure
 *   once it has synced a fortnight.
 * - fathom: 0 new rows in every captured sync, since a share link arrives by mail, so daily.
 * - chatgpt: new rows arrive only when the owner downloads a fresh export, so a sync more often than daily reads the
 *   same archive again.
 *
 * None goes past a day: every corpus is fresh within 24 hours. Slack,
 * GitHub and Linear keep the default — each brings hundreds of rows a sync and feeds the cards the owner opens.
 */
const CORPUS_FRESHNESS_OVERRIDES: Readonly<Partial<Record<CorpusSource, number>>> = {
  calendar: 24 * HOUR_MS,
  chatgpt: 24 * HOUR_MS,
  fathom: 24 * HOUR_MS,
  gmail: 12 * HOUR_MS,
  notion: 8 * HOUR_MS,
  outlook: 12 * HOUR_MS,
  "outlook-calendar": 24 * HOUR_MS,
};

/**
 * The window one corpus source is judged against: its own override, or the default for a source that
 * declares none — which is what an absent entry in {@link CORPUS_FRESHNESS_OVERRIDES} means by design.
 *
 * @param source the source whose policy is being read
 * @returns the window in milliseconds
 */
export function corpusFreshnessWindowMs({ source }: { readonly source: CorpusSource }): number {
  const override = CORPUS_FRESHNESS_OVERRIDES[source];
  if (override === undefined) {
    return DEFAULT_CORPUS_FRESHNESS_WINDOW_MS;
  }
  return override;
}
