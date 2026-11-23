/**
 * INTEGRATION test: the Datadog client against the REAL Datadog API, recorded + replayed through a Polly
 * cassette (`../setup-polly.ts` + `../cassetteRedactConfig.ts#DATADOG`). This is the FIFTH provider config
 * (after Slack/Linear/GitHub/Gmail), and the first outside the corpus-ingest connectors — proving the
 * allowlist redactor generalises to an arbitrary outbound client rather than being four special cases
 * wearing a shared interface.
 *
 * ## What this proves, and precisely what it cannot
 *
 * Every response body here is walked by the `DATADOG` allowlist (see its own header comment in
 * `cassetteRedactConfig.ts`): only `overall_state`/`status`, `created`, `modified` and a closed, single-token
 * set of `type` values survive as verbatim strings, a string `id` becomes a synthetic `id_N`, and everything
 * else — monitor names, monitor messages, every query string, every tag, every host/service name, and a
 * monitor's own multi-word `type` — is `[REDACTED]`. So:
 *
 * **Proved here.** The five endpoints (`validate`, `permissions`, the logs aggregate, the metrics scalar
 * query, `listMonitors`) exist and answer for real credentials; `verifyCredentials` disambiguates a good pair
 * of keys; a logs/metrics aggregate response is read into the exact shape `logsCount.ts`/`metricsScalar.ts`
 * expect; a monitor's structural fields (`id`, `overall_state`) survive redaction and decode back to real,
 * closed-vocabulary values; and the observing `fetch` in `client.ts` really does see a live 429, parses
 * Datadog's rate-limit headers off it, and the SDK's own retry loop carries the call through to a real answer.
 *
 * **NOT proved here.** That a query naming real tag values (`service:`, `env:`, `host:`) round-trips through
 * this allowlist — every request is deliberately scoped to a name that matches NOTHING in this org, so the
 * response bodies never carry a real host, service or log line to redact in the first place. Nor is pagination
 * exercised — see `cq-r2-cassette-cursor-identity`.
 *
 * **No assertion below may depend on a string this org authored** (a monitor's name/message/query, a tag).
 * Numbers, the closed enum fields above, and a bucket's own arithmetic survive and are the only things
 * asserted.
 *
 * Run:
 *   yarn test:integration                                              # replay (default, offline)
 *   POLLY_MODE=record DD_API_KEY=… DD_APP_KEY=… yarn test:integration  # (re)record — reads real Datadog data
 *
 * Recording needs `DD_API_KEY`/`DD_APP_KEY` for the site named by {@link SITE} below (kept as a literal
 * rather than read from `DD_SITE`, because Polly matches on the request URL's HOSTNAME too — a replay run
 * must resolve to the exact host the cassette was recorded against, and the ambient environment's own
 * `DD_SITE` is not guaranteed to agree).
 */
import { describe, expect, it } from "vitest";

import { createDatadogClient, type DatadogClient } from "../../datadog/client.js";
import { type DatadogConfig, resolveDatadogConfig } from "../../datadog/config.js";
import { datadogConfigErrorLines } from "../../datadog/configErrors.js";
import { logsCount } from "../../datadog/logsCount.js";
import { metricsScalarCount } from "../../datadog/metricsScalar.js";
import { verifyCredentials } from "../../datadog/verifyCredentials.js";
import type { AbsoluteWindow } from "../../datadog/window.js";
import { createLogger, type Logger } from "../../lib/logger.js";
import { unwrap } from "../../lib/result.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/**
 * The site a cassette's URLs are hostnamed against — see this file's header. No Datadog cassette is committed, so
 * this is the synthetic `ap1` site; a re-record sets it to the site the keys belong to.
 */
const SITE = "ap1.datadoghq.com";

function requireRecordEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`set ${name} to record the Datadog cassette`);
  }
  return value;
}

/**
 * The config, built INSIDE each test rather than once at module scope — same reason as `githubWrite.test.ts`'s
 * `api()`: the cassette harness patches `globalThis.fetch` in `beforeEach`, after module evaluation, so a
 * client built at module scope would hold the pristine fetch and hit the real API for real while recording
 * nothing.
 *
 * @returns a validated config: the real credentials on record, shape-valid placeholders on replay (never
 *   checked — request headers are not part of the cassette match key)
 */
function config(): DatadogConfig {
  const env = RECORD
    ? {
        DD_API_KEY: requireRecordEnv({ name: "DD_API_KEY" }),
        DD_APP_KEY: requireRecordEnv({ name: "DD_APP_KEY" }),
        DD_SITE: SITE,
      }
    : { DD_API_KEY: "a".repeat(32), DD_APP_KEY: "b".repeat(40), DD_SITE: SITE };
  const resolved = resolveDatadogConfig({ env });
  if (resolved.isErr()) {
    throw new Error(
      `could not build a Datadog config for the integration cassette: ${datadogConfigErrorLines({ error: resolved.error }).join("; ")}`,
    );
  }
  return resolved.value;
}

/** A logger whose lines are never inspected — every test but the rate-limit one. */
function silentClient(): DatadogClient {
  return createDatadogClient({ config: config(), logger: createLogger({ sink: () => undefined }) });
}

/** A client plus every line its logger emitted, so the rate-limit test can assert the wait was announced. */
function observedClient(): { client: DatadogClient; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = createLogger({ sink: (line) => lines.push(line) });
  return { client: createDatadogClient({ config: config(), logger }), lines };
}

