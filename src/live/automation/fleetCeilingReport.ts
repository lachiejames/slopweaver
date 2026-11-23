/**
 * The `fleet-ceiling-report` kind: measure how much of the Claude plans' last days went unused against the seats
 * that worked (`../../capacity/seatCeiling.ts`), and publish the answer as a local page every morning — carding the
 * owner's Queue only when more could have run (`./fleetCeilingAsk.ts`). A measurement that broke fails the firing
 * instead, so a repair is seated on its failure finding and the owner is never asked whether to fix it.
 *
 * The question it answers is how much of the plan usage is left on the table each week, so a shortfall of hundreds
 * of percent is found rather than assumed away. It runs daily and lands on the Queue or a page on this install,
 * never a Slack post. So this kind declares a `local-page`
 * destination and has no Slack leg at all; a row declaring anything else is refused rather than quietly read as one.
 *
 * ## Why a kind of its own, and not a `verb-run` row of `fleet ceiling`
 *
 * A `verb-run` row runs its verb in process and does not keep its stdout, so nothing could carry the report into
 * a page. This kind reads the report as a typed value through a function seam, because the report is already typed
 * in this process and a round trip through JSON on stdout would only be a second parser.
 *
 * ## The firing's own slot is the report's instant
 *
 * The runner measures with the firing's `slotIso` as `nowIso`, so a retried firing reproduces exactly the days it
 * was scheduled to cover, and lands under the same page and card slug — the slot's LOCAL day
 * (`../../briefing/localDay.ts`), never the UTC prefix of the instant, which names yesterday for a morning in
 * Melbourne.
 */
import { z } from "zod";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { escapeHtml } from "../../atlas/kit/pageTable.js";
import { localDayKey } from "../../briefing/localDay.js";
import type { FleetCeilingReport, PlanUnusedMeasurement } from "../../capacity/seatCeiling.js";
import type { RecipeDefinition } from "./definition.js";
import {
  type FleetCeilingAsk,
  type FleetCeilingWhy,
  fleetCeilingAsk,
  fleetCeilingBrokenReason,
} from "./fleetCeilingAsk.js";
import { seatFigure, seatHeadroom } from "./fleetCeilingFigures.js";
import type { RecipeEffect } from "./kinds.js";

/** The longest span `fleet ceiling` measures — the same bound its `--days` flag holds. */
const MAX_DAYS = 28;

/** What a `fleet-ceiling-report` row's `params` must hold. */
const fleetCeilingReportParamsSchema = z.object({ days: z.number().int().min(1).max(MAX_DAYS) }).strict();

/** One `fleet-ceiling-report` row's resolved plan. */
export interface FleetCeilingReportPlan {
  readonly recipeId: string;
  /** How many days back each firing measures. */
  readonly days: number;
}

/**
 * The row's `params` are not a `fleet-ceiling-report` configuration.
 *
 * @internal
 */
export interface FleetCeilingReportParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/**
 * The row declares itself read-only while running it publishes a page and may card the owner's Queue.
 *
 * @internal
 */
export interface FleetCeilingReportEffectTooNarrowError {
  readonly code: "EFFECT_TOO_NARROW";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
}

/**
 * The row declares a destination other than a local page — a Slack one above all, which this kind no longer has.
 *
 * @internal
 */
export interface FleetCeilingReportDestinationError {
  readonly code: "DESTINATION_NOT_LOCAL_PAGE";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: string;
}

/** Every way one `fleet-ceiling-report` row can fail to become a runnable plan. */
export type FleetCeilingReportPlanError =
  FleetCeilingReportParamsInvalidError | FleetCeilingReportEffectTooNarrowError | FleetCeilingReportDestinationError;

/**
 * Construct one {@link FleetCeilingReportPlanError}. Tests build fixtures through these.
 *
 * @internal
 */
