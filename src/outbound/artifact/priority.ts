/**
 * The auto-ranked priority matrix: an estimated blast radius, a severity, and the P0-P4 that follows. Pure.
 *
 * Every scheduled alert post leads with whether the service is on fire, then ranks
 * what fired by the priority a reader would have assigned by hand — so eleven channels scanned side by side
 * show at a glance that one holds a P2 while the rest hold P3s.
 *
 * ## Why the priority is DERIVED and never authored
 *
 * The same reason `./alertSummary.ts` refuses a supplied total: a priority somebody typed is a priority nobody
 * reading the card can check. Here both inputs are already on the card — the severity is the glyph leading the
 * line, the share is printed beside it — so a reader can apply {@link PRIORITY_MATRIX} themselves and get the
 * same answer. That is what makes this a matrix rather than an opinion.
 *
 * ## The impact half is an ESTIMATE, and the card says so
 *
 * A share here is the fraction of its service's telemetry volume that one alert's own MONITOR query matched
 * over the card's window. It is not a user count and nothing in this repository can make it one: the Datadog
 * census (`../../datadog/detective/map.ts`) stores a monitor's id, name, query and type and no tag, no SLO and
 * no Datadog `priority`, so there is nothing to look an audience up in. The proxy is honest — an error log per
 * affected request is roughly a share of affected users — and it is honest only while the card states the
 * basis, which `alertSummary.ts` does in one below-fold sentence rather than on every line.
 *
 * The word MONITOR in that sentence is load-bearing. One monitor commonly becomes several tally rows — a
 * grouped notification condenses to `head · key`, one row per group — and the query rerun is the monitor's,
 * covering all of them. So every row of one monitor carries the same reading
 * (`../../live/slack/alertImpact.ts`'s `ImpactTarget.labels`), and the sentence says "monitor query" rather
 * than "this row's query", which would be a claim about a narrower population than the one measured.
 *
 * ## `unknown` is a band, not a missing value
 *
 * A row whose blast radius could not be measured still has to rank somewhere, and both of the tempting answers
 * are wrong: ranking it P0 would make every unreadable monitor the loudest thing on the card, and ranking it P4
 * would hide a red alert behind a Datadog outage. It ranks where {@link IMPACT_BANDS}'s `narrow` ranks, which
 * says the only true thing — an unmeasured blast radius is evidence of neither a large one nor a small one.
 */

import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { SEVERITIES, type Severity } from "./severity.js";

/** The priorities, most urgent first. The ARRAY is the rank order. */
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

/** One alert's derived priority. */
export type Priority = (typeof PRIORITIES)[number];

/**
 * The impact bands, widest first, as {@link bandOfShare} cuts them.
 *
 * Decade boundaries rather than tuned ones, for the reason a tuned boundary is unarguable only to whoever tuned
 * it: 10%, 1% and 0.1% are the numbers a reader already thinks in when they say "a tenth of traffic" or "one in
 * a thousand", so the band a row lands in is checkable against the share printed next to it.
 *
 * ## They are CONSERVATIVE against this denominator, and that is measured rather than assumed
 *
 * MEASURED on one critical alerts channel, over 24h (repro: `slopweaver slack alert-summary
 * --channel <that channel> --window 24h --json`): each of the four measurable alerts came to under one in ten
 * thousand of its service's volume — every one of them `slim`, every one of them P3 beside a red severity. A service's WHOLE telemetry volume is
 * the denominator, and a service emits dozens of spans and log lines per request, so a share here is small by
 * construction and `broad` is reserved for an alert that genuinely IS a tenth of everything a service emitted.
 *
 * That distribution is the intended one rather than a defect to tune away: the card is meant to show "one
 * channel holding a P2 while the others hold P3s", so a matrix where P0 fires weekly would answer a different
 * question. Recalibrating these to spread one channel's rows across more bands is fitting the boundary to a
 * sample, and a boundary fitted to a sample is the "tuned" kind this comment opens by rejecting. If they move,
 * they move on a measurement across several channels and on the owner's word, not on one card reading flat.
 */
export const IMPACT_BANDS = ["broad", "wide", "narrow", "slim", "unknown"] as const;

/** How much of a service one alert touched, as a band. */
export type ImpactBand = (typeof IMPACT_BANDS)[number];

