/**
 * Pure argument handling, form building and reporting for `datadog alert-digest`. No I/O.
 *
 * Split from the shell for the reason every other `*Core.ts` here is: the flag surface is unit-testable
 * without a credential, a network or a clock, and `helpTruth` imports the flag list to prove `--help`
 * names exactly what the parser accepts. Both halves of that are checked mechanically rather than reviewed.
 *
 * The one thing worth stating that is not obvious from the shape: this file NEVER computes a number. It
 * transcribes what `datadog/alertProbe.ts` derived from readings the shell took, which is the same
 * division `slack/alertSummaryCore.ts` keeps and for the same reason — the arithmetic on a card that posts
 * unattended has to live somewhere a test can reach without a token.
 */
import {
  type AlertProbeReading,
  orderReadings,
  readingIsAlarming,
  readingToDigestItem,
} from "../../../datadog/alertProbe.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { recipeErrorLines } from "../../../live/automation/errors.js";
import { parseIntroFlag } from "../../../live/automation/firstFiring.js";
import type { RecommendationSelection } from "../../../live/automation/recommendationSet.js";
import { fitLead, leadNumberRefusal } from "../../../live/slack/alertLead.js";
import { digestToUpdate } from "../../../outbound/artifact/digest.js";
import {
  DIGEST_ALERT_LEAD_VISIBLE_MAX,
  DIGEST_LABEL_MAX,
  DIGEST_WINDOW_MAX,
  type DigestForm,
  type DigestItem,
} from "../../../outbound/artifact/digestFields.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import type { AlertTrendReading } from "../../../outbound/artifact/trend.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { type AlertDigestFormOutcome, selectDigestRecommendations } from "./alertDigestRecommendations.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";
import { DEFAULT_ALERT_DIGEST_WINDOW } from "./usage.js";

/** The boolean flags, named once so the spec and the name list are built from one literal. */
const BOOLEAN_FLAGS = ["form", "json"] as const;

/** The value flags, named once for the same reason. */
const STRING_FLAGS = ["intro", "label", "lead", "probes", "recommendations", "window"] as const;

/** Every flag this verb accepts; `DATADOG_ALERT_DIGEST_FLAG_NAMES` below is what help-truth compares.
 *
 * @internal
 */