export const FleetCeilingReportPlanErrors = {
  destinationNotLocalPage: ({
    recipeId,
    declared,
  }: {
    readonly recipeId: string;
    readonly declared: string;
  }): FleetCeilingReportDestinationError => ({
    code: "DESTINATION_NOT_LOCAL_PAGE",
    declared,
    message:
      `recipe '${recipeId}' declares destination '${declared}', and a fleet-ceiling-report lands as a local page ` +
      "and a Queue card on this install, never a post: declare { kind: 'local-page' }",
    recipeId,
  }),
  effectTooNarrow: ({
    recipeId,
    declared,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
  }): FleetCeilingReportEffectTooNarrowError => ({
    code: "EFFECT_TOO_NARROW",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}', and a fleet-ceiling-report run PUBLISHES a page and may ` +
      "card the owner's Queue: declare 'write' or 'read-write'",
    recipeId,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): FleetCeilingReportParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable fleet-ceiling-report row: ${issues.join("; ")}`,
    recipeId,
  }),
} as const;

/** The declared effects that cover publishing a page and placing a card. */
const EFFECTS_THAT_MAY_WRITE: ReadonlySet<RecipeEffect> = new Set(["write", "read-write"]);

/**
 * Turn one `fleet-ceiling-report` row into a runnable plan, or say exactly why it is not one. Pure.
 *
 * @param definition the parsed row, already known to select this kind
 * @returns the plan, or the one reason this row may not run
 */
export function planFleetCeilingReport({
  definition,
}: {
  definition: RecipeDefinition;
}): Result<FleetCeilingReportPlan, FleetCeilingReportPlanError> {
  const parsed = fleetCeilingReportParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? "params" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    return err(FleetCeilingReportPlanErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  if (definition.destination.kind !== "local-page") {
    return err(
      FleetCeilingReportPlanErrors.destinationNotLocalPage({
        declared: definition.destination.kind,
        recipeId: definition.recipeId,
      }),
    );
  }
  if (!EFFECTS_THAT_MAY_WRITE.has(definition.effect)) {
    return err(
      FleetCeilingReportPlanErrors.effectTooNarrow({ declared: definition.effect, recipeId: definition.recipeId }),
    );
  }
  return ok({ days: parsed.data.days, recipeId: definition.recipeId });
}

/** A number to one decimal place, without a trailing `.0`. */
function oneDecimal({ value }: { value: number }): string {
  return String(Math.round(value * 10) / 10);
}

/** The largest headroom spelled out as "about N"; past it {@link seatFigure} already reads "over 999". */
const SEAT_FIGURE_MAX = 999;

/** A 0..1 share as a whole percentage. */
function percent({ share }: { share: number }): string {
  return `${String(Math.round(share * 100))}%`;
}

/** The unused sentence of the headline, or why there is none. */
function unusedSentence({ report, days }: { report: FleetCeilingReport; days: number }): string {
  if (report.combinedUnusedShareUpperBound === null) {
    return `No Claude plan reset in the last ${String(days)} days, so what was left unused is unknown.`;
  }
  return (
    `Last ${String(days)} days the Claude plans left at most ` +
    `${percent({ share: report.combinedUnusedShareUpperBound })} of their week unused.`
  );
}

/** The seats sentence: how many worked against how many the plans carry, the difference already worked out. */
function seatsSentence({ report }: { report: FleetCeilingReport }): string {
  const mean = report.seats.meanWorkingSeats;
  if (mean === null) {
    return "No supervisor tick saw the fleet, so how many seats worked is unknown.";
  }
  const worked = `${seatFigure({ value: mean })} seats worked on average`;
  if (report.ceiling.kind === "unmeasurable") {
    return `${worked}, and how many the plans carry could not be measured.`;
  }
  const carry = `${worked} and the plans carry ${seatFigure({ value: report.ceiling.seats })}`;
  const headroom = seatHeadroom({ report })!;
  if (headroom > SEAT_FIGURE_MAX) {
    return `${carry}, so ${seatFigure({ value: headroom })} more could run.`;
  }
  if (headroom >= 1) {
    return `${carry}, so about ${String(headroom)} more could run.`;
  }
  return `${carry}, so the plans are the limit.`;
}

/**
 * The page's two-sentence headline: what went unused, and how many seats worked against how many could.
 *
 * Every unused figure keeps "at most": each is an upper bound (`../../capacity/unused.ts`).
 *
 * @param report the measurement
 * @param days how many days it covers, as the row asked
 * @returns the headline
 */
export function fleetCeilingHeadline({ report, days }: { report: FleetCeilingReport; days: number }): string {
  return `${unusedSentence({ days, report })} ${seatsSentence({ report })}`;
}

/** One plan's line: its unused share at its reset, or that none was observed. */
function planLine({ plan }: { plan: PlanUnusedMeasurement }): string {
  const alias = `<code>${escapeHtml({ value: plan.planAlias })}</code>`;
  if (plan.unusedPlanWeeksUpperBound === null) {
    return `${alias}: no weekly reset in this span`;
  }
  return `${alias}: at most ${percent({ share: plan.unusedPlanWeeksUpperBound })} of its week unused at its reset`;
}

/** Every plan's line, in configured order, or why no plan was measured. */
function planLines({ report }: { report: FleetCeilingReport }): readonly string[] {
  if (report.unusedByPlan.length === 0) {
    return ["no unpaused Claude plan is configured, so no plan was measured"];
  }
  return report.unusedByPlan.map((plan) => planLine({ plan }));
}

/** The fleet's seats, burn and the ceiling, each with what it rests on. */
function fleetLines({ report }: { report: FleetCeilingReport }): readonly string[] {
  const { seats, burn, ceiling } = report;
  const lines: string[] = [];
  if (seats.meanWorkingSeats !== null && seats.meanOpenSeats !== null && seats.peakWorkingSeats !== null) {
    lines.push(
      `working seats: ${seatFigure({ value: seats.meanWorkingSeats })} on average, peak ` +
        `${seatFigure({ value: seats.peakWorkingSeats })}, out of ${seatFigure({ value: seats.meanOpenSeats })} open`,
    );
  }
  lines.push(
    `ticks saw the fleet for ${oneDecimal({ value: seats.coveredHours })}h, and ` +
      `${oneDecimal({ value: seats.unknownHours })}h is unknown rather than idle`,
  );
  if (burn.kind === "measured") {
    lines.push(
      `one working seat draws about ${percent({ share: burn.planWeeksPerWorkingSeatHour * 24 })} of a plan's week a ` +
        `day, the fleet average over ${oneDecimal({ value: burn.overlapHours })}h where every plan was read`,
    );
  } else {
    lines.push(`the burn per working seat could not be measured: <code>${escapeHtml({ value: burn.reason })}</code>`);
  }
  if (ceiling.kind === "measured") {
    lines.push(
      `the supervisor fills to ${seatFigure({ value: ceiling.seats })} working seats, the most the plans' remaining ` +
        "week carries at that burn until each resets",
    );
  }
  return lines;
}

