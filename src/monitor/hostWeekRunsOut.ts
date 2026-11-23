/**
 * `host-week-runs-out`: the Claude plans together, or the Codex plans together, are projected to run out for at
 * least {@link MIN_DRY_HOURS} before a reset relieves them — one folded card for whichever model hosts are at risk.
 *
 * ## The rule, and the false positives it rules out
 *
 * A floating note backed by a Queue card when EITHER model host's plans look like running out before the weekly reset,
 * and not when one of five plans quietly runs dry while the others take over: a flood of false positives trains the
 * owner to ignore the note. So:
 *
 * - **A model host, never a plan.** A spell is every routable plan of that host at its ceiling with demand left
 *   over, routed as its production router routes (`../capacity/weekRisk.ts`).
 * - **Projected below the trend.** A card OPENS only on a spell at {@link PLAN_WEEK_OPENING}'s share of trailing
 *   demand lasting {@link MIN_DRY_HOURS} or more. An open card is HELD on the looser {@link PLAN_WEEK_HOLDING}, so a
 *   projection on the margin cannot flicker one note into three.
 * - **Never repeated while it stands.** The key's revision is the at-risk model hosts and their routable plans with
 *   their ceilings — never a percentage, a demand or an instant — so the card is held while the same plans run out
 *   and re-cut only when that set changes; it lapses at the hour the projected spell ends.
 * - **Every gap is unmeasurable.** A stale reading, an unread plan, a series too short to give a rate: never clear and
 *   never a card. One model host unmeasurable beside the other at risk is the card, with the gap as its blind spot.
 *
 * `fleet-runs-dry` stays the MEASURED card — every plan of both model hosts spent now. This one is the projection.
 *
 * ## The card offers what the owner can choose, and never a purchase
 *
 * No sixth plan, and a free reset is the chair's own claim (`codex reset --at-limit`), never a
 * click handed to the owner. What the owner decides is which work waits.
 *
 * A card that asks defer-or-keep-pace without the calculation cannot be answered. So every plan line carries its room
 * before its reset, what the routed draw does with it, and its free resets held and claimed; the basis line carries the
 * week's need and what is left unspent. The lean is to not hold off on work: use every plan and the resets that are
 * available.
 *
 * Pure: two projections in, a monitor reading out.
 */
import { sha256Text } from "#lib/hash.js";

import {
  type HostDrySpell,
  type HostWeekProjection,
  WEEK_RISK_DEMAND_GUARD,
  type WeekRiskCriterion,
} from "../capacity/weekRisk.js";
import { checkedHandDecision, type HandDecisionContext } from "../hand/decisionContext.js";
import { checkedDetails } from "../hand/details.js";

import { MIN_DRY_HOURS } from "./fleetRunsDry.js";
import { minute } from "./fleetRunsDryDetails.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** What opens a card: a spell at the guarded share of trailing demand, at least {@link MIN_DRY_HOURS} long. */
export const PLAN_WEEK_OPENING: WeekRiskCriterion = { demandShare: WEEK_RISK_DEMAND_GUARD, minDryHours: MIN_DRY_HOURS };

/** What holds an open card: any whole dry hour still projected at the full trailing rate. */
export const PLAN_WEEK_HOLDING: WeekRiskCriterion = { demandShare: 1, minDryHours: 1 };

/** Hex characters of the identity digest a key carries: 64 bits, as `fleet-runs-dry`'s keys carry. */
const REVISION_LENGTH = 16;

/** Both projections, by model host. */
export interface PlanWeekProjections {
  readonly claude: HostWeekProjection;
  readonly codex: HostWeekProjection;
}

/** A model host's name as a card prints it. */
function hostName({ spell }: { spell: HostDrySpell }): string {
  return spell.host === "claude" ? "Claude" : "Codex";
}

/**
 * The stable key of a folded card: the hour the earliest projected spell ends, and a digest of what the card is
 * about. Read back by `fleet-runs-dry`'s own `drySpellKeyLapsesAt` and `drySpellKeyRevision`, so one key grammar
 * serves both dry cards.
 *
 * @param spells the at-risk model hosts' spells
 * @returns `until-<yyyy-mm-dd>t<hh>-r<revision>`
 */
