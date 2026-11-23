/**
 * Pure argument handling and reporting for `slack alert-summary`. No I/O.
 *
 * Split from the shell for the reason `./readThreadCore.ts` is: the flag surface is unit-testable without a token,
 * a network or a clock, and `helpTruth` imports the flag list to prove `--help` names exactly what the parser
 * accepts. Both halves of that are checked mechanically rather than reviewed.
 */
import { slackPermalink } from "../../../corpus/slack/curated.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { recipeErrorLines } from "../../../live/automation/errors.js";
import { parseIntroFlag } from "../../../live/automation/firstFiring.js";
import {
  type RecommendationSelection,
  recommendationSelectionLines,
  selectRecommendations,
  shedToFit,
} from "../../../live/automation/recommendationSet.js";
import type { AlertImpact } from "../../../live/slack/alertImpact.js";
import type { AlertTally, AlertTallyRow } from "../../../live/slack/alertTally.js";
import { type AlertWindow, parseAlertWindow } from "../../../live/slack/alertWindow.js";
import {
  type AlertSummaryBehind,
  type AlertSummaryForm,
  alertSummaryFormSchema,
  alertSummaryToUpdate,
} from "../../../outbound/artifact/alertSummary.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import { updateArtifactFitsUntruncated } from "../../../outbound/artifact/schema.js";
import type { Severity } from "../../../outbound/artifact/severity.js";
import type { AlertTrendReading } from "../../../outbound/artifact/trend.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagOr, stringFlagsOf } from "../../parseFlags.js";
import { type SlackArgumentError, SlackArgumentErrors, slackArgumentErrorLines } from "./argumentErrors.js";
import { DEFAULT_ALERT_LABEL, DEFAULT_ALERT_WINDOW } from "./verbUsage.js";

/** Every flag this verb accepts; the help-truth ratchet checks the names derived from it below. */
const SLACK_ALERT_SUMMARY_FLAGS: FlagSpec = {
  boolean: ["form", "json"],
  string: ["channel", "home", "intro", "label", "lead", "recommendations", "window"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so help and parser cannot drift. */
export const SLACK_ALERT_SUMMARY_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_ALERT_SUMMARY_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_ALERT_SUMMARY_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** How the verb reports itself: a readable summary, the bare form, or the whole document. */
type AlertSummaryOutput = "text" | "form" | "json";

/** The resolved invocation. */
export interface SlackAlertSummaryOptions {
  readonly channel: string;
  readonly window: AlertWindow;
  readonly label: string;
  readonly output: AlertSummaryOutput;
  readonly lead: string | undefined;
  /** The day-one intro lines, when this is a scheduled row's first firing. */
  readonly intro: readonly string[] | undefined;
  /** The `--recommendations` value as given — a document, a path or `-`, read by the shell. */
  readonly recommendations: string | undefined;
  readonly home: string | undefined;
}

/** `--form` and `--json` are two different documents, so asking for both is a question with no answer. */
function parseOutput({ form, json }: { form: boolean; json: boolean }): Result<AlertSummaryOutput, SlackArgumentError> {
  if (form && json) {
    return err(SlackArgumentErrors.outputConflict());
  }
  if (form) {
    return ok("form");
  }
  return ok(json ? "json" : "text");
}

/** A string flag's value, or undefined — `parseFlags` types a value flag as `string | boolean`. */
function stringFlag({ value }: { value: string | boolean | undefined }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse the verb's arguments, accumulating every rejection rather than stopping at the first.
 *
 * @param rest the argv tail after `slack alert-summary`
 * @returns the resolved options, or every usage problem found
 */
export function parseSlackAlertSummaryArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<SlackAlertSummaryOptions, SlackArgumentError> {
  const parsed = parseFlags({ args: rest, spec: SLACK_ALERT_SUMMARY_FLAGS });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const channel = stringFlag({ value: values["channel"] });
  const window = parseAlertWindow({
    text: stringFlagOr({ fallback: DEFAULT_ALERT_WINDOW, name: "window", parsed: parsed.value }),
  });
  const output = parseOutput({ form: values["form"] === true, json: values["json"] === true });
  const intro = parseIntroFlag({ value: stringFlag({ value: values["intro"] }) });
  const problems = [
    ...(channel === undefined || channel.length === 0
      ? ["--channel is required: the conversation id to read. A DM id works, and is where to try this first."]
      : []),
    ...(window.isOk() ? [] : window.error),
    ...(output.isOk() ? [] : slackArgumentErrorLines({ error: output.error })),
    ...(intro.isOk() ? [] : recipeErrorLines({ error: intro.error })),
  ];
  if (problems.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: problems }));
  }
  if (!(window.isOk() && output.isOk() && intro.isOk()) || channel === undefined) {
    // unreachable: no problems ⇒ every part is ok
    return err(SlackArgumentErrors.invocationIncoherent({ verb: "alert-summary" }));
  }
  return ok({
    channel,
    home: stringFlag({ value: values["home"] }),
    intro: intro.value,
    label: stringFlagOr({ fallback: DEFAULT_ALERT_LABEL, name: "label", parsed: parsed.value }),
    lead: stringFlag({ value: values["lead"] }),
    output: output.value,
    recommendations: stringFlag({ value: values["recommendations"] }),
    window: window.value,
  });
}