/** What held the fleet back now, from `fleet why`'s own sentences, or why that could not be read. */
function whyLines({ why }: { why: FleetCeilingWhy }): readonly string[] {
  if (why.kind === "unreadable") {
    return [`what held the fleet back could not be read: <code>${escapeHtml({ value: why.reason })}</code>`];
  }
  return why.sentences.map((sentence) => escapeHtml({ value: sentence }));
}

/** One titled list. Each line is already HTML. */
function section({ title, lines }: { title: string; lines: readonly string[] }): string {
  const items = lines.map((line) => `<li>${line}</li>`).join("");
  return `<section><h2>${escapeHtml({ value: title })}</h2><ul>${items}</ul></section>`;
}

/** What one morning's firing delivers: the page, the card when one is earned, and yesterday's card to withdraw. */
export interface FleetCeilingDelivery {
  /** The slot's local day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The page slug, `fleet-ceiling-<day>` — also the card's slug, so a page and its card share one name. */
  readonly slug: string;
  /** The page fragment `page publish` wraps in the document shell. Escaped: every string the report carries is data. */
  readonly fragment: string;
  /** The Queue card, or `null` when nothing on the page needs the owner. */
  readonly ask: FleetCeilingAsk | null;
  /** Why the measurement could not say, or `null` when it all read — non-null FAILS the firing, so a repair is seated. */
  readonly brokenReason: string | null;
  /** The slug yesterday's card stood under — withdrawn once today's page supersedes it, when still unanswered. */
  readonly previousSlug: string;
}

