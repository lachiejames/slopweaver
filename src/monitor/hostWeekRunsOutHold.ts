/**
 * How `host-week-runs-out` HOLDS an open card without letting the looser bar raise a new one.
 *
 * {@link PLAN_WEEK_HOLDING} exists so a projection on the margin cannot flicker one note into three. It must never do
 * the opposite: admit something the opening bar would not, and so change the card. Two ways it could, each closed
 * here:
 *
 * - **A lapsed card holds nothing.** Its key's hour has passed, so the same pass settles it; holding on its account
 *   would fire a marginal projection that then posts as a fresh card.
 * - **The looser bar applies only to what the card already names.** A model host clear at the opening bar but at risk
 *   at the holding one joins the fold only when that keeps the open card's revision — never as a newcomer, which
 *   would re-cut the card on a projection that could not have opened one.
 *
 * Pure: open step ids and both projections in, the projections to fold out.
 */
import { drySpellKeyLapsesAt, drySpellKeyRevision } from "./fleetRunsDry.js";
import { type PlanWeekProjections, planWeekKey } from "./hostWeekRunsOut.js";
import { occurrenceBase } from "./registry.js";

/** The model hosts a fold covers, in a fixed order. */
const HOSTS = ["claude", "codex"] as const;

/**
 * The revisions of this monitor's open cards that are still held this pass — a card whose key has lapsed by `nowIso`
 * is settled by the same pass, so it holds nothing.
 *
 * @param openIds every open hand-step id
 * @param stepPrefix the id prefix this monitor's cards carry, `mon-planweek-`
 * @param nowIso the judged instant
 * @returns each unlapsed open card's revision; empty when no card is held
 */
export function planWeekHeldRevisions({
  nowIso,
  openIds,
  stepPrefix,
}: {
  nowIso: string;
  openIds: readonly string[];
  stepPrefix: string;
}): readonly string[] {
  const nowMs = Date.parse(nowIso);
  return openIds.flatMap((id) => {
    if (!id.startsWith(stepPrefix)) {
      return [];
    }
    const key = occurrenceBase({ id }).slice(stepPrefix.length);
    const lapse = drySpellKeyLapsesAt({ key });
    const revision = drySpellKeyRevision({ key });
    if (revision === undefined || (lapse !== undefined && Date.parse(lapse) <= nowMs)) {
      return [];
    }
    return [revision];
  });
}

/** The revision a fold would key on, or undefined when it holds no spell. */
function revisionOf({ projections }: { projections: PlanWeekProjections }): string | undefined {
  const spells = HOSTS.flatMap((host) => {
    const projection = projections[host];
    return projection.kind === "at-risk" ? [projection.spell] : [];
  });
  if (spells.length === 0) {
    return undefined;
  }
  return drySpellKeyRevision({ key: planWeekKey({ spells }) });
}

/**
 * The projections to fold while a card is held: each model host at the opening bar, plus a host at risk only at the
 * holding bar when — and only when — including it keeps a held card's revision. The widest such set wins, so a card
 * naming both hosts is held whole.
 *
 * @param opening both projections at {@link PLAN_WEEK_OPENING}
 * @param holding both projections at {@link PLAN_WEEK_HOLDING}
 * @param heldRevisions {@link planWeekHeldRevisions}'s answer
 * @returns the projections whose fold holds the open card, else the opening ones
 */
export function heldPlanWeek({
  heldRevisions,
  holding,
  opening,
}: {
  heldRevisions: readonly string[];
  holding: PlanWeekProjections;
  opening: PlanWeekProjections;
}): PlanWeekProjections {
  const marginal = HOSTS.filter((host) => opening[host].kind !== "at-risk" && holding[host].kind === "at-risk");
  // Every subset of the marginal hosts, widest first: at most two hosts, so at most four candidates.
  let grown: (typeof HOSTS)[number][][] = [[]];
  for (const host of marginal) {
    grown = grown.concat(grown.map((subset) => [...subset, host]));
  }
  const subsets = grown.toSorted((left, right) => right.length - left.length);
  for (const subset of subsets) {
    if (subset.length === 0) {
      continue;
    }
    const candidate: PlanWeekProjections = {
      claude: subset.includes("claude") ? holding.claude : opening.claude,
      codex: subset.includes("codex") ? holding.codex : opening.codex,
    };
    const revision = revisionOf({ projections: candidate });
    if (revision !== undefined && heldRevisions.includes(revision)) {
      return candidate;
    }
  }
  return opening;
}