/**
 * Build the alert-summary form from a folded tally. PURE.
 *
 * The form carries no total and there is no field for one — `alertSummaryToUpdate` sums the rows plus `omitted`.
 * This function's whole job is therefore to transcribe counted facts, and it is worth noticing that it has no
 * opportunity to get a number wrong: it copies `count`, `label`, `citationUrl` and `severity` and adds nothing.
 *
 * @param rows the kept rows, noisiest first, each already carrying its own citation link and severity when resolved
 * @param omitted the folded quiet tail, when the row cap left one out
 * @param skipped how many messages were read but not recognised
 * @param label the card's subject
 * @param window the observation window label
 * @param lead the supplied sentence, when one survived validation
 * @param intro the day-one intro lines, on a scheduled row's first firing
 * @param behind what the noisiest monitors' own searches matched, when the tick read Datadog — omitted when empty
 * @param impacts each measurable row's blast radius, keyed by the row's own label — absent rows carry none
 * @param trend what the windows before this one counted, absent when no wider span was read
 * @returns the form, ready for `slack post --as bot --form -`
 */
export function buildAlertSummaryForm({
  rows,
  omitted,
  skipped,
  label,
  window,
  lead,
  intro,
  behind = [],
  impacts,
  trend,
}: {
  rows: readonly {
    readonly label: string;
    readonly count: number;
    readonly citationUrl?: string;
    readonly severity?: Severity;
  }[];
  omitted: { readonly monitors: number; readonly count: number } | undefined;
  skipped: number;
  label: string;
  window: string;
  lead: string | undefined;
  intro?: readonly string[] | undefined;
  behind?: readonly AlertSummaryBehind[];
  impacts?: ReadonlyMap<string, AlertImpact> | undefined;
  trend?: AlertTrendReading | undefined;
}): AlertSummaryForm {
  return {
    kind: "alert-summary",
    label,
    rows: rows.map((row) => {
      const impact = impacts?.get(row.label);
      return {
        count: row.count,
        label: row.label,
        ...(row.citationUrl !== undefined ? { citationUrl: row.citationUrl } : {}),
        ...(row.severity !== undefined ? { severity: row.severity } : {}),
        ...(impact !== undefined ? { impact } : {}),
      };
    }),
    skipped,
    window,
    ...(lead !== undefined ? { lead } : {}),
    ...(intro !== undefined ? { intro: [...intro] } : {}),
    ...(omitted !== undefined ? { omitted } : {}),
    ...(behind.length > 0 ? { behind: [...behind] } : {}),
    ...(trend !== undefined ? { trend } : {}),
  };
}

/**
 * What the row block says when no row survived, and which of the two empties this was.
 *
 * The same distinction the CARD now draws (`outbound/artifact/alertSummary.ts`'s `countSentence`), for the
 * same reason: a window that held nothing PROVES nothing fired, and a window whose every message went
 * unrecognised proves only what the tally could parse. The line above this one in the report already prints
 * both counts, so this one asserting the stronger of the two contradicted its own report two lines up.
 */
function emptyTallyLine({ skipped }: { skipped: number }): string {
  if (skipped === 0) {
    return "  (nothing fired in this window)";
  }
  return `  (nothing recognised in this window: all ${String(skipped)} message(s) read went unrecognised)`;
}