export const DATADOG_ALERT_DIGEST_FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** Every flag NAME, built from the same two literals the spec is, so help and parser cannot drift. */
export const DATADOG_ALERT_DIGEST_FLAG_NAMES: readonly string[] = [...BOOLEAN_FLAGS, ...STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** How the verb reports itself: a readable summary, the bare form, or the whole document.
 *
 * @internal — a field of the resolved options; nothing outside this file names the type.
 */
export type AlertDigestOutput = "text" | "form" | "json";

/** The resolved invocation. */
export interface DatadogAlertDigestOptions {
  readonly probes: string;
  readonly label: string;
  readonly window: string;
  readonly lead: string | undefined;
  /** The day-one intro lines, when this is a scheduled row's first firing. */
  readonly intro: readonly string[] | undefined;
  /** The `--recommendations` value as given — a document, a path or `-`, read by the shell. */
  readonly recommendations: string | undefined;
  readonly output: AlertDigestOutput;
}

/** A string flag's value, or undefined — `parseFlags` types a value flag as `string | boolean`. */
function stringFlag({ value }: { value: string | boolean | undefined }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * What the card's own width caps refuse about `--label` and `--window`.
 *
 * `digestFields.ts` bounds both and they land in the card VERBATIM, so an over-long one is checked HERE, against
 * that file's own constants: a caller mistake refused before a single Datadog query runs, rather than a form
 * the read leg emits at exit 0 and the door then refuses, which loses the whole card at the unattended hour
 * on a schema error nobody can act on.
 */
function cardWidthProblems({
  label,
  window,
}: {
  label: string | undefined;
  window: string;
}): readonly DatadogArgsError[] {
  const problems: DatadogArgsError[] = [];
  if (label !== undefined && label.length > DIGEST_LABEL_MAX) {
    problems.push(DatadogArgsErrors.alertDigestLabelTooLong({ label, max: DIGEST_LABEL_MAX }));
  }
  if (window.length > DIGEST_WINDOW_MAX) {
    problems.push(DatadogArgsErrors.alertDigestWindowTooLong({ max: DIGEST_WINDOW_MAX, window }));
  }
  return problems;
}

/** The `--intro` flag as lines, or the reason it is not one — split out so the parse stays under the complexity cap. */
function introOf({ value }: { value: string | undefined }): {
  readonly lines: readonly string[] | undefined;
  readonly problems: readonly string[];
} {
  const parsed = parseIntroFlag({ value });
  if (parsed.isErr()) {
    return { lines: undefined, problems: recipeErrorLines({ error: parsed.error }) };
  }
  return { lines: parsed.value, problems: [] };
}

/**
 * Parse the verb's arguments, accumulating every rejection rather than stopping at the first.
 *
 * @param rest the argv tail after `datadog alert-digest`
 * @returns the resolved options, or every usage problem found
 */
export function parseDatadogAlertDigestArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogAlertDigestOptions, DatadogArgsError> {
  const parsed = parseFlags({ args: rest, spec: DATADOG_ALERT_DIGEST_FLAGS });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const probes = stringFlag({ value: values["probes"] });
  const label = stringFlag({ value: values["label"] });
  const form = values["form"] === true;
  const json = values["json"] === true;
  const missingProbes = probes === undefined || probes.length === 0;
  const missingLabel = label === undefined || label.length === 0;
  const windowFlag = stringFlag({ value: values["window"] });
  const intro = introOf({ value: stringFlag({ value: values["intro"] }) });
  let window = DEFAULT_ALERT_DIGEST_WINDOW;
  if (windowFlag !== undefined) {
    window = windowFlag;
  }
  const found: DatadogArgsError[] = [];
  if (missingProbes) {
    found.push(DatadogArgsErrors.alertDigestProbesMissing());
  }
  if (missingLabel) {
    found.push(DatadogArgsErrors.alertDigestLabelMissing());
  }
  found.push(...cardWidthProblems({ label, window }));
  const problems = [...found.map((error) => error.message), ...intro.problems];
  if (form && json) {
    problems.push(DatadogArgsErrors.alertDigestOutputModesConflict().message);
  }
  // Narrowed by the two booleans above rather than re-tested: an `if (probes === undefined)` guard after
  // this point would be unreachable, and an unreachable arm still has to author a message no reader can
  // ever see. `probes` and `label` are non-empty strings here because `problems` was empty.
  if (problems.length > 0 || probes === undefined || label === undefined) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: problems }));
  }
  let output: AlertDigestOutput = "text";
  if (form) {
    output = "form";
  } else if (json) {
    output = "json";
  }
  return ok({
    intro: intro.lines,
    label,
    lead: stringFlag({ value: values["lead"] }),
    output,
    probes,
    recommendations: stringFlag({ value: values["recommendations"] }),
    window,
  });
}

/**
 * Build the digest form from what the probes read. PURE.
 *
 * Every count is a transcription: `readingToDigestItem` copies it and the severity rule decides the glyph,
 * so there is no field here in which a number could be asserted rather than counted.
 *
 * The one authored string is `lead`, and it gets the SAME check the alert-summary lane runs
 * (`live/slack/alertLead.ts`'s `leadNumberRefusal`, called with the probe titles as its rows): a sentence
 * carrying a digit the card's own rows cannot account for is DROPPED with a warning rather than posted.
 * That check is shared rather than copied — the card renders its real counts either way, so a number in
 * the sentence beside them can only contradict them, and one implementation of that rule is the point.
 *
 * Every form this builds carries `alerts`, so the card ranks by the priority matrix and compares itself with
 * the windows before it — `impacts` and `trend` are what the shell measured for that, and
 * both degrade to absence rather than failing: an unmeasured item reads `impact ?`, an unread baseline omits
 * the TL;DR clause.
 *
 * @param readings every reading the run took, in any order
 * @param impacts each measured blast radius, keyed by probe id — absent for every probe nothing measured
 * @param trend what the baseline windows counted, or undefined when the baseline was not read
 * @param label the card's subject
 * @param window the observation window label, rendered into the TL;DR and the count column's header
 * @param lead the supplied sentence, when the caller wrote one
 * @param intro the day-one intro lines, on a scheduled row's first firing
 * @param recommendations the row's authored set, whose `clears` keys are probe ids already checked as declared
 * @returns the form, why a supplied sentence did not survive, what the card left out to fit, and what the
 *   recommendation lane chose
 */
