/**
 * Shared CLI exit-code vocabulary.
 *
 * Most verbs follow the Unix convention: `0` = success, non-zero = something went wrong. But a
 * reliability harness that reads every non-zero exit as a verb FAULT over-counts two legitimate
 * non-zero shapes that are the verb working exactly as designed:
 *
 *  - `EXIT_USAGE` (2): the caller passed wrong/incomplete args; the verb refused and printed usage
 *    BEFORE its act phase. A caller mistake, not a verb malfunction.
 *  - `EXIT_EXPECTED_EMPTY` (3): the verb ran its full pipeline and is reporting a legitimate
 *    non-success STATUS — no results, nothing to do, a prerequisite absent. The non-zero exit is the
 *    SIGNAL (so `verb || alert` still fires), not a fault.
 *  - `EXIT_DEFERRED` (4): the verb declined to act YET, and wants to be run again unchanged.
 *
 * A code-`1` exit stays the "genuine runtime fault" channel (an unexpected error, a crash, a write
 * that failed). Keeping the meanings distinct lets a caller separate "this verb is flaky" from "this
 * verb correctly told me there was nothing to do".
 */

/** Success. */
export const EXIT_OK = 0;

/** A genuine runtime fault. */
export const EXIT_ERROR = 1;

/** Arg/usage rejection: the verb refused a wrong/incomplete invocation before its act phase. */
export const EXIT_USAGE = 2;

/**
 * Expected-empty / nothing-to-do / prerequisite-absent / legitimate-non-success-status. The verb ran
 * correctly; the non-zero exit is a deliberate signal, not a fault.
 */
export const EXIT_EXPECTED_EMPTY = 3;

/**
 * NOT YET. The verb ran, found a prerequisite still IN PROGRESS, and deliberately did nothing so that
 * running it again unchanged is the correct next move.
 *
 * Distinct from {@link EXIT_EXPECTED_EMPTY}, and the distinction is the whole reason it exists: a
 * scheduler stamps an expected-empty row as having run — it did its work and there was none — while a
 * DEFERRED row has not done its work at all, so stamping it would silence it until its next firing. That
 * is what happened to the vulnerability-fix digest: it composed while the
 * top-up's own session was still opening the batch, posted three of ten, and no
 * second post ever went out. `automation run-due` and `automation claim` therefore leave a `4` unstamped.
 *
 * Distinct from {@link EXIT_ERROR} for the same reason in the other direction: nothing went wrong, so a
 * reliability harness must not count one as a fault.
 */
export const EXIT_DEFERRED = 4;
