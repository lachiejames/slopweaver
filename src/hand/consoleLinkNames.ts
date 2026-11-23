/**
 * The names a minted console link shares with the page that reads it — its two parameters, its contexts and
 * the record kinds a row key may name.
 *
 * They mirror `site/lib/workContext.ts` (`OPEN_PARAM`, `CONTEXT_PARAM`, `WorkContext`) and
 * `site/lib/queueRows.ts`'s row keys: `src/` cannot import across the site root, so
 * `site/__tests__/unit/consoleLinkMirror.test.ts` binds the two. This module imports NOTHING on purpose —
 * that test runs in the site's own install, which has none of `src/`'s dependencies, and the site build
 * type-checks it (a `neverthrow` import reached through `./consoleLink.ts` fails CI's `site` leg).
 */

/**
 * The two work contexts a link can carry — the console's own ids, restated as `./step.ts` restates them for
 * the same reason (the site root cannot be imported), and kept here rather than exported from there.
 */
export type LinkContext = "slopweaver" | "work";

/**
 * Whether a flag's raw value is a context a link can carry.
 *
 * @returns true for `slopweaver` or `work`
 */
export function isLinkContext(value: unknown): value is LinkContext {
  return value === "slopweaver" || value === "work";
}

/** The parameter naming the open row — mirrors the site's `OPEN_PARAM`. */
export const OPEN_PARAM = "open";

/** The parameter naming the work context — mirrors the site's `CONTEXT_PARAM`. */
export const CONTEXT_PARAM = "context";

/** The record kinds the queue opens by `<kind>:<id>` — mirrors `site/lib/queueRows.ts`'s row keys. */
export const QUEUE_KINDS = ["hand", "ask", "draft", "post", "review", "import", "pr", "act"] as const;