/**
 * The firing's slot does not name a readable instant, so no local day — and so no page — can be named for it.
 *
 * @internal
 */
export interface FleetCeilingSlotUnreadableError {
  readonly code: "SLOT_UNREADABLE";
  readonly message: string;
  readonly slotIso: string;
}

/** The milliseconds in one day, for yesterday's slug — a 06:00 slot minus a day is yesterday across any DST step. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The page and card slug a firing's slot names — `fleet-ceiling-<local day>` — so a firing that could not read its
 * report at all still knows which card an earlier attempt at the same slot may have left open. Pure.
 *
 * @param slotIso the firing's slot
 * @returns the slug, or `undefined` when the slot is not a readable instant
 */
export function fleetCeilingSlugForSlot({ slotIso }: { slotIso: string }): string | undefined {
  const day = localDayKey({ iso: slotIso });
  if (parseIsoMs({ tsIso: slotIso }) === undefined || day === "") {
    return undefined;
  }
  return `fleet-ceiling-${day}`;
}

/**
 * Plan one morning's delivery: the page, and the Queue card only when the page has something the owner must decide. Pure.
 *
 * @param report the measurement over the days ending at the slot
 * @param why what held the fleet back over the hour before the slot, or why that could not be read
 * @param days how many days the report covers
 * @param slotIso the firing's slot, which names the day
 * @returns the delivery, or why the slot names no day
 */
export function fleetCeilingDelivery({
  report,
  why,
  days,
  slotIso,
}: {
  report: FleetCeilingReport;
  why: FleetCeilingWhy;
  days: number;
  slotIso: string;
}): Result<FleetCeilingDelivery, FleetCeilingSlotUnreadableError> {
  const slotMs = parseIsoMs({ tsIso: slotIso });
  const slug = fleetCeilingSlugForSlot({ slotIso });
  if (slotMs === undefined || slug === undefined) {
    return err({
      code: "SLOT_UNREADABLE",
      message: `the firing's slot '${slotIso}' is not a readable instant, so no page can be named for it`,
      slotIso,
    });
  }
  const day = localDayKey({ iso: slotIso });
  const headline = fleetCeilingHeadline({ days, report });
  const sections = [
    section({ lines: whyLines({ why }), title: "What held it back this morning" }),
    section({ lines: planLines({ report }), title: "Each plan" }),
    section({ lines: fleetLines({ report }), title: "The fleet" }),
  ];
  if (report.problems.length > 0 || report.uncountedPlans.length > 0) {
    const lines = [
      ...report.problems.map((problem) => `not counted, <code>${escapeHtml({ value: problem })}</code>`),
      ...report.uncountedPlans.map((plan) => `a plan not counted, <code>${escapeHtml({ value: plan })}</code>`),
    ];
    sections.push(section({ lines, title: "What the readers could not count" }));
  }
  const fragment = [
    `<h1>Fleet ceiling, ${escapeHtml({ value: day })}</h1>`,
    `<p class="lede">${escapeHtml({ value: headline })}</p>`,
    ...sections,
  ].join("\n");
  const previousDay = localDayKey({ iso: new Date(slotMs - DAY_MS).toISOString() });
  const brokenReason = fleetCeilingBrokenReason({ report, why });
  return ok({
    ask: fleetCeilingAsk({ broken: brokenReason, day, days, headline, report, slug, why }),
    brokenReason,
    day,
    fragment,
    previousSlug: `fleet-ceiling-${previousDay}`,
    slug,
  });
}
