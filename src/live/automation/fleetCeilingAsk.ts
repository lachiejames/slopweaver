/**
 * The ONE Queue card a fleet-ceiling morning may earn, and the `handover register` argv that places it. Pure.
 *
 * The report lands on the Queue or a page on this install, never a Slack post. Every morning
 * publishes its page (`./fleetCeilingReport.ts`); a card is placed only when the page holds something the owner
 * must decide, because a card that only tells the owner something is the shape `../../handover/cardAlignment.ts` refuses:
 *
 * the plans could have carried at least one more whole working seat than worked, so the question is whether the
 * supervisor should clear what held it back and fill it.
 *
 * ## A broken measurement is never a card
 *
 * When the measurement itself could not say (no ceiling, no burn, no seat history, `fleet why` unreadable, a reader
 * that failed, or no plan seen resetting at all — {@link fleetCeilingBrokenReason}), the firing FAILS instead
 * (`../../cli/commands/automation/fleetCeilingRowRunner.ts`), so the failure hold files one p0 `recipe-failing-*`
 * finding and the supervisor's `unseated-recipe-failure` gate seats a repair on it. Something broken fixes
 * itself, so this module mints no "repair it now?" card.
 *
 * A plan with no weekly reset inside the span (`uncountedPlans`) is NOT broken while another plan was counted: a
 * plan newer than its first reset is a coverage gap the page discloses, and the unused figure still reads without
 * it. A monthly-spend plan reads there too, for the same reason: it is judged in dollars, never weekly windows.
 * Measured (`slopweaver fleet ceiling --days 7`): one such plan beside four counted plan-weeks read as a
 * broken measurement for a page that had measured fine.
 *
 * A broken reading earns NO card, headroom included: a headroom figure computed from a reading that did not fully
 * read is not a number to ask the owner to act on. The page names what broke, the repair seat re-runs the measurement, and
 * the re-run earns the card if the headroom is real.
 */
import type { FleetCeilingReport } from "../../capacity/seatCeiling.js";
import { type AskRowFields, askRegisterArgv } from "../../handover/askRegisterArgv.js";
import { seatFigure, seatHeadroom } from "./fleetCeilingFigures.js";

/** What held the fleet back over the hour before the slot — `fleet why`'s sentences — or why that was unreadable. */
export type FleetCeilingWhy =
  | { readonly kind: "read"; readonly sentences: readonly string[] }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The fields one `handover register --ask` row carries, before they become argv, and which card it is. */
export interface FleetCeilingAsk extends AskRowFields {
  /** The one card a morning may earn. */
  readonly kind: "headroom";
}