/**
 * A fixed absolute window, so the recorded aggregate response and this file's assertions describe the same
 * instant regardless of when the suite is replayed.
 */
const WINDOW: AbsoluteWindow = { fromMs: 1_788_256_000_000, toMs: 1_788_256_300_000 };

/**
 * A query scoped to a service that matches NOTHING in this org — the "dedicated service/env tag" the
 * handover doc asks for, chosen to be provably empty rather than merely narrow. A query over real traffic
 * would still be safe (the allowlist redacts every log/host/service string it could return), but a
 * deliberately-empty one means the recorded response carries no real telemetry to redact in the first place.
 */
const DEDICATED_LOGS_QUERY = "service:slopweaver-cassette-probe-nonexistent";
const DEDICATED_METRIC_QUERY = "sum:slopweaver.cassette.probe.nonexistent{*}.as_count()";

/** Datadog's own closed vocabulary for a monitor's live state (`MonitorOverallStates`) — never org content. */
const KNOWN_OVERALL_STATES = ["Alert", "Ignored", "No Data", "OK", "Skipped", "Unknown", "Warn"];

describe("datadog (integration — real Datadog via Polly cassette)", () => {
  it("verifies both DD_API_KEY and DD_APP_KEY against the real API", async () => {
    const client = silentClient();
    const result = await verifyCredentials({ client });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).site).toBe(SITE);
  });

  it("counts logs for a dedicated, deliberately empty scope over the fixed window", async () => {
    const client = silentClient();
    const result = await logsCount({ client, query: DEDICATED_LOGS_QUERY, window: WINDOW });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).count).toBe(0);
  });

  it("reads an ungrouped metric scalar for a dedicated, deliberately empty series", async () => {
    const client = silentClient();
    const result = await metricsScalarCount({
      client,
      expectedGroupTags: [],
      limit: 10,
      query: DEDICATED_METRIC_QUERY,
      window: WINDOW,
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).buckets).toStrictEqual([]);
  });

  it("reads one monitor and its structural state, which is what the allowlist actually preserves", async () => {
    const client = silentClient();
    const monitors = await client.monitors.listMonitors({ page: 0, pageSize: 1 });
    expect(monitors.length).toBe(1);
    const monitor = monitors[0]!;
    // A numeric id is never touched by the redactor at all (see `cassetteRedact.ts`) — asserted as the exact
    // recorded value rather than a shape check, because that IS the property: it survived
    // record→persist→replay unchanged, the same way a GitHub PR `number` does in `githubWrite.test.ts`.
    expect(monitor.id).toBe(50100);
    expect(KNOWN_OVERALL_STATES).toContain(monitor.overallState);
  });

  // LAST in the file, deliberately: it is the one test that runs the shared `logs_public_analytics_aggregate`
  // budget all the way to a 429, and every other test in this file also draws on that same real, per-account
  // budget (see `counts logs for a dedicated…` above). Running this one first once left THAT test's own
  // single call mid-retry at record time, colliding with this test's own ordered-matching entries and losing
  // its eventual 200 to Polly's default same-key collapse — replayed forever as the stale 429 it recorded.
  it("observes a real 429 and the SDK's own retry carries the call through to an answer", async () => {
    // Ordered matching, scoped to THIS test's own Polly instance (a fresh one per test — see
    // `setup-polly.ts`'s `beforeEach`), never leaking to the other tests above. It matters here and nowhere
    // else in this file: the retried call below issues TWO real HTTP requests to the identical logs-aggregate
    // endpoint (the 429 itself, then the SDK's own retry), and the default lenient match (`order: false`)
    // would replay the FIRST recorded entry — always the eventual 200 — to every request sharing that key, so
    // the 429 half would never actually replay.
    activePolly()
      ?.server.any()
      .on("request", (req) => {
        req.configure({ matchRequestsBy: { order: true } });
      });

    const { client, lines } = observedClient();
    const rateLimited = (): boolean => lines.some((line) => line.includes("rate-limited"));
    // Sequential, not concurrent: the real per-window budget (as few as 2 per 10s, observed in
    // `rateLimit.ts`'s header comment) is consumed request-by-request, and the recorded HAR order this
    // ordered match replays against is the order these calls actually reached Datadog in. Stops the moment a
    // 429 has actually been observed rather than firing a fixed count — each 429 costs a real
    // `x-ratelimit-reset` wait (the SDK's own retry, both at record time and on replay), and the window is a
    // real server-side clock rather than one anchored to this test's first call, so a fixed count either
    // risks never crossing the budget (an unlucky reset just before call three) or, if padded generously to
    // avoid that, keeps crossing it again on every call after a retry recovery and stacks several real waits
    // for no further evidence. Nine is a ceiling, not a target: TWO calls has been observed enough to exhaust
    // the budget (a residual window left over from an earlier test), so nine would already be a very unlucky
    // run.
    const results = [];
    for (let i = 0; i < 9 && !rateLimited(); i += 1) {
      results.push(await logsCount({ client, query: DEDICATED_LOGS_QUERY, window: WINDOW }));
    }

    expect(rateLimited()).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((result) => result.isOk())).toBe(true);
    expect(results.every((result) => unwrap(result).count === 0)).toBe(true);
    // Datadog's own fixed name for this budget — allowlisted verbatim only via the rate-limit HEADER set
    // (never the response body), so its survival proves the header allowlist actually round-trips.
    expect(client.lastRateLimit()?.name).toBe("logs_public_analytics_aggregate");
  });
});