export function planWeekKey({ spells }: { spells: readonly HostDrySpell[] }): string {
  const identity = spells.flatMap((spell) => spell.identity).toSorted();
  const revision = sha256Text({ text: identity.join(",") })
    .slice("sha256:".length)
    .slice(0, REVISION_LENGTH);
  const endMs = Math.min(...spells.map((spell) => Date.parse(spell.endIso)));
  const hour = new Date(endMs).toISOString().slice(0, 13).toLowerCase();
  return `until-${hour}-r${revision}`;
}

/** The decision a folded card asks the owner for. */
function decisionOf({ spells }: { spells: readonly HostDrySpell[] }): HandDecisionContext {
  const first = spells.toSorted((left, right) => Date.parse(left.startIso) - Date.parse(right.startIso))[0]!;
  const names = spells.map((spell) => hostName({ spell })).join(" and ");
  const gap = `about ${String(first.hours)}h from ${minute({ iso: first.startIso })}`;
  return {
    lean: `Keep the pace: this already fills every routable ${names} plan and claims each free reset the chair may, so deferring leaves usage unspent if the trend is wrong.`,
    options: [
      {
        letter: "A",
        option: "Keep today's pace and accept the gap",
        tradeoff: `no ${hostName({ spell: first })} seat starts for ${gap}, if the trend holds`,
      },
      {
        letter: "B",
        option: "Defer the least urgent work until the reset",
        tradeoff: `the work you name waits, and the ${names} plans carry what stays through the week`,
      },
    ],
    problem: `The ${names} plans are projected to run out for ${gap}, before ${first.endedById}'s reset at ${minute({ iso: first.endIso })}.`,
    stakes: {
      blastRadius: `Every ${names} seat in that gap; the other model host's seats are not affected by this projection.`,
      risk: "A projection off the trailing week's draw, run below it so ordinary noise does not trip it; a heavier week runs out sooner.",
      stillReal:
        "Re-projected every chair tick from the newest capacity reading; the card clears itself once no gap is projected.",
    },
  };
}

/** A projection that is not at risk, as a blind-spot or unmeasurable clause. */
function gapOf({ name, projection }: { name: string; projection: HostWeekProjection }): string | undefined {
  return projection.kind === "unmeasurable" ? `${name} not projected: ${projection.why}` : undefined;
}

/**
 * Project both model hosts' projections onto `host-week-runs-out`'s reading.
 *
 * @param projections what each model host's projection concluded
 * @returns firing on any at-risk model host, clear when both are clear, else unmeasurable naming each gap
 */
export function hostWeekRunsOutReading({ projections }: { projections: PlanWeekProjections }): MonitorReading {
  const spells = [projections.claude, projections.codex].flatMap((projection) =>
    projection.kind === "at-risk" ? [projection.spell] : [],
  );
  const gaps = [
    gapOf({ name: "Claude", projection: projections.claude }),
    gapOf({ name: "Codex", projection: projections.codex }),
  ].filter((gap): gap is string => gap !== undefined);
  if (spells.length === 0) {
    if (gaps.length > 0) {
      return { because: gaps.join("; "), monitorId: "host-week-runs-out", state: "unmeasurable" };
    }
    const evidence = [projections.claude, projections.codex].flatMap((projection) =>
      projection.kind === "clear" && projection.lines !== undefined ? projection.lines : [],
    );
    return {
      ...(evidence.length === 0 ? {} : { evidence }),
      monitorId: "host-week-runs-out",
      state: "clear",
    };
  }
  const decision = decisionOf({ spells });
  const checked = checkedHandDecision({ value: decision });
  if (checked.isErr()) {
    return { because: checked.error.message, monitorId: "host-week-runs-out", state: "unmeasurable" };
  }
  const details = spells.flatMap((spell) => [spell.basis, ...spell.planLines]);
  // A card that cannot list every plan of an at-risk model host whole reads unmeasurable, never a shortened list.
  const postable = checkedDetails({ value: details });
  if (postable.isErr()) {
    return {
      because: `the projection's evidence cannot go on a card whole: ${postable.error.message}`,
      monitorId: "host-week-runs-out",
      state: "unmeasurable",
    };
  }
  const names = spells.map((spell) => hostName({ spell })).join(" and ");
  const subject: MonitorSubject = {
    decision,
    details,
    id: `the ${names} plans' week`,
    key: planWeekKey({ spells }),
    label: `${names} projected to run out for about ${String(spells[0]!.hours)}h before a reset`,
  };
  return {
    ...(gaps.length === 0 ? {} : { blindSpot: gaps.join("; ") }),
    monitorId: "host-week-runs-out",
    state: "firing",
    subjects: [subject],
  };
}