/** A sentence closed with a full stop, unless it already ends in terminal punctuation or an ellipsis. */
function closed({ sentence }: { sentence: string }): string {
  return /[.?!…]$/u.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Why the measurement could not say, or `null` when every part of it read. The first broken part is named; the page
 * lists the rest. A non-null reason fails the firing, so a repair is seated — never a card.
 *
 * @param report the measurement
 * @param why what `fleet why` read
 * @returns the one reason to name, or null
 */
export function fleetCeilingBrokenReason({
  report,
  why,
}: {
  report: FleetCeilingReport;
  why: FleetCeilingWhy;
}): string | null {
  if (report.ceiling.kind === "unmeasurable") {
    return `the plans' ceiling could not be measured, ${report.ceiling.reason}`;
  }
  if (report.burn.kind === "unmeasurable") {
    return `the burn per working seat could not be measured, ${report.burn.reason}`;
  }
  if (report.seats.meanWorkingSeats === null) {
    return "no supervisor tick saw the fleet, so how many seats worked is unknown";
  }
  if (why.kind === "unreadable") {
    return `what held the fleet back could not be read, ${why.reason}`;
  }
  if (report.problems.length > 0) {
    return `a reader could not count something, ${String(report.problems[0])}`;
  }
  if (report.unusedPlanWeeksUpperBound === null) {
    return "no Claude plan's weekly reset was observed in the span, so what was left unused is unknown";
  }
  return null;
}

/** How a whole-seat headroom is spoken: "about 1 more working seat", "about 3 more working seats", "over 999 …". */
function headroomPhrase({ headroom }: { headroom: number }): string {
  const figure = seatFigure({ value: headroom });
  const seats = headroom === 1 ? "more working seat" : "more working seats";
  if (figure.startsWith("over")) {
    return `${figure} ${seats}`;
  }
  return `about ${figure} ${seats}`;
}

/**
 * The card for a morning with at least one whole working seat of headroom.
 *
 * @returns the card's fields
 */
function headroomAsk({
  day,
  days,
  headline,
  headroom,
  report,
  slug,
  why,
}: {
  day: string;
  days: number;
  headline: string;
  headroom: number;
  report: FleetCeilingReport;
  slug: string;
  why: FleetCeilingWhy;
}): FleetCeilingAsk {
  const more = headroomPhrase({ headroom });
  const heldBack = why.kind === "read" && why.sentences.length > 0 ? ` What held it back: ${why.sentences[0]!}` : "";
  const mean = seatFigure({ value: report.seats.meanWorkingSeats! });
  const carried = report.ceiling.kind === "measured" ? seatFigure({ value: report.ceiling.seats }) : "more";
  return {
    ask: closed({
      sentence: `Should the supervisor run the ${more} the Claude plans could have carried? ${headline}${heldBack}`,
    }),
    blastRadius: "How many seats the supervisor runs on this machine, and the Claude plans' remaining week",
    example: `You open the Queue and see the fleet ran ${mean} seats when the plans could carry ${carried}. Fill the headroom?`,
    kind: "headroom",
    lean: "fill the headroom",
    options: [
      `fill the headroom :: the supervisor clears what held it back and runs ${more}, spending plan capacity that otherwise resets unused`,
      "hold the present fill :: the unused capacity resets unspent, and tomorrow's page asks again while it still stands",
    ],
    problem: `The Claude plans could have carried ${more} than ran over the last ${String(days)} days.`,
    risk: "More seats spend the plans faster, leaving less for your own sessions before each resets",
    slug,
    stillReal: `fleet ceiling measured the ${String(days)} days ending at the ${day} morning firing`,
  };
}

/**
 * The card this morning earns, or `null` when the page needs nothing from the owner or the reading broke — a broken
 * reading fails the firing rather than asking the owner anything, headroom included. Pure.
 *
 * @param report the measurement
 * @param why what held the fleet back over the hour before the slot
 * @param broken {@link fleetCeilingBrokenReason}'s verdict on this report; non-null withholds every card
 * @param headline the page's two-sentence headline, which the headroom card carries whole
 * @param day the slot's local day
 * @param days how many days the report covers
 * @param slug the card's slug, shared with the page
 * @returns the card, or null
 */
export function fleetCeilingAsk({
  report,
  why,
  broken,
  headline,
  day,
  days,
  slug,
}: {
  report: FleetCeilingReport;
  why: FleetCeilingWhy;
  broken: string | null;
  headline: string;
  day: string;
  days: number;
  slug: string;
}): FleetCeilingAsk | null {
  if (broken !== null) {
    return null;
  }
  const headroom = seatHeadroom({ report });
  if (headroom !== null && headroom >= 1) {
    return headroomAsk({ day, days, headline, headroom, report, slug, why });
  }
  return null;
}

/**
 * The argv `handover register` parses for one card. Pure.
 *
 * @param ask the card's fields
 * @param home the Slopweaver home the row is written under
 * @returns the full process argv
 */
export function fleetCeilingAskArgv({ ask, home }: { ask: FleetCeilingAsk; home: string }): readonly string[] {
  return askRegisterArgv({ ask, because: "the fleet's own plan capacity on this machine", home });
}