/** The share at or above which an alert is `broad` — a tenth of its service's volume. */
const BROAD_SHARE = 0.1;

/** The share at or above which an alert is `wide`. */
const WIDE_SHARE = 0.01;

/** The share at or above which an alert is `narrow`. Below it, and above zero, is `slim`. */
const NARROW_SHARE = 0.001;

/**
 * The matrix itself: severity down, impact band across.
 *
 * Every cell is a decision, and the four that carry the argument:
 *
 * - **P0 is `red` x `broad` alone.** A P0 has to mean "still firing, across a tenth of the traffic". Widening
 *   that cell by even one neighbour is what turns a priority column into decoration — the owner reads these to find
 *   the one channel that is worse than the others, and a P0 that fires weekly answers a different question.
 * - **`green` never exceeds P2.** A recovered monitor is history. Broad history is still worth an eye; a slim
 *   one is not, which is the only place P4 appears under a measured band.
 * - **`unknown` ranks as `narrow` does.** Stated in the file overview: it is the cell to attack first, because
 *   it is the one holding a judgement rather than a measurement.
 * - **An ABSENT severity ranks as `green`.** `../../live/slack/alertTally.ts` leaves severity undefined when
 *   the most recent occurrence carried no lifecycle word, which is a parsing outcome and not a claim that the
 *   alert is quiet — but reading it as `red` would promote every unparsed monitor title to the top of the card.
 *   The row still prints its count and its citation, so the reader can open it and decide.
 */
export const PRIORITY_MATRIX: Readonly<Record<Severity | "absent", Readonly<Record<ImpactBand, Priority>>>> = {
  absent: { broad: "P2", narrow: "P3", slim: "P4", unknown: "P4", wide: "P3" },
  green: { broad: "P2", narrow: "P3", slim: "P4", unknown: "P4", wide: "P3" },
  orange: { broad: "P1", narrow: "P3", slim: "P3", unknown: "P3", wide: "P2" },
  red: { broad: "P0", narrow: "P2", slim: "P3", unknown: "P2", wide: "P1" },
};

/**
 * The measured blast radius of one alert — both raw numbers, never the share they make.
 *
 * Carried as a numerator and a denominator for the reason `alertSummary.ts` carries per-row counts and no
 * total: a share somebody supplied could disagree with the numbers it claims to be made of, and here it
 * cannot, because there is no field to supply one in.
 */
export interface ImpactReading {
  /** How many events this alert's own query matched over the card's window. */
  readonly matched: number;
  /** How many events the same service logged over the same window — the denominator. */
  readonly scope: number;
}

/**
 * The ceiling on either half of an impact reading.
 *
 * A log-event count is a different order of magnitude from a notification count — a busy service logs millions
 * of lines a day where its monitor fires twice — so this is its own bound rather than a reuse of any card's
 * count cap. It bounds nothing real: neither number reaches a TL;DR (a card prints their QUOTIENT, which
 * {@link shareOfImpact} clamps at 100%), so the cap exists to keep a nonsense reading out of a form rather than
 * to make an arithmetic promise. `../../live/slack/alertImpact.ts`'s `impactOf` declines a reading past it, so a
 * measured impact can never build a form this schema refuses.
 */
export const IMPACT_EVENTS_MAX = 1_000_000_000_000;

/** The longest service name an impact field carries — the same bound as the row label it sits beside. */
export const IMPACT_SERVICE_MAX = 80;

/**
 * The impact FIELD both alert forms carry: both counted numbers and the service they were taken over, never the
 * share they make.
 *
 * One schema for `./alertSummary.ts`'s rows and `./digest.ts`'s items, because a card that ranks by this reading
 * and a second card that ranks by a slightly different one would disagree about the same alert — the matrix is
 * only checkable if every form feeding it means the same thing by `matched` and `scope`.
 */
export const impactFieldSchema = strictForm({
  /** How many events this alert's own query matched over the window. */
  matched: z.number().int().min(0).max(IMPACT_EVENTS_MAX),
  /** How many events the same service logged over the same window — the denominator, never zero. */
  scope: z.number().int().min(1).max(IMPACT_EVENTS_MAX),
  /** The service both numbers are taken over. */
  service: z.string().min(1).max(IMPACT_SERVICE_MAX),
});