/**
 * The human report: what was read, what fired, and what to run next.
 *
 * It ends with the exact `slack post` invocation rather than describing one, because the whole point of this verb
 * is to feed that one — and a command you can paste is the difference between a tool and a demonstration.
 *
 * @param options the parsed invocation
 * @param tally the full tally, before folding
 * @param form the form that was built
 * @param pageCount how many pages the window took to read
 * @param recommendations what the recommendation lane chose, when it was on
 * @returns the report lines, in display order
 */
export function alertSummaryLines({
  options,
  tally,
  form,
  pageCount,
  recommendations = { dropped: [], kept: [] },
}: {
  options: SlackAlertSummaryOptions;
  tally: AlertTally;
  form: AlertSummaryForm;
  pageCount: number;
  recommendations?: RecommendationSelection;
}): readonly string[] {
  const width = Math.max(1, ...tally.rows.map((row) => String(row.count).length));
  return [
    `alert summary — channel=${options.channel} window=${options.window.label}`,
    `read ${String(tally.read)} message(s) across ${String(pageCount)} page(s): ${String(tally.total)} ` +
      `notification(s) across ${String(tally.rows.length)} alert(s), ${String(tally.skipped)} not recognised`,
    "",
    ...(tally.rows.length === 0
      ? [emptyTallyLine({ skipped: tally.skipped })]
      : tally.rows.map((row) => `  ${String(row.count).padStart(width)} × ${row.label}`)),
    "",
    ...(form.lead === undefined ? ["lead: (none — the card goes out with its counts only)"] : [`lead: ${form.lead}`]),
    ...(form.omitted === undefined
      ? []
      : [
          `omitted from the card's table: ${String(form.omitted.monitors)} quieter alert(s), ` +
            `${String(form.omitted.count)} firing(s) — still counted in the total`,
        ]),
    ...recommendationSelectionLines({ selection: recommendations }),
    "",
    "to post it, pipe the form through the door:",
    `  slopweaver slack alert-summary --channel ${options.channel} --window ${options.window.label} --form \\`,
    `    | slopweaver slack post --as bot --channel ${options.channel} --form - --dry-run`,
  ];
}

/** The machine document: the form, plus every fact about how it was sourced. */
export interface SlackAlertSummaryReport {
  readonly channel: string;
  readonly window: string;
  readonly oldestTs: string;
  readonly pageCount: number;
  readonly messagesRead: number;
  readonly notifications: number;
  readonly skipped: number;
  readonly distinctAlerts: number;
  /** Every alert that fired, by the stable name a row's recommendation `clears` must copy exactly. */
  readonly firedNames: readonly string[];
  /** Which authored recommendations reached the card, and why each other one did not. */
  readonly recommendations: RecommendationSelection;
  readonly leadWritten: boolean;
  readonly warnings: readonly string[];
  readonly form: AlertSummaryForm;
}

/**
 * Build the `--json` document. Pure.
 *
 * `leadWritten` is stated rather than inferred from `form.lead` being present, because a consumer should not have
 * to know that an absent sentence and a refused one look identical in the form. The warnings say which it was.
 *
 * @param options the parsed invocation
 * @param tally the full tally, before folding
 * @param form the form that was built
 * @param oldestTs the Slack window bound the read used
 * @param pageCount how many pages the window took to read
 * @param warnings anything the run wants the operator to know
 * @param recommendations what the recommendation lane chose, and what it left off
 * @returns the report object
 */
export function slackAlertSummaryReport({
  options,
  tally,
  form,
  oldestTs,
  pageCount,
  warnings,
  recommendations,
}: {
  options: SlackAlertSummaryOptions;
  tally: AlertTally;
  form: AlertSummaryForm;
  oldestTs: string;
  pageCount: number;
  warnings: readonly string[];
  recommendations: RecommendationSelection;
}): SlackAlertSummaryReport {
  return {
    channel: options.channel,
    distinctAlerts: tally.rows.length,
    firedNames: tally.fired.map((alert) => alert.name),
    form,
    leadWritten: form.lead !== undefined,
    messagesRead: tally.read,
    notifications: tally.total,
    oldestTs,
    pageCount,
    recommendations,
    skipped: tally.skipped,
    warnings,
    window: options.window.label,
  };
}

