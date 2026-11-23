/**
 * `slopweaver slack alert-summary --channel <id>` — the effectful shell.
 *
 * ## The pipeline, and where each guarantee lives
 *
 * parse (pure, no I/O) → resolve a token → page the window COMPLETELY or refuse (`live/slack/alertSource`) →
 * TALLY in pure code (`live/slack/alertTally`) → resolve a citation link per row (`./alertSummarySource.ts`'s
 * `resolveCitationBase` + `./alertSummaryCore.ts`'s `rowsWithCitations`) → validate the operator's `--lead`
 * sentence, if any, against the counted rows (`live/slack/alertLead`) → emit the form. Every number the card reports is produced by the pure step; `--lead`
 * can only add or fail to add prose, and no model runs inside this process — see AGENTS.md § "No spawned model,
 * anywhere". The sentence is composed upstairs, by the visible session running this verb.
 *
 * ## Real telemetry over Slack, always — Slack is corroboration at most
 *
 * A citation prefers the link the alerting tool put in its OWN notification — a Datadog monitor or query URL,
 * typically, already carried on the tally row as `embeddedLink` — over a Slack permalink to the message that
 * announced it. Slack only fills in for a row whose notification carried no link of its own, which is why
 * `./alertSummarySource.ts`'s `resolveCitationBase` checks whether the fallback is needed AT ALL before spending
 * a call on it.
 *
 * ## The Slack-permalink fallback costs at most ONE extra call, never one per row
 *
 * `slackPermalink` builds a message's permalink purely from the workspace's base URL, a channel id and a ts —
 * Slack's own stable `archives/<channel>/p<ts>` shape, not an API response. So the only network cost here is
 * resolving the workspace URL once (`auth.test`, already cached by most tokens), and it is skipped entirely when
 * no row would actually use the fallback — because every citable row already has its own embedded link, or
 * because none carries a `ts` at all.
 *
 * ## This verb posts NOTHING
 *
 * It emits a form and stops. Posting stays with `slack post --as bot --form -`, which is door-routed, gated and
 * previewable — so the read and the write are separately reviewable, and a summary can be looked at before anyone
 * decides to send it. That is also why the meta declares `external-read` rather than routing a door request: there
 * is no effect here to route.
 *
 * Data goes to STDOUT and diagnostics to STDERR, which is load-bearing rather than tidy: `--form` output is meant
 * to be piped straight into `slack post`, so a progress line on stdout would corrupt the form.
 */
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { resolveRecommendationSet } from "../../../live/automation/recommendationDocument.js";
import type { RecommendationSelection, RecommendationSetError } from "../../../live/automation/recommendationSet.js";
import { readAlertWindow } from "../../../live/slack/alertSource.js";
import type { tallyAlerts } from "../../../live/slack/alertTally.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { readAlertBehind } from "./alertBehindRun.js";
import { readAlertImpact } from "./alertImpactRun.js";
import {
  alertSummaryLines,
  type buildAlertSummaryForm,
  parseSlackAlertSummaryArgs,
  type SlackAlertSummaryOptions,
  slackAlertSummaryReport,
} from "./alertSummaryCore.js";
import { type SlackAlertSummaryDeps, sourceSummary } from "./alertSummarySource.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { SLACK_ALERT_SUMMARY_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** Resolve the read token, or say which command configures one. */
function chooseToken({
  deps,
  home,
}: {
  deps: SlackAlertSummaryDeps;
  home: string | undefined;
}): { token: string } | { problem: string } {
  const homeArgs = home !== undefined ? { home } : {};
  const chosen = resolveSlackReadToken({ botToken: deps.botToken(homeArgs), userToken: deps.userToken(homeArgs) });
  if (chosen.token === undefined) {
    return { problem: "no Slack token configured; run `slopweaver connect slack`" };
  }
  return { token: chosen.token };
}

/**
 * Emit whatever the caller asked for. One writer, so the three modes cannot disagree about what they describe.
 *
 * `--form` prints the form and nothing else, deliberately including no trailing commentary: it is stdin for the
 * next command in a pipe.
 */
function emit({
  options,
  tally,
  form,
  oldestTs,
  pageCount,
  warnings,
  recommendations,
  deps,
}: {
  options: SlackAlertSummaryOptions;
  tally: ReturnType<typeof tallyAlerts>;
  form: ReturnType<typeof buildAlertSummaryForm>;
  oldestTs: string;
  pageCount: number;
  warnings: readonly string[];
  recommendations: RecommendationSelection;
  deps: SlackAlertSummaryDeps;
}): void {
  if (options.output === "form") {
    deps.writeOut(JSON.stringify(form, null, 2));
    return;
  }
  if (options.output === "json") {
    deps.writeOut(
      JSON.stringify(
        slackAlertSummaryReport({ form, oldestTs, options, pageCount, recommendations, tally, warnings }),
        null,
        2,
      ),
    );
    return;
  }
  for (const line of alertSummaryLines({ form, options, pageCount, recommendations, tally })) {
    deps.writeOut(line);
  }
}

/**
 * Read the `--recommendations` value, when there is one. Nothing is checked against the alert names: they
 * arrive with the window, so an unmatched `clears` is reported by the selection rather than refused here.
 *
 * @param value the flag's value, when it was passed
 * @returns the authored recommendations (none when the flag was absent), or why the document is unusable
 */
async function resolveSummaryRecommendations({
  value,
}: {
  value: string | undefined;
}): Promise<Result<readonly RecommendationAuthored[], RecommendationSetError>> {
  if (value === undefined) {
    return ok([]);
  }
  const set = await resolveRecommendationSet({ value });
  if (set.isErr()) {
    return err(set.error);
  }
  return ok(set.value.recommendations);
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `slack alert-summary`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackAlertSummary({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackAlertSummaryDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "alert-summary" });
  if (gated !== undefined) {
    return gated;
  }
  const options = parseSlackAlertSummaryArgs({ rest });
  if (options.isErr()) {
    for (const problem of slackArgumentErrorLines({ error: options.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SLACK_ALERT_SUMMARY_USAGE);
    return EXIT_USAGE;
  }
  const chosen = chooseToken({ deps, home: options.value.home });
  if ("problem" in chosen) {
    deps.writeDiagnostic(chosen.problem);
    return EXIT_ERROR;
  }
  const authored = await resolveSummaryRecommendations({ value: options.value.recommendations });
  if (authored.isErr()) {
    deps.writeDiagnostic(authored.error.message);
    return EXIT_USAGE;
  }
  const sourced = await sourceSummary({
    authored: authored.value,
    deps,
    options: options.value,
    token: chosen.token,
  });
  if (sourced.isErr()) {
    for (const problem of sourced.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  for (const warning of sourced.value.warnings) {
    deps.writeDiagnostic(warning);
  }
  emit({ deps, options: options.value, ...sourced.value });
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackAlertSummaryDeps(): SlackAlertSummaryDeps {
  return {
    botToken: ({ home }) => slackBotToken(home !== undefined ? { home } : {}),
    makeApi: makeSlackApi,
    nowMs: () => Date.now(),
    readBehind: readAlertBehind,
    readImpact: readAlertImpact,
    readWindow: readAlertWindow,
    userToken: ({ home }) => slackUserToken(home !== undefined ? { home } : {}),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack alert-summary` — count what fired in a channel, and emit the card's form. */
export const slackAlertSummaryCommand = defineCommand({
  run: (argv) => runSlackAlertSummary({ deps: productionSlackAlertSummaryDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
