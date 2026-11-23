/**
 * The bounds every section of the voice's context pack is written through: a passage cut at a character bound, a
 * list cut at a byte budget, each cut said in the text, and the day it looks back over. A leaf, so a section built
 * outside `./contextPack.ts` (`./packCheckIns.ts`, `./continuityRender.ts`, `./packRecentlyLeft.ts`) bounds itself
 * the same way without importing the pack that renders it.
 */

/** How far back the owner's turns, the landings and the cards that left their Queue reach. */
export const PACK_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an instant falls inside the look-back window ending at `nowIso`.
 *
 * @param atIso the instant to test
 * @param nowIso the end of the window
 * @returns whether it is no older than {@link PACK_LOOKBACK_MS}
 */
export function withinLookback({ atIso, nowIso }: { atIso: string; nowIso: string }): boolean {
  const at = Date.parse(atIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(at) || Number.isNaN(now)) {
    return false;
  }
  return now - at <= PACK_LOOKBACK_MS && at <= now;
}

/**
 * One passage flattened onto a line and cut at a character bound, the cut marked.
 *
 * @param text the passage
 * @param max the most characters kept
 * @returns the flattened, bounded passage
 */
export function clip({ text, max }: { text: string; max: number }): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, max)}…`;
}

/**
 * Fit rendered entries under a byte budget in order, and say how many did not fit.
 *
 * @param entries the rendered lines, most important first
 * @param budget the section's UTF-8 byte budget
 * @returns the lines that fit, then a line naming how many were left out
 */
export function fitSection({ entries, budget }: { entries: readonly string[]; budget: number }): readonly string[] {
  const kept: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(entry, "utf8") + 1;
    if (used + size > budget) {
      break;
    }
    kept.push(entry);
    used += size;
  }
  const left = entries.length - kept.length;
  if (left > 0) {
    kept.push(`(${String(left)} more not shown — this list is NOT complete; use the tools for the rest)`);
  }
  return kept;
}
