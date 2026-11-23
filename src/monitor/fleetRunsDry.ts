/**
 * `fleet-runs-dry`: no routable Claude or Codex plan can start a seat until a reset, measured, for at least
 * {@link MIN_DRY_HOURS} — the card a {@link FleetDryAssessment} becomes.
 *
 * ## Why the FLEET and not one plan
 *
 * The owner wants a note only when a plan or the fleet is projected to cap before its reset. A single plan
 * capping is a routing outcome the next spawn already steps around — each provider's ranker skips a spent plan — so
 * it is the fleet's to fix, not a card (rule 10). Only the whole fleet out, every configured provider, is a decision
 * that is the owner's: how to ride out hours in which no seat can start.
 *
 * ## Both providers, off one reading
 *
 * The judgement is `./fleetRunsDryCeilings.ts`'s, over the latest filed `machine capacity` reading, which carries
 * every Claude and Codex plan's windows side by side. A snapshot proves the present for both providers; the
 * projected week, per model host, is `./hostWeekRunsOut.ts`'s card.
 *
 * ## The card offers what the owner can choose, and never a plan purchase
 *
 * No sixth plan: a cap is answered by token efficiency and routing. A free reset offered by a
 * provider's own page is left off: it is a click in a provider UI, which is never handed to the owner.
 *
 * Pure: an assessment and its reading in, a monitor reading out.
 */
import { sha256Text } from "#lib/hash.js";

import type { CeilingsReading } from "../capacity/ceilings.js";
import { checkedHandDecision, type HandDecisionContext } from "../hand/decisionContext.js";

import type { FleetDryAssessment, FleetDryInterval } from "./fleetRunsDryCeilings.js";
import { fleetDryDetails, minute } from "./fleetRunsDryDetails.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/**
 * A dry interval shorter than this is not carded: a five-hour window that resets inside it is a pause, not a
 * decision. MEASURED replaying the one-week Claude forecast every six hours over nine days: every
 * forecast that saw the trough whole gave it 5–11 dry hours, fading to 1–2 as demand dipped —
 * `slopweaver claude forecast --weeks 1 --now <instant> --json` ([11] on one run, [2] on a later one). The whole
 * replay: `skills/supervisor/reference/plan-survival.md` § The threshold.
 */
export const MIN_DRY_HOURS = 4;

/**
 * How many hex characters of the spent set's digest a key carries: 64 bits, since a shared prefix holds a stale card
 * over a different set.
 */
const REVISION_LENGTH = 16;

const HOUR_MS = 3_600_000;

/**
 * The stable, id-safe key of a dry interval: the hour of the reset that ends it, and a digest of which plans are
 * measured spent. The reset is a filed instant, so it does not move between passes over the same windows; the
 * digest is of ids only, never a percentage, so ordinary drift holds the card and a plan coming back or going out
 * re-cuts it ({@link drySpellKeyRevision}).
 *
 * @param interval the carded dry interval
 * @returns `until-<yyyy-mm-dd>t<hh>-r<revision>`
 */
export function fleetDryKey({ interval }: { interval: FleetDryInterval }): string {
  const revision = sha256Text({ text: interval.exhaustedCeilingIds.join(",") })
    .slice("sha256:".length)
    .slice(0, REVISION_LENGTH);
  const hour = new Date(Date.parse(interval.untilIso)).toISOString().slice(0, 13).toLowerCase();
  return `until-${hour}-r${revision}`;
}

/** A {@link fleetDryKey}: `until-<yyyy-mm-dd>t11-r1a2b3c4d`, or the older revision-less form. */
const HOUR_KEY = /^until-(\d{4}-\d{2}-\d{2})t(\d{2})(?:-r([0-9a-f]+))?$/;

/**
 * The instant a dry card's key says its interval is over, so a card outlives no watch that stopped. The hour is the
 * reset's own hour, floored, so a card lapses at most an hour early — when what is left is shorter than any
 * interval this monitor fires on.
 *
 * @param key a step key as {@link fleetDryKey} wrote it, either form
 * @returns the hour as ISO-8601, or `undefined` for a key naming no hour, which this monitor no longer writes
 */