export function buildAlertDigestForm({
  readings,
  impacts,
  trend,
  label,
  window,
  lead,
  intro,
  recommendations = [],
}: {
  readings: readonly AlertProbeReading[];
  impacts: ReadonlyMap<string, NonNullable<DigestItem["impact"]>>;
  trend: AlertTrendReading | undefined;
  label: string;
  window: string;
  lead: string | undefined;
  intro?: readonly string[] | undefined;
  recommendations?: readonly RecommendationAuthored[];
}): AlertDigestFormOutcome {
  const selected = selectDigestRecommendations({
    built: buildBaseDigestForm({ impacts, intro, label, lead, readings, trend, window }),
    readings,
    recommendations,
  });
  // The card's own derivation warnings, taken ONCE off the final form: which basis sentences it shed to fit. The
  // pessimistic owner predicate is exact here, because a probe-built item never carries an owner.
  const derived = digestToUpdate({ form: selected.form, isKnownPerson: () => false }).warnings;
  return { ...selected, warnings: [...selected.warnings, ...derived] };
}

/** The digest form without its recommendation lane — the counts, the intro and the checked lead. */
function buildBaseDigestForm({
  readings,
  impacts,
  trend,
  label,
  window,
  lead,
  intro,
}: {
  readings: readonly AlertProbeReading[];
  impacts: ReadonlyMap<string, NonNullable<DigestItem["impact"]>>;
  trend: AlertTrendReading | undefined;
  label: string;
  window: string;
  lead: string | undefined;
  intro: readonly string[] | undefined;
}): { readonly form: DigestForm; readonly warnings: readonly string[] } {
  const ordered = orderReadings({ readings });
  const items = ordered.map((reading) => readingToDigestItem({ impact: impacts.get(reading.probe.id), reading }));
  const alerts = trend === undefined ? {} : { trend: { ...trend } };
  const base = {
    alerts,
    items,
    kind: "digest",
    label,
    window,
    ...(intro === undefined ? {} : { intro: [...intro] }),
  } as const;
  if (lead === undefined) {
    return { form: base, warnings: [] };
  }
  const refusal = leadNumberRefusal({ lead, rows: ordered.map((reading) => ({ label: reading.probe.title })) });
  if (refusal !== undefined) {
    return { form: base, warnings: [`--lead was dropped: ${refusal}`] };
  }
  // `fitLead` collapses whitespace, so an all-whitespace sentence comes back EMPTY — and `digestFields.ts`
  // declares `lead` as `.min(1)`, which would make the read emit a form the door then refuses. An empty
  // sentence and an absent one say the same thing to a reader, so it is treated as absent here.
  const fitted = fitLead({ lead, max: DIGEST_ALERT_LEAD_VISIBLE_MAX });
  if (fitted.length === 0) {
    return { form: base, warnings: ["--lead was dropped: it carries no words"] };
  }
  return { form: { ...base, lead: fitted }, warnings: [] };
}

/**
 * What every run of this verb could not prove, stated on the document and never left to inference.
 *
 * Both lines are properties of the design rather than of any one run, which is why they are a constant:
 * the first is what `allowPhraseMatch` buys and costs, and the second is the cross-run comparison this
 * build does not do — a reader who thinks a row is new when it has fired for a fortnight has been misled
 * by the card's silence, not by anything it said.
 */
