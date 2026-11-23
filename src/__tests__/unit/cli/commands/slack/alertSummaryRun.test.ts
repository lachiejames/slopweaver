import { describe, expect, it } from "vitest";

import type { BehindReading } from "../../../../../cli/commands/slack/alertBehindRun.js";
import type { ImpactReading } from "../../../../../cli/commands/slack/alertImpactRun.js";
import { runSlackAlertSummary } from "../../../../../cli/commands/slack/alertSummaryRun.js";
import type { SlackAlertSummaryDeps } from "../../../../../cli/commands/slack/alertSummarySource.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { type AlertSourceError, AlertSourceErrors } from "../../../../../live/slack/alertSourceErrors.js";
import type { RawAlertMessage } from "../../../../../live/slack/alertTally.js";
import { alertSummaryFormSchema } from "../../../../../outbound/artifact/alertSummary.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

/**
 * The instant every run in this file is taken at.
 *
 * Chosen to sit a hundred seconds after the `1700000000.x` timestamps the citation cases carry, and that is
 * load-bearing rather than tidy: the verb now crawls wider than the card's own window and cuts the result on
 * `ts` (`live/slack/alertTrend.ts`), so a fixture whose timestamps predate the clock by years lands in no
 * window at all and the card comes out empty.
 */
const TEST_NOW_MS = 1_700_000_100_000;

/** A notification the way a Slack app posts one. Alert names invented — this is a public repository. */
function notification({ title }: { title: string }): RawAlertMessage {
  return { attachments: [{ fallback: title }], text: "" };
}

/** A window with a clear noisiest alert, one that fragments per host, and two messages to skip. */
function windowMessages(): readonly RawAlertMessage[] {
  return [
    notification({ title: "Triggered: upstream latency on @host:node-1" }),
    notification({ title: "Triggered: upstream latency on @host:node-2" }),
    notification({ title: "Triggered: upstream latency on @host:node-3" }),
    notification({ title: "Recovered: queue depth high" }),
    notification({ title: "Triggered: queue depth high" }),
    { subtype: "channel_join", text: "someone joined" },
    { text: "anyone looking at this?" },
  ];
}

/** Everything the shell touches, captured. Plain functions — no mock, no spy, no module replacement. */
interface Harness {
  readonly deps: SlackAlertSummaryDeps;
  readonly behindAsked: readonly { home: string; windowMs: number; rows: number }[];
  readonly impactAsked: readonly { home: string; windowMs: number; rows: number }[];
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
  readonly tokensAsked: readonly (string | undefined)[];
}

