/**
 * The Codex review leftovers section read back: the inverse of `./render.ts`'s leftovers block.
 *
 * Optional, so a body with no section consumes nothing. The entries are read by the landing verbs' own reader
 * (`../../codex/reviewLeftovers.ts`), so the two never disagree, and `./parse.ts`'s byte comparison after the
 * re-render is what refuses a line in any other spelling.
 */
import { ok, type Result } from "#lib/result.js";
import type { ReadingOrderError } from "./errors.js";
import { LEFTOVERS_HEADING, namedLeftovers } from "./leftoverLines.js";
import { type Cursor, stop, take, takeLiteral } from "./parseCursor.js";
import { leftoversOpen } from "./render.js";
import type { ReviewLeftoverEntry } from "./types.js";

/**
 * The Codex review leftovers after the risk, when the body carries them: the heading, the folded opening, the
 * entry lines and the close.
 *
 * @param cursor the reading position, just past the risk section
 * @returns the entries the section names, `undefined` when the body carries no section, or a `STRUCTURE`
 *   refusal for a section that is there and does not read
 */
export function leftoversSection({
  cursor,
}: {
  cursor: Cursor;
}): Result<ReviewLeftoverEntry[] | undefined, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LEFTOVERS_HEADING })) {
    return ok(undefined);
  }
  const open = take({ cursor });
  const lines = take({ cursor });
  const close = take({ cursor });
  if (open === undefined || lines === undefined || close !== "</details>") {
    return stop({ at: "the Codex review leftovers" });
  }
  const entries = namedLeftovers({ body: `${LEFTOVERS_HEADING}\n${lines}` }).map((entry) => ({ ...entry }));
  if (entries.length === 0 || open !== leftoversOpen({ count: entries.length })) {
    return stop({ at: "the Codex review leftovers" });
  }
  return ok(entries);
}
