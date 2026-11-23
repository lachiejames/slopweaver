/**
 * `slopweaver slack probe` — the effectful shell: one read-only Web API call, reported as a SHAPE.
 *
 * ## Why this verb exists rather than a `curl`
 *
 * The one-door rule says every Slack read goes through a `slopweaver` verb, and until now there was no verb
 * for "call this method once and tell me what came back". Research that needs that answer had two options:
 * break the rule with a raw call that looks identical when it works, or not measure at all and reason
 * instead. This is the third. It is the Slack peer of `datadog raw`, and it carries the same property:
 * read-only is enforced by an explicit allowlist rather than by the caller's intention.
 *
 * ## Read-only, twice over
 *
 * `probePolicy.ts` refuses any method not on {@link PROBE_READ_ONLY_METHODS}, and this file never renders a
 * message body — only field names, counts, Slack's own error string, and `--expect`'s four-state verdict,
 * which reads a value in order to compare it and never reports it. A verb that printed bodies would be a
 * second content read path outside the corpus, which is not what a probe is for; see `./probeCore.ts`'s
 * module note for why an equality check is not one.
 */

import { WebClient } from "@slack/web-api";

import { type ProbeRequest, resolveProbe } from "../../../atlas/slackApi/probePolicy.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../../lib/providerCall.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { asBody, countAt, countWhere, nextCursor, shapeOf, sumField } from "./probeBody.js";
import { parseSlackProbeArgs, renderProbe, type SlackProbeOptions } from "./probeCore.js";
import { type SlackRead, SlackReadErrors, slackReadErrorLines } from "./readErrors.js";
import { SLACK_PROBE_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes and no network. */
export interface SlackProbeDeps {
  readonly token: (args: { bot: boolean; home: string | undefined }) => string | undefined;
  readonly call: (args: {
    token: string;
    method: string;
    params: Readonly<Record<string, string>>;
  }) => Promise<SlackRead<Record<string, unknown>>>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Issue one read-only Web API call.
 *
 * `apiCall` rather than a typed method, because the whole point is to send parameters the typed surface
 * does not declare — that is what makes an undocumented argument testable at all.
 *
 * @param token the Slack token to authenticate with
 * @param method the dotted method name, already checked against the allowlist
 * @param params the call arguments
 * @returns the response body, or the reason the call could not be made
 */
export async function liveProbeCall({
  token,
  method,
  params,
}: {
  token: string;
  method: string;
  params: Readonly<Record<string, string>>;
}): Promise<SlackRead<Record<string, unknown>>> {
  // `apiCall` with arbitrary parameters is the point, and no typed seam exposes it. Rate limits are
  // surfaced rather than slept off inside the SDK, so `safeProviderCall` below owns the backoff exactly as
  // the ingest seams do.
  // devlint: sdk-factory -- the probe's own read-only client, paced through the shared block below
  const client = new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const called = await safeProviderCall({
    execute: () => client.apiCall(method, params),
    // Paced and blocked with every other Slack caller in this process. A probe that ran outside the shared
    // block would be invisible to the ingest's backoff while spending the same per-method quota — which is
    // the exact asymmetry `rateBlock.ts` exists to remove.
    // One STATIC label. A template literal would carry the method name, which reads like better telemetry
    // and is unusable: `OPERATION_ENDPOINT_CLASS` is a static table, so a computed label matches nothing.
    operation: "slack.probe",
    provider: "slack",
    retryMode: "transient",
    scopeId: scopeIdForToken({ token }),
  });
  if (called.isOk()) {
    return ok(asBody({ value: called.value }));
  }
  // A Slack error carries its own body, and that body IS the answer a probe wants: `not_allowed` and
  // `missing_scope` are findings, not failures. Only a transport error has nothing to report.
  const data: unknown = isRecord(called.error.cause) ? called.error.cause["data"] : undefined;
  return isRecord(data) ? ok(data) : err(SlackReadErrors.probeCallFailed({ method, reason: called.error.message }));
}

/** Everything the call needs, once the flags, the allowlist and the credential have all agreed. */
interface ReadyProbe {
  readonly options: SlackProbeOptions;
  readonly request: ProbeRequest;
  readonly token: string;
}

/**
 * Resolve the flags, the allowlist and the credential — the three ways this verb can refuse before it
 * makes a call. Split out so the run function is the call and the report, and each refusal keeps the exit
 * code it earns: a bad flag or a refused method is USAGE, a missing credential is an ERROR.
 *
 * @param rest the argv tail after `slack probe`
 * @param deps the injected edges
 * @returns what the call needs, or the problems to print and the code to exit with
 */
function prepare({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackProbeDeps;
}): Result<ReadyProbe, { problems: readonly string[]; exit: number }> {
  const parsed = parseSlackProbeArgs({ rest });
  if (parsed.isErr()) {
    return err({
      exit: EXIT_USAGE,
      problems: [...slackArgumentErrorLines({ error: parsed.error }), SLACK_PROBE_USAGE],
    });
  }
  const options = parsed.value;
  const resolved = resolveProbe({ method: options.method, params: options.params });
  if (!resolved.isOk()) {
    return err({ exit: EXIT_USAGE, problems: resolved.error.map((refusal) => refusal.message) });
  }
  const token = deps.token({ bot: options.bot, home: options.home });
  if (token === undefined) {
    return err({
      exit: EXIT_ERROR,
      problems: [
        options.bot
          ? "no bot token — set SLACK_BOT_TOKEN or run `slopweaver secrets set slack-bot-token`"
          : "no user token — set SLACK_USER_TOKEN or run `slopweaver secrets set slack-user-token`",
      ],
    });
  }
  return ok({ options, request: resolved.value, token });
}

/** One cursor walk's outcome: the last page's body, plus the totals accumulated across every page. */
interface Walk {
  readonly body: Record<string, unknown>;
  readonly count: number | undefined;
  readonly sum: number | undefined;
  readonly matched: { readonly matched: number; readonly of: number } | undefined;
  readonly paging: { readonly pages: number; readonly bounded: boolean } | undefined;
}

/** The running totals a cursor walk accumulates. All three are `undefined` until something asks for them. */
interface Totals {
  readonly count: number | undefined;
  readonly sum: number | undefined;
  readonly matched: { readonly matched: number; readonly of: number } | undefined;
}

/**
 * One measurement's running total after a page. A page that did not measure it leaves the total as it was,
 * and the first page that does measure it STARTS the total rather than adding to a nought nobody asked for.
 *
 * @param total the total across the pages before this one, `undefined` until one measured it
 * @param page this page's own figure, `undefined` when it was not asked for
 * @returns the total including this page
 */
function addPage({ total, page }: { total: number | undefined; page: number | undefined }): number | undefined {
  if (page === undefined) {
    return total;
  }
  if (total === undefined) {
    return page;
  }
  return total + page;
}

/**
 * The `--count-where` tally after a page, by {@link addPage}'s rule for each of its two figures.
 *
 * @param total the tally across the pages before this one, `undefined` until one measured it
 * @param page this page's own tally, `undefined` when `--count-where` was not given
 * @returns the tally including this page
 */
function addMatched({
  total,
  page,
}: {
  total: Totals["matched"];
  page: { readonly matched: number; readonly of: number } | undefined;
}): Totals["matched"] {
  if (page === undefined) {
    return total;
  }
  if (total === undefined) {
    return { matched: page.matched, of: page.of };
  }
  return { matched: total.matched + page.matched, of: total.of + page.of };
}

/**
 * How many pages the walk may fetch: the `--exhaust` bound, or the one page a plain probe reads.
 *
 * @param options the resolved invocation
 * @returns the page bound
 */
function pageBound({ options }: { options: SlackProbeOptions }): number {
  const exhaust = options.exhaust;
  if (exhaust === undefined) {
    return 1;
  }
  return exhaust;
}

/**
 * Fold one page's measurements into the running totals.
 *
 * A measurement nobody asked for stays `undefined` rather than becoming `0`, all the way through: zero is a
 * result and "not asked" is not, and collapsing the two is how a walk that measured nothing reports a
 * confident nought.
 *
 * @param body the page's response
 * @param options the resolved invocation, for the count/sum/where specs
 * @param totals the totals so far
 * @returns the totals including this page
 */
function accumulate({
  body,
  options,
  totals,
}: {
  body: Record<string, unknown>;
  options: SlackProbeOptions;
  totals: Totals;
}): Totals {
  const pageCount = options.countField === undefined ? undefined : countAt({ body, path: options.countField });
  const pageSum = options.sumField === undefined ? undefined : sumField({ body, spec: options.sumField });
  const pageWhere = options.countWhere === undefined ? undefined : countWhere({ body, spec: options.countWhere });
  return {
    count: addPage({ page: pageCount, total: totals.count }),
    matched: addMatched({ page: pageWhere, total: totals.matched }),
    sum: addPage({ page: pageSum, total: totals.sum }),
  };
}

/**
 * Follow `next_cursor` up to a bound, accumulating the counts across every page.
 *
 * This is what turns the probe from a shape reader into a RECALL instrument. A method's first page tells
 * you what its results look like; only the exhausted walk tells you how many there are, and that is the
 * property a candidate detector lives or dies on. The bound is reported rather than applied silently:
 * a truncated walk whose total reads like a total is the exact wrong answer this verb exists to avoid.
 *
 * @param request the resolved method and its arguments
 * @param token the credential
 * @param options the resolved invocation, for the count/sum/where specs and the page bound
 * @param call the injected transport
 * @returns the accumulated walk, or the reason a page could not be fetched
 */
async function walkPages({
  request,
  token,
  options,
  call,
}: {
  request: ProbeRequest;
  token: string;
  options: SlackProbeOptions;
  call: SlackProbeDeps["call"];
}): Promise<SlackRead<Walk>> {
  const maxPages = pageBound({ options });
  let cursor: string | undefined;
  let pages = 0;
  let totals: Totals = { count: undefined, matched: undefined, sum: undefined };
  let body: Record<string, unknown> = {};
  for (; pages < maxPages; pages += 1) {
    const params = cursor === undefined ? request.params : { ...request.params, cursor };
    const page = await call({ method: request.method, params, token });
    if (page.isErr()) {
      return err(page.error);
    }
    body = page.value;
    totals = accumulate({ body, options, totals });
    cursor = nextCursor({ body });
    if (cursor === undefined) {
      pages += 1;
      break;
    }
  }
  return ok({
    body,
    ...totals,
    paging: options.exhaust === undefined ? undefined : { bounded: cursor !== undefined, pages },
  });
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `slack probe`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackProbe({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackProbeDeps;
}): Promise<number> {
  const ready = prepare({ deps, rest });
  if (ready.isErr()) {
    for (const problem of ready.error.problems) {
      deps.writeDiagnostic(problem);
    }
    return ready.error.exit;
  }
  const { options, request, token } = ready.value;
  const started = deps.nowMs();
  const walked = await walkPages({ call: deps.call, options, request, token });
  if (walked.isErr()) {
    for (const problem of slackReadErrorLines({ error: walked.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const walk = walked.value;
  // The shape comes from the LAST page and the totals from every page. Splitting them is the point: a
  // shape is a per-response fact, and a recall figure is not.
  const shaped = shapeOf({
    body: walk.body,
    countField: undefined,
    countWhereSpec: undefined,
    elapsedMs: deps.nowMs() - started,
    expect: options.expect,
    method: request.method,
    paging: walk.paging,
    scopes: options.scopes,
    shapeAt: options.shapeAt,
    sumSpec: undefined,
  });
  const report = { ...shaped, count: walk.count, sum: walk.sum, where: walk.matched };
  deps.writeOut(options.json ? JSON.stringify(report, null, 2) : renderProbe({ report }));
  // A Slack-level failure is a finding worth reporting, and also a non-zero exit, so a script that chains
  // probes stops on one rather than reading the next report as if the first had succeeded.
  return report.ok ? EXIT_OK : EXIT_ERROR;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackProbeDeps(): SlackProbeDeps {
  return {
    call: liveProbeCall,
    nowMs: () => Date.now(),
    token: ({ bot, home }) => {
      const homeArgs = home !== undefined ? { home } : {};
      return bot ? slackBotToken(homeArgs) : slackUserToken(homeArgs);
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack probe` — one read-only Web API call, reported as a shape. */
export const slackProbeCommand = defineCommand({
  run: (argv) => runSlackProbe({ deps: productionSlackProbeDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