function harness({
  messages = windowMessages(),
  noToken = false,
  readFails,
  workspaceUrl = () => Promise.reject(new Error("unused")),
  behind = { behind: [], warnings: [] },
  impact = { impacts: new Map(), warnings: [] },
}: {
  behind?: BehindReading;
  impact?: ImpactReading;
  messages?: readonly RawAlertMessage[];
  /** A separate flag rather than `token: undefined`, which a defaulted destructure would quietly overwrite. */
  noToken?: boolean;
  readFails?: AlertSourceError;
  workspaceUrl?: () => Promise<string | undefined>;
} = {}): Harness {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const tokensAsked: (string | undefined)[] = [];
  const behindAsked: { home: string; windowMs: number; rows: number }[] = [];
  const impactAsked: { home: string; windowMs: number; rows: number }[] = [];
  return {
    behindAsked,
    impactAsked,
    deps: {
      botToken: () => undefined,
      makeApi: ({ token: given }) => {
        tokensAsked.push(given);
        // `readWindow` is itself injected, so `history` only has to exist — the rejecting default on the other
        // methods proves the real seam is never reached, UNLESS a test opts in via `workspaceUrl` to exercise
        // citation resolution, which genuinely calls it.
        return {
          filesInfo: () => Promise.reject(new Error("unused")),
          grantedScopes: () => Promise.reject(new Error("unused")),
          history: () => Promise.reject(new Error("the real seam must not be reached in a unit test")),
          listChannels: () => Promise.reject(new Error("unused")),
          listUsers: () => Promise.reject(new Error("unused")),
          replies: () => Promise.reject(new Error("unused")),
          workspaceUrl,
        };
      },
      nowMs: () => TEST_NOW_MS,
      readBehind: ({ home, windowMs, rows }) => {
        behindAsked.push({ home, rows: rows.length, windowMs });
        return Promise.resolve(behind);
      },
      readImpact: ({ home, windowMs, rows }) => {
        impactAsked.push({ home, rows: rows.length, windowMs });
        return Promise.resolve(impact);
      },
      readWindow: () =>
        Promise.resolve(
          readFails === undefined ? ok({ cursorExhausted: true as const, messages, pageCount: 2 }) : err(readFails),
        ),
      // Not a `xoxp-`-shaped literal: the public hygiene gate treats that prefix as a leak CLASS regardless of
      // what follows it, and this seam only ever passes the string through.
      userToken: () => (noToken ? undefined : "a-read-token"),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    tokensAsked,
  };
}

/** The one JSON document a `--form` / `--json` run writes to stdout. */
function documentOf<T = unknown>({ out }: { out: readonly string[] }): T {
  return parseOwnJson<T>({ text: out.join("\n") });
}

describe("runSlackAlertSummary — the whole verb, through injected edges", () => {
  it("emits a form the schema accepts, with the counts the tally produced", async () => {
    const test = harness();
    const code = await runSlackAlertSummary({
      deps: test.deps,
      rest: ["--channel", "D1", "--lead", "Upstream is drowning the rest.", "--form"],
    });

    expect(code).toBe(EXIT_OK);
    const form = documentOf({ out: test.out });
    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
    expect(form).toEqual({
      kind: "alert-summary",
      label: "Alerts",
      lead: "Upstream is drowning the rest.",
      rows: [
        { count: 3, label: "upstream latency", severity: "red" },
        { count: 2, label: "queue depth high", severity: "red" },
      ],
      skipped: 2,
      // Every fixture message is untimestamped, so the span split puts them all in the CARD's window and the
      // baseline counts nothing. It is still emitted: a read baseline that counted zero and no baseline at all
      // are different facts, and `outbound/artifact/trend.ts` renders them differently.
      trend: { priorTotal: 0, priorWindows: 3 },
      window: "7d",
    });
  });

  it("crawls the baseline as well as the card's own window, and says which bound each used", async () => {
    const asked: string[] = [];
    const test = harness();
    const deps: SlackAlertSummaryDeps = {
      ...test.deps,
      readWindow: ({ oldest }) => {
        asked.push(oldest);
        return Promise.resolve(ok({ cursorExhausted: true as const, messages: windowMessages(), pageCount: 1 }));
      },
    };
    await runSlackAlertSummary({ deps, rest: ["--channel", "D1", "--window", "24h", "--form"] });

    // One crawl, over four windows: the card's own 24h plus ALERT_TREND_PRIOR_WINDOWS more of it.
    expect(asked).toEqual([String((TEST_NOW_MS - 4 * 86_400_000) / 1000)]);
  });

  it("falls back to the card's own window and says so when the wider crawl will not fit the page budget", async () => {
    const asked: string[] = [];
    const test = harness();
    const deps: SlackAlertSummaryDeps = {
      ...test.deps,
      readWindow: ({ oldest }) => {
        asked.push(oldest);
        if (asked.length === 1) {
          return Promise.resolve(err(AlertSourceErrors.windowTooLarge({ channel: "D1", maxMessages: 12_000 })));
        }
        return Promise.resolve(ok({ cursorExhausted: true as const, messages: windowMessages(), pageCount: 3 }));
      },
    };
    const code = await runSlackAlertSummary({ deps, rest: ["--channel", "D1", "--window", "24h", "--form"] });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([String((TEST_NOW_MS - 4 * 86_400_000) / 1000), String((TEST_NOW_MS - 86_400_000) / 1000)]);
    const form = documentOf<{ rows: readonly unknown[]; trend?: unknown }>({ out: test.out });
    expect(form.rows.length).toBe(2);
    expect(form.trend).toBeUndefined();
    expect(test.diagnostics.join(" ")).toContain("no trend comparison");
  });

  it("counts the messages BEHIND the card's window as the baseline, and never as rows", async () => {
    const hourMs = 3_600_000;
    const test = harness({
      messages: [
        { ...notification({ title: "Triggered: queue depth high" }), ts: String((TEST_NOW_MS - hourMs) / 1000) },
        // Three firings across the prior windows: the baseline, never a row.
        { ...notification({ title: "Triggered: queue depth high" }), ts: String((TEST_NOW_MS - 30 * hourMs) / 1000) },
        { ...notification({ title: "Triggered: queue depth high" }), ts: String((TEST_NOW_MS - 50 * hourMs) / 1000) },
        { ...notification({ title: "Triggered: disk writes" }), ts: String((TEST_NOW_MS - 80 * hourMs) / 1000) },
        // Past the whole span: counted nowhere at all.
        { ...notification({ title: "Triggered: disk writes" }), ts: String((TEST_NOW_MS - 200 * hourMs) / 1000) },
      ],
      workspaceUrl: () => Promise.resolve("https://acme.slack.com"),
    });
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--window", "24h", "--form"] });

    const form = documentOf<{
      rows: readonly { label: string; count: number }[];
      trend: { priorTotal: number; priorWindows: number };
    }>({ out: test.out });
    expect(form.rows).toEqual([
      { count: 1, citationUrl: expect.any(String), label: "queue depth high", severity: "red" },
    ]);
    expect(form.trend).toEqual({ priorTotal: 3, priorWindows: 3 });
  });

  it("carries what the noisiest monitors' own searches matched into the form, and says why a line is absent", async () => {
    const test = harness({
      behind: {
        behind: [{ events: 485, groups: [{ count: 474, name: "jobs-api" }], monitor: "upstream latency" }],
        warnings: ['no "behind it" line for monitor 7: the logs track timed out'],
      },
    });
    await runSlackAlertSummary({
      deps: test.deps,
      rest: ["--channel", "D1", "--window", "24h", "--home", "/sandbox", "--form"],
    });

    const form = documentOf<{ behind: unknown }>({ out: test.out });
    expect(form.behind).toEqual([
      { events: 485, groups: [{ count: 474, name: "jobs-api" }], monitor: "upstream latency" },
    ]);
    expect(test.behindAsked).toEqual([{ home: "/sandbox", rows: 2, windowMs: 86_400_000 }]);
    expect(test.diagnostics).toContain('no "behind it" line for monitor 7: the logs track timed out');
  });

  it("writes the form to STDOUT and every progress line to STDERR, so the pipe stays clean", async () => {
    const test = harness();
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    // The whole of stdout must parse as one document. A progress line landing here is the defect this pins.
    expect(() => documentOf({ out: test.out })).not.toThrow();
    expect(test.diagnostics).toEqual([]);
  });

  it("resolves the window against the injected clock, and reports the bound it used", async () => {
    const test = harness();
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--window", "24h", "--json"] });

    // TEST_NOW_MS minus 24h, in whole seconds — the CARD's own bound, not the wider one the crawl used.
    expect(documentOf({ out: test.out })).toMatchObject({ oldestTs: "1699913700", window: "24h" });
  });

  it("carries every sourcing fact in the --json document", async () => {
    const test = harness();
    await runSlackAlertSummary({
      deps: test.deps,
      rest: ["--channel", "D1", "--lead", "Upstream is drowning the rest.", "--json"],
    });

    expect(documentOf({ out: test.out })).toMatchObject({
      channel: "D1",
      distinctAlerts: 2,
      leadWritten: true,
      messagesRead: 7,
      notifications: 5,
      pageCount: 2,
      skipped: 2,
    });
  });

  it("reports readably by default, ending with the pipe that posts it", async () => {
    const test = harness();
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1"] });

    expect(test.out[0]).toBe("alert summary — channel=D1 window=7d");
    expect(test.out.at(-1)).toBe("    | slopweaver slack post --as bot --channel D1 --form - --dry-run");
  });

  it("passes the RESOLVED token to the api factory, so the read runs under the identity that was chosen", async () => {
    const test = harness();
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(test.tokensAsked).toEqual(["a-read-token"]);
  });

  it("carries no lead by default, since nothing here ever runs a model to write one", async () => {
    const test = harness();
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    expect(Object.hasOwn(documentOf({ out: test.out }), "lead")).toBe(false);
  });

  it("still emits a usable form when the supplied --lead sentence carries an invented number", async () => {
    // The adversarial case at the SEAM rather than in the unit: an operator-supplied sentence that insists on a
    // fabricated count costs the sentence and nothing else. The counts on the card never came from it.
    const test = harness();
    const code = await runSlackAlertSummary({
      deps: test.deps,
      rest: ["--channel", "D1", "--lead", "Roughly 900 alerts fired this week.", "--json"],
    });

    expect(code).toBe(EXIT_OK);
    const document = documentOf<{ leadWritten: boolean; notifications: number }>({ out: test.out });
    expect(document.leadWritten).toBe(false);
    expect(document.notifications).toBe(5);
    expect(test.diagnostics.join(" ")).toContain("the numbers never came from the sentence");
  });

  it("attaches a citation link built from the resolved workspace URL, when a message carried a ts", async () => {
    const test = harness({
      messages: [{ ...notification({ title: "Triggered: disk writes" }), ts: "1700000000.001100" }],
      workspaceUrl: () => Promise.resolve("https://acme.slack.com"),
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    const form = documentOf<{ rows: readonly { citationUrl?: string }[] }>({ out: test.out });
    expect(form.rows[0]!.citationUrl).toBe("https://acme.slack.com/archives/D1/p1700000000001100");
  });

  it("never calls workspaceUrl at all when no kept row carries a ts", async () => {
    let called = false;
    const test = harness({
      workspaceUrl: () => {
        called = true;
        return Promise.reject(new Error("must not be called"));
      },
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    expect(called).toBe(false);
  });

  it("degrades to no citation and a stated reason when the workspace URL cannot be resolved", async () => {
    const test = harness({
      messages: [{ ...notification({ title: "Triggered: disk writes" }), ts: "1700000000.001100" }],
      workspaceUrl: () => Promise.resolve(undefined),
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    const form = documentOf<{ rows: readonly { citationUrl?: string }[] }>({ out: test.out });
    expect(form.rows[0]!.citationUrl).toBeUndefined();
    expect(test.diagnostics.join(" ")).toContain(
      "no Slack-permalink fallback citation added: could not resolve the workspace URL",
    );
  });

  it("degrades to no citation and a stated reason when resolving the workspace URL throws", async () => {
    const test = harness({
      messages: [{ ...notification({ title: "Triggered: disk writes" }), ts: "1700000000.001100" }],
      workspaceUrl: () => Promise.reject(new Error("ECONNRESET")),
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    const form = documentOf<{ rows: readonly { citationUrl?: string }[] }>({ out: test.out });
    expect(form.rows[0]!.citationUrl).toBeUndefined();
    expect(test.diagnostics.join(" ")).toContain("no Slack-permalink fallback citation added: ECONNRESET");
  });

  it("prefers the alerting tool's OWN embedded link over a Slack permalink, and never calls workspaceUrl for it", async () => {
    let called = false;
    const test = harness({
      messages: [
        {
          attachments: [{ fallback: "Triggered: disk writes", title_link: "https://app.datadoghq.com/monitors/123" }],
          ts: "1700000000.001100",
        },
      ],
      workspaceUrl: () => {
        called = true;
        return Promise.reject(new Error("must not be called"));
      },
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    const form = documentOf<{ rows: readonly { citationUrl?: string }[] }>({ out: test.out });
    expect(form.rows[0]!.citationUrl).toBe("https://app.datadoghq.com/monitors/123");
    expect(called).toBe(false);
  });

  it("falls back to the Slack permalink only for a row whose own notification carried no link", async () => {
    const test = harness({
      messages: [
        {
          attachments: [{ fallback: "Triggered: disk writes", title_link: "https://app.datadoghq.com/monitors/123" }],
          ts: "1700000000.001100",
        },
        { ...notification({ title: "Triggered: queue depth high" }), ts: "1700000000.002200" },
      ],
      workspaceUrl: () => Promise.resolve("https://acme.slack.com"),
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    const form = documentOf<{ rows: readonly { label: string; citationUrl?: string }[] }>({ out: test.out });
    const withLink = form.rows.find((row) => row.label === "disk writes")!;
    const withoutLink = form.rows.find((row) => row.label === "queue depth high")!;
    expect(withLink.citationUrl).toBe("https://app.datadoghq.com/monitors/123");
    expect(withoutLink.citationUrl).toBe("https://acme.slack.com/archives/D1/p1700000000002200");
  });

  it("folds a tail past the row cap and says so, rather than dropping it quietly", async () => {
    const many = Array.from({ length: 14 }, (_unused, position) =>
      Array.from({ length: 14 - position }, () => notification({ title: `Triggered: alert-${String(position)}` })),
    ).flat();
    const test = harness({ messages: many });
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    const form = documentOf<{ rows: readonly unknown[]; omitted: unknown }>({ out: test.out });
    expect(form.rows.length).toBe(10);
    // Alerts 10..13 fired 4, 3, 2 and 1 times.
    expect(form.omitted).toEqual({ count: 10, monitors: 4 });
  });

  it("emits a quiet window as a form rather than as a failure", async () => {
    const test = harness({ messages: [] });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_OK);
    expect(documentOf({ out: test.out })).toEqual({
      kind: "alert-summary",
      label: "Alerts",
      rows: [],
      skipped: 0,
      trend: { priorTotal: 0, priorWindows: 3 },
      window: "7d",
    });
  });

  it("returns EXIT_USAGE and prints usage for a bad invocation, writing nothing to stdout", async () => {
    const test = harness();
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--window", "7d"] });

    expect(code).toBe(EXIT_USAGE);
    expect(test.out).toEqual([]);
    expect(test.diagnostics.join("\n")).toContain("usage: slopweaver slack alert-summary");
  });

  it("does not resolve a token when the invocation is already invalid", async () => {
    const test = harness();
    await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--window", "nope"] });

    expect(test.tokensAsked).toEqual([]);
  });

  it("returns EXIT_ERROR with the configuring command when no token is set", async () => {
    const test = harness({ noToken: true });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1"] });

    expect(code).toBe(EXIT_ERROR);
    expect(test.diagnostics).toEqual(["no Slack token configured; run `slopweaver connect slack`"]);
  });

  it("returns EXIT_ERROR and emits NO form when the window could not be read completely", async () => {
    const test = harness({
      readFails: AlertSourceErrors.cursorRepeated({ channel: "D1" }),
    });
    const code = await runSlackAlertSummary({ deps: test.deps, rest: ["--channel", "D1", "--form"] });

    expect(code).toBe(EXIT_ERROR);
    expect(test.out).toEqual([]);
    expect(test.diagnostics[0]!).toContain("refusing a possibly partial window");
  });
});
