/**
 * Everything `slopweaver slack alert-summary` does between the parse and the emit: read the window (and its
 * baseline), tally it in pure code, fold it, resolve each row's citation, validate the operator's `--lead`, read
 * the telemetry and impact lanes, and build the form. The verb's shell, `./alertSummaryRun.ts`, parses, chooses
 * a token, calls {@link sourceSummary} and emits; its header carries the pipeline's guarantees.
 *
 * `SlackAlertSummaryDeps` is declared here rather than in the shell because every function in this module names
 * it, and this module imports nothing from `./alertSummaryRun.ts` (type imports included), so the two cannot
 * form a cycle.
 */
import type { makeSlackApi } from "../../../corpus/slack/api.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { slopweaverHome } from "../../../homeDir.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RecommendationSelection } from "../../../live/automation/recommendationSet.js";
import { resolveAlertLead } from "../../../live/slack/alertLead.js";
import type { CompleteWindowRead, readAlertWindow } from "../../../live/slack/alertSource.js";
import { type AlertTallyRow, foldTally, type RawAlertMessage, tallyAlerts } from "../../../live/slack/alertTally.js";
import { spanMs, splitAlertSpan } from "../../../live/slack/alertTrend.js";
import { type AlertWindow, windowOldestTs } from "../../../live/slack/alertWindow.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import { TABLE_MAX_ROWS } from "../../../outbound/artifact/schema.js";
import { ALERT_TREND_PRIOR_WINDOWS } from "../../../outbound/artifact/trend.js";
import type { BehindReading, readAlertBehind } from "./alertBehindRun.js";
import type { readAlertImpact } from "./alertImpactRun.js";
import {
  anyRowNeedsSlackFallback,
  buildAlertSummaryForm,
  rowsWithCitations,
  type SlackAlertSummaryOptions,
  withSummaryRecommendations,
} from "./alertSummaryCore.js";

/** The injected edges, so the shell is testable without a token, a network or a clock. */
export interface SlackAlertSummaryDeps {
  readonly userToken: (args: { home?: string }) => string | undefined;
  readonly botToken: (args: { home?: string }) => string | undefined;
  readonly readWindow: typeof readAlertWindow;
  readonly makeApi: typeof makeSlackApi;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** What stands behind the noisiest monitors — the Datadog half of the card (`./alertBehindRun.ts`). */
  readonly readBehind: typeof readAlertBehind;
  /** Each alert's estimated blast radius, which the priority matrix ranks on (`./alertImpactRun.ts`). */
  readonly readImpact: typeof readAlertImpact;
}

/**
 * Resolve the workspace's base URL for the Slack-permalink FALLBACK citation, but only when a row would actually
 * need it — a window where every citable row already carries its own embedded link spends no extra call. Never
 * fails the caller: an unresolved or errored lookup degrades those rows to no citation and a stated reason,
 * exactly like a dropped `--lead`.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param rows the kept rows, each optionally carrying an embedded link and/or the ts of its most recent occurrence
 * @returns the workspace URL when resolved, and any warning explaining why the fallback was skipped
 */
async function resolveCitationBase({
  api,
  rows,
}: {
  api: Pick<SlackApi, "workspaceUrl">;
  rows: readonly AlertTallyRow[];
}): Promise<{ workspaceUrl: string | undefined; warnings: readonly string[] }> {
  if (!anyRowNeedsSlackFallback({ rows })) {
    return { warnings: [], workspaceUrl: undefined };
  }
  try {
    const workspaceUrl = await api.workspaceUrl();
    return workspaceUrl === undefined
      ? {
          warnings: ["no Slack-permalink fallback citation added: could not resolve the workspace URL (auth.test)"],
          workspaceUrl: undefined,
        }
      : { warnings: [], workspaceUrl };
  } catch (error: unknown) {
    return {
      warnings: [
        `no Slack-permalink fallback citation added: ${error instanceof Error ? error.message : "unknown error"}`,
      ],
      workspaceUrl: undefined,
    };
  }
}

/** Everything between the parse and the emit: the read, the pure tally, the fold and the lead validation. */
interface SourcedSummary {
  readonly tally: ReturnType<typeof tallyAlerts>;
  readonly form: ReturnType<typeof buildAlertSummaryForm>;
  readonly recommendations: RecommendationSelection;
  readonly oldestTs: string;
  readonly pageCount: number;
  readonly warnings: readonly string[];
}

