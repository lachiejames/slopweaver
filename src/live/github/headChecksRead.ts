/**
 * Whether a pull request's head checks were READ — one type, in a leaf with no imports on purpose. Both
 * `../../review/` (the landing and review-state verdicts) and this directory (`./reviewStateChecks.ts`, which
 * produces it, and `./reviewState.ts`, which carries it) read it, so neither side imports the other for it.
 * `./checksRead.ts` is a different module: the paged whole-checks read.
 */

/**
 * Whether the checks on the head were READ at all, as distinct from there being none.
 *
 * Two facts that looked identical and are opposite: a pull request that genuinely touches
 * no CI-covered path has zero checks and that is a complete answer, while a rollup this read could not parse
 * has zero checks and is no answer whatsoever. Both produced the same empty snapshot, so a consumer had no
 * way to tell "nothing runs on it" from "we could not look".
 */
export type ChecksRead = { readonly kind: "read" } | { readonly kind: "unread"; readonly why: string };
