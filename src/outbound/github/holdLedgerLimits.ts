/**
 * The hold ledger's default read window, and nothing else.
 *
 * A LEAF on purpose: `slopweaver github hold`'s usage line quotes it, and that line is read on every invocation through
 * the manifest barrel, while `holdLedgerStore.ts` reaches zod. Keep it importing nothing
 * (`src/__tests__/unit/cli/manifestBarrelClosure.test.ts` pins it as a shared leaf).
 */

/** How many rows `--history` reports when no bound is asked for — one busy shift's worth, not a whole install. */
export const HOLD_LEDGER_DEFAULT_LIMIT = 20;