export const ALERT_DIGEST_RESIDUE: readonly string[] = [
  "each citation matches a log PHRASE, so a row silently goes quiet the day its log wording changes — a " +
    "zero is evidence of no match, never proof of no failure",
  "the trend compares TOTALS with the prior windows, never one row with its own past: every row is still " +
    "reported as if this were the first time it fired, so the card cannot say how long a finding has been going",
  "each impact share is a probe's own logs query against its service's whole log volume, an estimate and never " +
    "a count of users; a metric-sum row and a heartbeat read impact ? because neither has an event population",
  "a metric-sum row's citation is the search its author DECLARED as the metric's evidence, not the metric " +
    "query itself — the link resolves, and whether its number matches the row's depends on that declaration",
];

/**
 * The human report: what each probe counted, and the exact command that posts it.
 *
 * It ends with a runnable `slack post` pipe rather than describing one, for the reason
 * `alertSummaryLines` gives: a command you can paste is the difference between a tool and a demonstration.
 *
 * @param options the parsed invocation
 * @param readings every reading the run took
 * @param channelHint the conversation this card is destined for, when the caller knows it
 * @returns the report lines, in display order
 */
export function alertDigestLines({
  options,
  readings,
  channelHint,
}: {
  options: DatadogAlertDigestOptions;
  readings: readonly AlertProbeReading[];
  channelHint: string | undefined;
}): readonly string[] {
  const ordered = orderReadings({ readings });
  const width = Math.max(1, ...ordered.map((reading) => String(reading.value).length));
  const firing = ordered.filter((reading) => readingIsAlarming({ reading })).length;
  let channel = "<channel-id>";
  if (channelHint !== undefined) {
    channel = channelHint;
  }
  return [
    `alert digest — ${options.label} over ${options.window}`,
    `${String(ordered.length)} probe(s) ran, ${String(firing)} firing`,
    "",
    ...ordered.map(
      (reading) => `  ${String(reading.value).padStart(width)} × ${reading.probe.title}  [${reading.probe.id}]`,
    ),
    "",
    "to post it, pipe the form through the door:",
    `  slopweaver datadog alert-digest --probes <file> --label ${JSON.stringify(options.label)} --form \\`,
    `    | slopweaver slack post --as bot --channel ${channel} --form - --dry-run`,
  ];
}

/** The machine document: the form, plus every reading behind it. */
export interface DatadogAlertDigestReport {
  readonly label: string;
  readonly window: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly probesRun: number;
  readonly probesFiring: number;
  readonly readings: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly value: number;
    readonly query: string;
    readonly citationUrl: string;
  }[];
  readonly residue: readonly string[];
  readonly form: DigestForm;
  /** Which authored recommendations reached the card, and why each other one did not. */
  readonly recommendations: RecommendationSelection;
}

/**
 * Build the `--json` document. Pure.
 *
 * `residue` is carried on the document rather than left to a reader's inference, because these probes
 * cite phrase matches: a link resolves today and stops matching the day the log wording changes, and a
 * consumer that cannot see that stated will read a zero as good news.
 *
 * @param options the parsed invocation
 * @param readings every reading the run took
 * @param form the form that was built
 * @param fromMs the absolute window start every probe shared
 * @param toMs the absolute window end every probe shared
 * @param residue what this run could not prove
 * @param recommendations what the recommendation lane chose, and what it left off
 * @returns the report object
 */
export function datadogAlertDigestReport({
  options,
  readings,
  form,
  fromMs,
  toMs,
  residue,
  recommendations,
}: {
  options: DatadogAlertDigestOptions;
  readings: readonly AlertProbeReading[];
  form: DigestForm;
  fromMs: number;
  toMs: number;
  residue: readonly string[];
  recommendations: RecommendationSelection;
}): DatadogAlertDigestReport {
  const ordered = orderReadings({ readings });
  return {
    form,
    fromMs,
    label: options.label,
    probesFiring: ordered.filter((reading) => readingIsAlarming({ reading })).length,
    probesRun: ordered.length,
    readings: ordered.map((reading) => ({
      citationUrl: reading.citationUrl,
      id: reading.probe.id,
      kind: reading.probe.kind,
      query: reading.probe.query,
      title: reading.probe.title,
      value: reading.value,
    })),
    recommendations,
    residue,
    toMs,
    window: options.window,
  };
}