/** A built form with its recommendation lane applied, and what that lane chose. */
export interface RecommendedSummary {
  readonly form: AlertSummaryForm;
  readonly recommendations: RecommendationSelection;
}

/**
 * Put a row's authored recommendations on a built summary form. PURE.
 *
 * Matched by the alert's STABLE name across the whole tally — before the card condensed, bounded or folded
 * anything — so an alert the row cap left out of the table still counts as fired. An alert that fired with no
 * state on its most recent occurrence colours its line orange: unconfirmed, never guessed red.
 *
 * Shed from the tail until the card sends with nothing cut. At today's caps a summary always fits five
 * maximal recommendations, so shedding is a guard rather than an expectation;
 * `outbound/artifact/alertSummary/behind.test.ts` pins the arithmetic.
 *
 * @param form the form built from the tally
 * @param tally the full tally, whose `fired` names are the keys a recommendation clears
 * @param authored the row's authored set
 * @returns the form carrying what was kept, and the whole selection
 */
export function withSummaryRecommendations({
  form,
  tally,
  authored,
}: {
  form: AlertSummaryForm;
  tally: AlertTally;
  authored: readonly RecommendationAuthored[];
}): RecommendedSummary {
  if (authored.length === 0) {
    return { form, recommendations: { dropped: [], kept: [] } };
  }
  const fired = tally.fired.map((alert) => {
    if (alert.severity === undefined) {
      return { key: alert.name, severity: "orange" as const };
    }
    return { key: alert.name, severity: alert.severity };
  });
  const selection = shedToFit({
    fits: (kept) => summarySends({ form: { ...form, recommendations: [...kept] } }),
    selection: selectRecommendations({ authored, fired }),
  });
  if (selection.kept.length === 0) {
    return { form, recommendations: selection };
  }
  return { form: { ...form, recommendations: [...selection.kept] }, recommendations: selection };
}

/**
 * Whether any row would actually USE the Slack-permalink fallback — one with no `embeddedLink` of its own but a
 * `ts` to build one from. A row that already carries the alerting tool's own link never needs it, so a window
 * where every row does spends no extra call at all.
 *
 * @param rows the kept rows
 * @returns whether the workspace URL is worth resolving
 */
export function anyRowNeedsSlackFallback({ rows }: { rows: readonly AlertTallyRow[] }): boolean {
  return rows.some((row) => row.embeddedLink === undefined && row.ts !== undefined);
}

/**
 * Attach a citation link to each row: the alerting tool's OWN embedded link when it has one — real telemetry,
 * the source of truth — and the Slack permalink only as a fallback when it does not, once the workspace's base
 * URL is known. Slack is secondary corroboration at most, never the primary citation while a better one exists.
 *
 * No per-row API call for the fallback either: `slackPermalink` builds it purely from the workspace URL, the
 * channel id and the ts already carried.
 *
 * @param rows the kept rows, each optionally carrying an embedded link and/or the ts of its most recent occurrence
 * @param workspaceUrl the workspace's base URL, or undefined when it could not be resolved (or was never needed)
 * @param channel the conversation id the rows were read from
 * @returns the rows, each carrying `citationUrl` when either source could produce one
 */
export function rowsWithCitations({
  rows,
  workspaceUrl,
  channel,
}: {
  rows: readonly AlertTallyRow[];
  workspaceUrl: string | undefined;
  channel: string;
}): readonly (AlertTallyRow & { citationUrl?: string })[] {
  return rows.map((row) => {
    if (row.embeddedLink !== undefined) {
      return { ...row, citationUrl: row.embeddedLink };
    }
    if (row.ts !== undefined && workspaceUrl !== undefined) {
      return { ...row, citationUrl: slackPermalink({ channelId: channel, ts: row.ts, workspaceUrl }) };
    }
    return row;
  });
}

/** Whether a summary form is accepted AND its card sends with nothing truncated, break-glass or not. */
function summarySends({ form }: { form: AlertSummaryForm }): boolean {
  if (!alertSummaryFormSchema.safeParse(form).success) {
    return false;
  }
  return updateArtifactFitsUntruncated({ artifact: alertSummaryToUpdate({ form }) });
}