/**
 * Read the window, tally it, fold it, and validate any supplied sentence — in that order, and never any other.
 *
 * The order is the guarantee rather than a convenience: the tally is fixed before `--lead` is even looked at, so
 * `resolveAlertLead` is handed the counted rows and the skip count and nothing else, and cannot see a number it
 * did not already have. It takes the skip count because an empty `rows` alone cannot tell a quiet window from
 * an unparsed one, and the two get different cards — `outbound/artifact/alertSummary.ts`'s `countSentence`.
 *
 * @returns the sourced summary, or the window-read problems that prevent one
 */
export async function sourceSummary({
  options,
  token,
  deps,
  authored,
}: {
  options: SlackAlertSummaryOptions;
  token: string;
  deps: SlackAlertSummaryDeps;
  authored: readonly RecommendationAuthored[];
}): Promise<Result<SourcedSummary>> {
  const { channel, window, home = slopweaverHome() } = options;
  const nowMs = deps.nowMs();
  // The crawl reaches BACK past the card's own window, by `ALERT_TREND_PRIOR_WINDOWS` more of it, so the card
  // can say how this window compares with the ones before it without banking a number anywhere — see
  // `live/slack/alertTrend.ts`. `oldestTs` stays the CARD's bound, because it is what the report prints as the
  // window that was summarised; the crawl's own wider bound is not a fact about the card.
  const oldestTs = windowOldestTs({ nowMs, window });
  const spanOldestTs = windowOldestTs({
    nowMs,
    window: { label: window.label, ms: spanMs({ priorWindows: ALERT_TREND_PRIOR_WINDOWS, windowMs: window.ms }) },
  });
  const api = deps.makeApi({ token });
  const crawl = await crawlSpan({ api, channel, deps, oldestTs, spanOldestTs });
  if (crawl.isErr()) {
    return err([crawl.error.message]);
  }
  const span = splitAlertSpan({
    messages: crawl.value.read.messages,
    nowMs,
    priorWindows: crawl.value.priorWindows,
    windowMs: window.ms,
  });
  const tally = tallyAlerts({ messages: span.current });
  const folded = foldTally({ limit: TABLE_MAX_ROWS, tally });
  const lanes = await readLanes({ api, authored, channel, deps, folded, home, nowMs, options, span, tally });
  return ok({
    form: lanes.form,
    oldestTs,
    pageCount: crawl.value.read.pageCount,
    recommendations: lanes.recommendations,
    tally,
    warnings: [...crawl.value.warnings, ...lanes.warnings],
  });
}

/**
 * Every lane that hangs off the folded tally: the citations, the operator's sentence, the telemetry reading,
 * the impact estimates and the recommendation selection — then the form they build.
 *
 * Its own function so `sourceSummary` stays inside the length a reader holds. The ORDER is still the
 * guarantee it always was: the tally is fixed before any of this runs, so nothing here can add a number the
 * counted rows do not already have.
 *
 * @param api the Slack read seam, reused for the permalink fallback
 * @param authored the row's own recommendation set, empty when it declared none
 * @param channel the conversation the rows were read from
 * @param deps the injected edges
 * @param folded the kept rows and the tail the row cap left out
 * @param home the state home both Datadog lanes resolve their census and credentials from
 * @param nowMs the one instant the whole run is taken at
 * @param options the parsed invocation
 * @param span the crawl cut into the card's window and its baseline
 * @param tally the whole tally, whose stable names a recommendation `clears`
 * @returns the built form, the recommendation selection, and every warning the lanes raised
 */
async function readLanes({
  api,
  authored,
  channel,
  deps,
  folded,
  home,
  nowMs,
  options,
  span,
  tally,
}: {
  api: ReturnType<typeof makeSlackApi>;
  authored: readonly RecommendationAuthored[];
  channel: string;
  deps: SlackAlertSummaryDeps;
  folded: ReturnType<typeof foldTally>;
  home: string;
  nowMs: number;
  options: SlackAlertSummaryOptions;
  span: ReturnType<typeof splitAlertSpan<RawAlertMessage>>;
  tally: ReturnType<typeof tallyAlerts>;
}): Promise<{
  readonly form: ReturnType<typeof buildAlertSummaryForm>;
  readonly recommendations: RecommendationSelection;
  readonly warnings: readonly string[];
}> {
  const { window, label, lead } = options;
  const citationBase = await resolveCitationBase({ api, rows: folded.rows });
  const citedRows = rowsWithCitations({ channel, rows: folded.rows, workspaceUrl: citationBase.workspaceUrl });
  const resolved = resolveAlertLead({ rows: folded.rows, skipped: tally.skipped, supplied: lead });
  const behind = await behindFor({ deps, home, nowMs, rows: folded.rows, window });
  const impact = await deps.readImpact({ home, nowMs, rows: folded.rows, windowMs: window.ms });
  const recommended = withSummaryRecommendations({
    authored,
    form: buildAlertSummaryForm({
      behind: behind.behind,
      impacts: impact.impacts,
      intro: options.intro,
      label,
      lead: resolved.lead,
      omitted: folded.omitted,
      rows: citedRows,
      skipped: tally.skipped,
      // Omitted entirely when the wider crawl did not happen, rather than sent as a zero baseline: the form's
      // own `trend` field exists to be ABSENT in that case, and `outbound/artifact/trend.ts` renders the
      // absence as "no prior windows were read" instead of a verdict nothing measured.
      ...(span.priorWindows === 0
        ? {}
        : { trend: { priorTotal: tallyAlerts({ messages: span.prior }).total, priorWindows: span.priorWindows } }),
      window: window.label,
    }),
    tally,
  });
  return {
    form: recommended.form,
    recommendations: recommended.recommendations,
    warnings: [...citationBase.warnings, ...resolved.warnings, ...behind.warnings, ...impact.warnings],
  };
}

