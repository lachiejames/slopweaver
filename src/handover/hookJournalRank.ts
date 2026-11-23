/**
 * Which run journals the run hooks examine, chosen BEFORE the cap rather than by it — and how the omission is said.
 *
 * ## The defect this closes
 *
 * The hooks fully parse at most {@link MAX_HOOK_JOURNALS} journals, a bound the 10-second deadline needs. That
 * cap used to be applied to the slugs in ALPHABETICAL order: with 203 journals on disk, and 407 later (
 * `ls "$SLOPWEAVER_HOME/runs" | grep -c jsonl`), the SessionStart/PostCompact brief and the Stop gate only ever saw
 * the first 24 names, so a session whose run sorted after them got no Stop gate and no start brief — and nothing
 * said a journal had been skipped.
 *
 * ## The order, and what it does NOT claim
 *
 * 1. `held` — runs the hooked session HOLDS and has not closed, proven by the real folds (`runOwnership`,
 *    `runStateOf`) over a journal whose bytes name the session as a `sessionId`. Merely MENTIONING the session
 *    is not enough: a session that released two dozen runs would otherwise crowd the one it holds out of the
 *    cap (found by this change's r1 review, with a counterexample).
 * 2. `mentioned` — a journal naming the session that the pre-parse byte budget did not reach, so nothing
 *    proved whether it is held. Ranked above the rest because it might be.
 * 3. `other` — everything else. Each tier goes newest-written first: recency is the bounded proxy for "open",
 *    since a phase is only known once a journal is parsed and parsing every journal is the cost the cap exists
 *    to avoid. A last-line shortcut would be a second, partial lifecycle definition, so there is none.
 *
 * Slug breaks a tie, deterministically.
 *
 * Pure: the effectful pre-pass that measures each journal is `./hookJournalScan.ts`.
 */

/**
 * The most journals one hook invocation fully parses.
 *
 * Bounds the I/O before any git call: an adversarial pass found journal discovery, reading and parsing
 * unbounded, so a large enough runs directory blew the deadline before the gate was reached — and a cancelled
 * hook fails CLOSED. A journal past the cap is not reported, so it cannot block; the count of them IS reported.
 */
export const MAX_HOOK_JOURNALS = 24;

/** How strongly the pre-pass ties a journal to the hooked session — the ranking's first key, in this order. */
const JOURNAL_TIERS = ["held", "mentioned", "other"] as const;

/** One of {@link JOURNAL_TIERS}. */
export type JournalTier = (typeof JOURNAL_TIERS)[number];

/** One journal as the cheap pre-pass measured it. */
export interface JournalRankEntry {
  readonly slug: string;
  /** The journal file's modification time, the recency signal. */
  readonly mtimeMs: number;
  readonly tier: JournalTier;
}

/** How much of the runs directory a hook invocation did NOT examine, and why. */
export interface JournalSkipSummary {
  readonly cap: number;
  /** Readable journals ranked below the cap. */
  readonly skippedBeyondCap: number;
  /** Journals oversized, unstattable or unreadable before ranking — never counted against the cap. */
  readonly skippedUnavailable: number;
}

/** Tier, then newest first, then slug — the order documented above. */
function compareEntries({ a, b }: { a: JournalRankEntry; b: JournalRankEntry }): number {
  if (a.tier !== b.tier) {
    return JOURNAL_TIERS.indexOf(a.tier) - JOURNAL_TIERS.indexOf(b.tier);
  }
  if (a.mtimeMs !== b.mtimeMs) {
    return b.mtimeMs - a.mtimeMs;
  }
  if (a.slug === b.slug) {
    return 0;
  }
  return a.slug < b.slug ? -1 : 1;
}

/**
 * Rank journals and keep the first `cap`.
 *
 * @param entries every readable journal the pre-pass measured
 * @param cap how many to keep
 * @returns the kept slugs in rank order, and how many ranked below the cap
 */
export function rankJournals({ entries, cap }: { entries: readonly JournalRankEntry[]; cap: number }): {
  readonly considered: readonly string[];
  readonly skippedBeyondCap: number;
} {
  const considered = entries
    .toSorted((a, b) => compareEntries({ a, b }))
    .slice(0, cap)
    .map((entry) => entry.slug);
  return { considered, skippedBeyondCap: entries.length - considered.length };
}

/**
 * The lines that say what a hook invocation did not examine — empty when it examined everything.
 *
 * Never calls a skipped journal open or closed: nothing parsed it, so nothing knows.
 *
 * @param summary what the pre-pass skipped
 * @returns zero, one or two lines
 */
export function journalSkipLines({ summary }: { summary: JournalSkipSummary }): readonly string[] {
  const lines: string[] = [];
  if (summary.skippedBeyondCap > 0) {
    lines.push(
      `ℹ ${String(summary.skippedBeyondCap)} run journal(s) ranked below the ${String(summary.cap)} examined (this session's own first, then most recently written) were NOT checked by this hook; \`slopweaver handover list\` reads them all.`,
    );
  }
  if (summary.skippedUnavailable > 0) {
    lines.push(
      `ℹ ${String(summary.skippedUnavailable)} further run journal(s) were oversized or unreadable and were NOT checked by this hook.`,
    );
  }
  return lines;
}
