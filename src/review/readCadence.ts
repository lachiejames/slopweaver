/**
 * How long one landing-register selection's fleet read holds — its default and its ceiling — and nothing else.
 *
 * A LEAF on purpose: `slopweaver github landing`'s usage line quotes both, and that line is read on every invocation
 * through the manifest barrel, while `readJournal.ts` reaches zod. Keep it importing nothing
 * (`src/__tests__/unit/cli/manifestBarrelClosure.test.ts` pins it as a shared leaf).
 */

/**
 * How long one selection's fleet read holds, in minutes.
 *
 * Chosen against the failure rather than against a budget: it turns *days* — how long a pull request can sit
 * evicted and conflicted — into half an hour, at two reads an hour. For scale, the one fleet `compare` the read makes
 * costs `rateLimit.cost` 1 of an hourly 5,000. Overridable per invocation with `--cadence-minutes`.
 */
export const DEFAULT_CADENCE_MINUTES = 30;

/**
 * The largest cadence `--cadence-minutes` accepts, in minutes — seven days.
 *
 * A bound rather than a taste: past it the flag stops rationing and becomes an outage, which is the failure
 * this register was written for (a pull request sat evicted and conflicted for DAYS). A week is
 * chosen generously so a deliberate long window is still expressible, and it is a REFUSAL naming the flag
 * rather than a clamp, because an operator who typed the wrong number has to learn which number was wrong.
 *
 * It also closes a crash. MEASURED against a throwaway home holding one read entry:
 * `slopweaver github landing --repo lachiejames/slopweaver --if-due --cadence-minutes 999999999999 --home $H`
 * exited 1 printing only `Invalid time value`, because {@link readDue}'s skip arm rendered a `nextDueAtIso`
 * outside the ECMAScript Date range. `--cadence-minutes 60` on the same home exits 0 and skips cleanly.
 */
export const MAX_CADENCE_MINUTES = 7 * 24 * 60;