/**
 * The share one reading represents, CLAMPED to 1, or nothing when the reading cannot make one.
 *
 * Two guards, both of them a real measurement rather than a defensive habit:
 *
 * - a `scope` of zero yields NOTHING rather than infinity. A service that logged nothing while one of its
 *   monitors matched events is a denominator that raced its own window, not an alert affecting everybody.
 * - a `matched` past `scope` clamps at 1. The two numbers come from two separately-issued aggregates — the
 *   hazard `../../live/slack/alertBehind.ts` records for its own group shares — so a numerator can legitimately
 *   overtake a denominator read moments apart.
 *
 * @param reading the two counted numbers
 * @returns the share in `[0, 1]`, or undefined when no share is derivable from them
 */
export function shareOfImpact({ reading }: { reading: ImpactReading }): number | undefined {
  if (reading.scope <= 0) {
    return undefined;
  }
  return Math.min(1, reading.matched / reading.scope);
}

/**
 * The band one share falls in.
 *
 * @param share the measured share, or undefined when nothing measured it
 * @returns the band, `unknown` when there is no share to band
 */
export function bandOfShare({ share }: { share: number | undefined }): ImpactBand {
  if (share === undefined) {
    return "unknown";
  }
  if (share >= BROAD_SHARE) {
    return "broad";
  }
  if (share >= WIDE_SHARE) {
    return "wide";
  }
  if (share >= NARROW_SHARE) {
    return "narrow";
  }
  return "slim";
}

/**
 * The priority one alert's band and severity derive.
 *
 * @param band how much of its service the alert touched
 * @param severity the state of its most recent occurrence, absent when none carried one
 * @returns the cell of {@link PRIORITY_MATRIX} they name
 */
export function priorityOf({ band, severity }: { band: ImpactBand; severity: Severity | undefined }): Priority {
  const row = severity === undefined ? PRIORITY_MATRIX.absent : PRIORITY_MATRIX[severity];
  return row[band];
}

/**
 * `~3.4%`, `<0.1%` or `impact ?` — the share exactly as an index line prints it.
 *
 * The tilde is load-bearing rather than decorative: it is the one character that marks the number an estimate
 * on the line itself, where the sentence explaining the basis is below the fold and a reader scanning ten
 * channels will not have read it. `<0.1%` rather than a rounded `0.0%` for the reason `alertSummary.ts`'s own
 * `shareOf` gives — a share that is small is not a share that is zero.
 *
 * @param share the measured share, or undefined when nothing measured it
 * @returns the cell's text
 */
export function impactCell({ share }: { share: number | undefined }): string {
  if (share === undefined) {
    return "impact ?";
  }
  if (share > 0 && share < NARROW_SHARE) {
    return "<0.1%";
  }
  return `~${(share * 100).toFixed(1)}%`;
}

/** One alert as the ranking reads it: what it is called, how loud it was, and both halves of its priority. */
export interface RankableAlert {
  readonly label: string;
  readonly count: number;
  readonly severity?: Severity | undefined;
  /** The measured blast radius, absent on a row nothing could measure. */
  readonly impact?: ImpactReading | undefined;
}

/** One alert with its derived cells attached, so nothing downstream recomputes them and disagrees. */
export interface RankedAlert<T extends RankableAlert> {
  readonly alert: T;
  readonly share: number | undefined;
  readonly band: ImpactBand;
  readonly priority: Priority;
}

/** Where a priority sorts. Lower is more urgent, by {@link PRIORITIES}'s own order. */
function rankOfPriority({ priority }: { priority: Priority }): number {
  return PRIORITIES.indexOf(priority);
}

/**
 * Rank every alert: priority first, then the widest blast radius, then the loudest, then the label.
 *
 * A TOTAL order, and that is a property rather than a nicety — the same window has to render byte-identically
 * on two runs, which is what the edit path relies on and what made `byNoise` sort on the label rather than on
 * the order a map's entries happened to come out in. This REPLACES that ordering: a tally ordered by noise and
 * a card ranked by priority cannot both be the order, and the one to scan is this one.
 *
 * An unmeasured row sorts behind every measured row of its own priority, because `undefined` is read as a
 * share of -1 rather than 0 — a row nothing could measure is not a row measured at zero, and putting it last
 * within its band is the only ordering that does not claim otherwise.
 *
 * @param alerts the alerts, in any order
 * @returns each alert with its share, band and priority, most urgent first
 */
