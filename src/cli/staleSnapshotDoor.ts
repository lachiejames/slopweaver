/**
 * The stale-snapshot gate at the briefing door that publishes a page.
 *
 * `../briefing/snapshotAge.ts` decides whether a half the page is built on is too old; this is the seam
 * that names the refusal and reads the one break-glass, so the verb itself never authors a refusal string.
 * Same shape as `./prPremiseDoor.ts` and `./bareRefDoor.ts`, and for the reason their headers give: the
 * override is a decision ONE invocation makes, which an always-on schema could not honour and a config file
 * would apply too broadly.
 *
 * **The hatch does not make the staleness invisible.** A run that takes it still publishes, and the page
 * stamps each stale half's own age above the fold in red (`../outbound/briefing/render.ts`). That pairing is
 * the whole point: the failure this gate exists to close was a stale half rendering as a fresh page, and a
 * hatch that merely silenced the check would reproduce it on demand.
 */

import { type StaleSnapshot, staleSnapshotClause } from "../briefing/snapshotAge.js";
import { hatchOpen } from "../hatch/open.js";
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { hatchRefusalLines } from "../hatch/render.js";
import type { EscapeHatch } from "../hatch/types.js";

/**
 * This door's register row — the per-invocation break-glass that publishes the page anyway, with each stale
 * half's age stamped on it. The row is OUTBOUND, so its lane is journalled and it opens on
 * a `hatch open stale-snapshot` grant alone.
 *
 * Found by id rather than by position, and asserted non-null: the row is declared in
 * `../hatch/registry.ts` and the id is typed against it, so an absent one is a broken register rather than a
 * state this module can be in.
 */
const STALE_SNAPSHOT_HATCH: EscapeHatch = ESCAPE_HATCHES.find((hatch) => hatch.id === "stale-snapshot")!;

/**
 * Why this run will not publish, and how to publish anyway — the register's own four lines.
 *
 * The detail names the FLAG and the path rather than the page's words, because the reader is an operator in
 * a terminal who has to go and fix a publish chain, not the owner reading the artifact.
 *
 * @param stale every half of the page that is past the ceiling, in the order the run judged them
 * @returns the refusal's lines
 */
export function staleSnapshotRefusalLines({ stale }: { stale: readonly StaleSnapshot[] }): readonly string[] {
  const detail = stale
    .map(
      (one) =>
        `${one.flag} ${one.source} was taken ${one.takenIso} — ` +
        staleSnapshotClause({ ageMs: one.ageMs, label: one.label }),
    )
    .join("; ");
  return hatchRefusalLines({ detail, hatch: STALE_SNAPSHOT_HATCH });
}

/**
 * Whether this render is refused for a stale half, and what to print when it is.
 *
 * The hatch is read HERE rather than at the verb's seams, because opening it takes the home and the render's
 * own instant — a journalled grant is scoped to a home and expires — and neither exists when the verb builds
 * its dependencies. Taking it does not silence the check: the run still carries every verdict into the page,
 * which stamps each stale half's age above the fold.
 *
 * @param stale every half past the ceiling, in the order the run judged them
 * @param env the process environment, which names the session a grant was issued to
 * @param home the resolved state home a journalled grant is scoped to
 * @param nowIso this render's own instant, which decides whether a grant has expired
 * @returns the refusal's lines, empty when nothing is stale or the hatch is open
 */
export function staleSnapshotRefusal({
  stale,
  env,
  home,
  nowIso,
}: {
  stale: readonly StaleSnapshot[];
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  nowIso: string;
}): readonly string[] {
  if (stale.length === 0) {
    return [];
  }
  if (hatchOpen({ env, home, id: "stale-snapshot", nowIso })) {
    return [];
  }
  return staleSnapshotRefusalLines({ stale });
}