export function drySpellKeyLapsesAt({ key }: { key: string }): string | undefined {
  const match = HOUR_KEY.exec(key);
  if (match === null) {
    return undefined;
  }
  return `${match[1]!}T${match[2]!}:00:00.000Z`;
}

/**
 * The revision a dry card's key carries — what the pass compares before holding an open card.
 *
 * @param key a step key as {@link fleetDryKey} wrote it
 * @returns the revision, or `undefined` for a key cut before keys carried one, so that card is re-cut once
 */
export function drySpellKeyRevision({ key }: { key: string }): string | undefined {
  return HOUR_KEY.exec(key)?.[3];
}

/**
 * How long an interval runs at least, whole hours rounded down, as a card says it: e.g. `at least 6h`. A lower
 * bound by construction — the interval ends at the first spent window's reset, and a plan also refused for a reason
 * the reading does not carry may stay out past it.
 */
function dryDuration({ interval }: { interval: FleetDryInterval }): string {
  const hours = Math.floor((Date.parse(interval.untilIso) - Date.parse(interval.fromIso)) / HOUR_MS);
  return `at least ${String(hours)}h`;
}

/** The decision one dry interval asks the owner for. */
function decisionOf({
  interval,
  reading,
}: {
  interval: FleetDryInterval;
  reading: CeilingsReading;
}): HandDecisionContext {
  const duration = dryDuration({ interval });
  const until = minute({ iso: interval.untilIso });
  return {
    lean: `Hold until the reset: no route opens before ${until}, and shedding a seat frees nothing a router can take.`,
    options: [
      {
        letter: "A",
        option: "Hold until the reset",
        tradeoff: `no Claude or Codex seat starts for ${duration}, and nothing extra is spent`,
      },
      {
        letter: "B",
        option: "Shed the least urgent seats until the reset",
        tradeoff: "the work you name waits, and no seat sits stalled on a spent plan meanwhile",
      },
    ],
    problem: `No measured provider route can start a seat for ${duration}; the first exhausted window resets at ${until}.`,
    stakes: {
      blastRadius: `Every Claude and Codex seat until at least ${until}: ${String(interval.exhaustedCeilingIds.length)} plans measured spent.`,
      risk: `Every provider-backed seat waits ${duration}, longer if a plan is also refused for another reason.`,
      stillReal: `Judged from the machine capacity reading observed ${minute({ iso: reading.observedAtIso })}; every plan and its reset is listed below.`,
    },
  };
}

/**
 * Project one assessment onto `fleet-runs-dry`'s reading.
 *
 * @param assessment what `assessFleetDry` concluded
 * @param reading the filed ceilings reading it concluded it from, which the card's details list
 * @returns firing on a dry interval, clear, or unmeasurable naming why
 */
export function fleetRunsDryReading({
  assessment,
  reading,
}: {
  assessment: FleetDryAssessment;
  reading: CeilingsReading;
}): MonitorReading {
  if (assessment.kind === "unmeasurable") {
    return { because: assessment.why, monitorId: "fleet-runs-dry", state: "unmeasurable" };
  }
  if (assessment.kind === "clear") {
    return { monitorId: "fleet-runs-dry", state: "clear" };
  }
  const { interval } = assessment;
  const decision = decisionOf({ interval, reading });
  const checked = checkedHandDecision({ value: decision });
  if (checked.isErr()) {
    // Every word above is fixed text, a count or an instant, so this is a declaration defect a unit test catches.
    return { because: checked.error.message, monitorId: "fleet-runs-dry", state: "unmeasurable" };
  }
  // A fleet the card cannot carry whole reads unmeasurable, never a card dropping or cutting a plan to fit.
  const listed = fleetDryDetails({ interval, reading });
  if ("because" in listed) {
    return { because: listed.because, monitorId: "fleet-runs-dry", state: "unmeasurable" };
  }
  const until = minute({ iso: interval.untilIso });
  const subject: MonitorSubject = {
    decision,
    details: listed.details,
    id: `every routable Claude and Codex plan until ${until}`,
    key: fleetDryKey({ interval }),
    label: `${dryDuration({ interval })} with no measured route, the first reset ${until}`,
  };
  return { monitorId: "fleet-runs-dry", state: "firing", subjects: [subject] };
}