export function rankAlerts<T extends RankableAlert>({ alerts }: { alerts: readonly T[] }): readonly RankedAlert<T>[] {
  const ranked = alerts.map((alert): RankedAlert<T> => {
    const share = alert.impact === undefined ? undefined : shareOfImpact({ reading: alert.impact });
    const band = bandOfShare({ share });
    return { alert, band, priority: priorityOf({ band, severity: alert.severity }), share };
  });
  return ranked.toSorted((left, right) => {
    const byPriority = rankOfPriority({ priority: left.priority }) - rankOfPriority({ priority: right.priority });
    if (byPriority !== 0) {
      return byPriority;
    }
    const byShare = sortableShare({ share: right.share }) - sortableShare({ share: left.share });
    if (byShare !== 0) {
      return byShare;
    }
    const byCount = right.alert.count - left.alert.count;
    if (byCount !== 0) {
      return byCount;
    }
    return left.alert.label.localeCompare(right.alert.label);
  });
}

/**
 * A share as the SORT reads it: an unmeasured one is below zero, not equal to it.
 *
 * Its own function rather than an inline expression because both spellings of that expression are refused —
 * `??` by the house ban on a silent coalesce, and the ternary by oxlint's preference for the operator it
 * bans. A named function says what the substitution IS, which is the thing the ban exists to make visible:
 * a row nothing could measure is not a row measured at zero, so it sorts behind one.
 */
function sortableShare({ share }: { share: number | undefined }): number {
  if (share === undefined) {
    return -1;
  }
  return share;
}

/**
 * The most urgent priority on a card, or nothing when it holds no alert at all.
 *
 * This is the token the TL;DR leads with, and the whole reason item 18 asks for a matrix: eleven of these read
 * down a sidebar are what show one channel holding a P2 while the others hold P3s.
 *
 * @param ranked the ranked alerts, in any order
 * @returns the most urgent priority present, or undefined on a quiet window
 */
export function topPriority<T extends RankableAlert>({
  ranked,
}: {
  ranked: readonly RankedAlert<T>[];
}): Priority | undefined {
  if (ranked.length === 0) {
    return undefined;
  }
  return ranked.reduce((worst, entry) =>
    rankOfPriority({ priority: entry.priority }) < rankOfPriority({ priority: worst.priority }) ? entry : worst,
  ).priority;
}

/**
 * The one below-fold sentence that makes every share on the card an admitted estimate.
 *
 * One sentence for the whole card rather than a qualifier per line, because the above-fold region is the
 * scarcest thing here and a reader who wants the basis will expand the detail. It names what was divided by
 * what, so the number is checkable rather than merely hedged, and it says what the share is NOT — `alertTally`
 * counts notifications and this counts log events, and a reader who conflates them has the wrong denominator
 * in mind.
 *
 * Kept SHORT for a second reason that is a measurement rather than a preference: it competes with the
 * telemetry lane for `./alertSummary.ts`'s below-fold prose budget, and a longer draft of it shed the whole
 * "behind it" section off a maximal card.
 *
 * The query it names is whichever one was actually rerun, and the two cards rerun different things: a summary
 * reruns the Datadog MONITOR a notification links to, a digest reruns its own declared PROBE. Naming the wrong
 * one would be a claim about a population nobody measured, which is the failure the MONITOR wording was chosen
 * to avoid in the first place.
 *
 * @param measured how many of the card's alerts carry a reading
 * @param total how many alerts the card ranks
 * @param query which query each numerator reran — a monitor's, or a digest probe's
 * @returns the sentence, or undefined when nothing on the card was measured
 */
export function impactBasisSentence({
  measured,
  total,
  query,
}: {
  measured: number;
  total: number;
  query: "monitor" | "probe";
}): string | undefined {
  if (measured === 0) {
    return undefined;
  }
  return (
    `Impact is an ESTIMATE: each alert's own ${query.toUpperCase()} query as a share of that service's own ` +
    `telemetry volume over this window, not a count of users. Measured on ${String(measured)} of ${String(total)}.`
  );
}

/** Every severity a matrix row is keyed by, the absent case included — exported so a test can walk all of them. */
export const MATRIX_SEVERITIES = [...SEVERITIES, "absent"] as const satisfies readonly (Severity | "absent")[];