/** One crawl, and how much baseline it actually reached. */
interface SpanCrawl {
  readonly read: CompleteWindowRead;
  /** How many prior windows the crawl covers — zero when only the card's own window could be read. */
  readonly priorWindows: number;
  readonly warnings: readonly string[];
}

/**
 * Crawl the card's window plus its baseline, and fall back to the card's window ALONE when that is too much.
 *
 * `live/slack/alertSource.ts` refuses a window it cannot page completely rather than reporting a partial one,
 * which is the right refusal and becomes the wrong OUTCOME once the crawl is four times wider than the card:
 * a channel noisy enough to breach the page budget over four days would post nothing at all, having posted
 * fine the day before. So the baseline is the thing that gives. A card with no trend clause says so; a channel
 * with no card at the digest's cut-off says nothing.
 *
 * @param api the Slack read seam
 * @param channel the conversation to read
 * @param deps the injected edges, for the reader and the progress sink
 * @param oldestTs the card's own window bound
 * @param spanOldestTs the wider bound, the card's window plus its baseline
 * @returns the crawl, how much baseline it reached, and any warning about a baseline it could not
 */
async function crawlSpan({
  api,
  channel,
  deps,
  oldestTs,
  spanOldestTs,
}: {
  api: ReturnType<typeof makeSlackApi>;
  channel: string;
  deps: SlackAlertSummaryDeps;
  oldestTs: string;
  spanOldestTs: string;
}): Promise<Result<SpanCrawl, { message: string }>> {
  const onPage = ({ pageCount, messageCount }: { pageCount: number; messageCount: number }): void => {
    // Progress goes to stderr in EVERY mode, not only the machine ones: `--form` is piped, and a `text` run that
    // mixed progress into its own report would be no easier to read for it.
    deps.writeDiagnostic(`reading ${channel}: page ${String(pageCount)}, ${String(messageCount)} message(s)`);
  };
  const wide = await deps.readWindow({ api, channel, oldest: spanOldestTs, onPage });
  if (wide.isOk()) {
    return ok({ priorWindows: ALERT_TREND_PRIOR_WINDOWS, read: wide.value, warnings: [] });
  }
  const narrow = await deps.readWindow({ api, channel, oldest: oldestTs, onPage });
  if (narrow.isErr()) {
    return err(narrow.error);
  }
  return ok({
    priorWindows: 0,
    read: narrow.value,
    warnings: [
      "no trend comparison: reading the prior windows as well did not fit the page budget " +
        `(${wide.error.message}), so this card reports its own window and compares it with nothing`,
    ],
  });
}

/**
 * What the noisiest monitors' own log searches matched, or why the section is absent.
 *
 * Its own function so `sourceSummary` stays inside the length a reader holds; the reading itself is
 * `./alertBehindRun.ts`, which never fails the card.
 *
 * @param deps the injected edges, for the reader and the clock
 * @param home the state home the census lives under
 * @param rows the folded tally rows, each carrying the link its notification embedded
 * @param window the card's own window
 * @returns the entries and the warnings explaining any absence
 */
async function behindFor({
  deps,
  home,
  rows,
  window,
  nowMs,
}: {
  deps: SlackAlertSummaryDeps;
  home: string;
  rows: readonly AlertTallyRow[];
  window: AlertWindow;
  /** The one instant the whole run is taken at, so the behind aggregate and the card's window cannot disagree. */
  nowMs: number;
}): Promise<BehindReading> {
  return deps.readBehind({ home, nowMs, rows, windowMs: window.ms });
}
