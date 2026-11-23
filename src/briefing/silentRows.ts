/**
 * The GONE-QUIET half of the briefing gate: a page that does not surface a standing row which has stopped
 * posting is refused.
 *
 * MEASURED: `vulnfix-digest-acme-admin` — a daily vulnerability digest the owner asked for by name so that
 * the owner would SEE those pull requests first-hand — posted nothing for two days, and nothing anywhere
 * reported it. Not the register, not the briefing, not the owner's feed. The measurement was sitting in
 * `automation due --json` the whole time (`band: "overdue"`); no reader carried it to the owner. So a row
 * that has stopped and a row that is fine looked identical on every surface the owner reads.
 *
 * ## Why a gate rather than a step in the sweep contract
 *
 * The same reason `./blockedAsks.ts` gives, and this finding is its second proof. A briefing tick has a
 * dozen reads to make and the one that gets dropped is the one nothing checks — for two days running, the
 * thing that was dropped here was noticing at all. A page is REFUSED rather than a composer reminded.
 *
 * ## Matched on the recipe id, which is the falsifiable handle
 *
 * A card is prose, so "does this page mention that the digest has stopped" cannot be answered by reading its
 * words. What CAN be answered exactly is whether the page names the row: a recipe id is a literal string a
 * composer pastes, and nothing else on the page produces one by accident. Scoped to the REACT-NOW block for
 * the same reason `./blockedAsks.ts` is — the owner looks there most — and
 * because a stopped daily row named only inside a collapsed fold is a stopped row the owner does not see.
 *
 * Pure: the page's HTML and the silent rows go in, defects come out. The CLI edge does the measuring, exactly
 * as it already reads the ask-lifecycle log for the blocked half.
 */

import type { SilentRow } from "../live/automation/silentRows.js";
import { reactNowRegion } from "./reactNowCard.js";

/**
 * One standing row the page failed to surface.
 *
 * @internal — the row shape {@link checkSilentRows} returns; `./check.ts` renders it and no other caller
 * names it directly.
 */
export interface SilentRowDefect {
  readonly recipeId: string;
  readonly reason: string;
}

/** What checking one briefing page against the rows that have gone quiet found. */
export interface SilentRowCheck {
  /**
   * How many silent rows were checked — zero when every standing row is posting, which is the common case.
   *
   * It is a COUNT rather than a boolean, and that is this finding's own lesson applied to its own fix: a
   * summary saying "no silent rows" would read identically whether the leg found none or never ran, which
   * is precisely the confusion — "has not run for two days" and "ran twice, fine" rendering the same — that
   * this whole check exists to end.
   */
  readonly rowsChecked: number;
  readonly defects: readonly SilentRowDefect[];
}

/**
 * The empty result — what {@link checkSilentRows} returns when the caller could supply no rows at all.
 *
 * A caller with no scheduled rows and a caller with an unreadable recipe store are the same value here, and
 * that is the conservative reading rather than a gap: this half can only ever ADD a refusal, so a missing
 * input makes it silent instead of making it guess a page is wrong.
 *
 * @internal — `./check.ts` uses it for the no-rows arm; no other caller names it.
 */
export const NO_SILENT_ROWS: SilentRowCheck = { defects: [], rowsChecked: 0 };

/**
 * Refuse a briefing page whose react-now block does not name every standing row that has gone quiet.
 *
 * @param silent every scheduled row past its own silence threshold, from `live/automation/silentRows.ts`
 * @param html the whole artifact file
 * @returns how many silent rows were checked, and every one the page did not surface
 */
export function checkSilentRows({ silent, html }: { silent: readonly SilentRow[]; html: string }): SilentRowCheck {
  // A page with no react-now block at all has no region to search, so every silent row is unsurfaced — the
  // honest answer rather than a coalesce, and `./shape.ts` is already refusing the page for the missing
  // heading separately.
  const region = reactNowRegion({ html }).block;
  const defects = silent
    .filter((row) => region?.includes(row.recipeId) !== true)
    .map((row): SilentRowDefect => ({
      reason:
        `the scheduled row \`${row.recipeId}\` has stopped posting (${row.reason}) and react-now does not ` +
        `name it — ${row.detail}. Name it anywhere in react-now, so the owner learns it went quiet from the page ` +
        "already being read rather than from noticing the absence. ONE card may carry several rows, " +
        "and a card's own fold counts — this checks the whole block, so the ids belong behind the fold and " +
        "the count in front of it rather than one card per row.",
      recipeId: row.recipeId,
    }));
  return { defects, rowsChecked: silent.length };
}
