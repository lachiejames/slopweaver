/**
 * `slopweaver connect <github|slack|linear|notion|gmail|datadog|outlook> --check [--json]` — the read-only preflight. It proves a
 * source's token reaches the API and reports the EXACT scopes/capabilities that source's ingest needs
 * (Slack `users:read.email`, Notion read-user-email, GitHub `read:org` + SAML), plus a 1-item read probe
 * that catches "token valid but no data visible". `--json` emits a stable, value-free shape the
 * `/slopweaver:onboard` slash command branches on. Diagnostic + external-read: a non-zero exit REPORTS a
 * not-ready connection (a finding), never a broken tool; nothing outbound is mutated. The one local write is
 * credential maintenance: the Outlook probe refreshes its token silently, and MSAL may rotate the stored cache.
 *
 * A thin effectful shell: arg parsing ({@link parseConnectArgs}) + org resolution + the per-source report
 * classification are pure/injected; the SDK probes are the only I/O, wired in {@link productionConnectDeps}
 * and faked in tests, so dispatch + JSON + the exit code are unit-tested with plain fakes.
 */
import {
  githubToken,
  linearToken,
  notionToken,
  parseRepositorySlug,
  resolveRepository,
  slackBotToken,
  slackUserToken,
} from "../../../config.js";
import { checkDatadogConnection } from "../../../connect/datadog.js";
import { type ConnectFixtureScenario, connectFixtureReport, selectConnectFixture } from "../../../connect/fixture.js";
import { checkGithubConnection } from "../../../connect/github.js";
import { checkLinearConnection } from "../../../connect/linear.js";
import { checkNotionConnection } from "../../../connect/notion.js";
import {
  makeGithubConnectProbes,
  makeLinearConnectProbes,
  makeNotionConnectProbes,
  makeSlackConnectProbes,
  makeSlackWriteAuth,
} from "../../../connect/probes.js";
import { renderConnectJson, renderConnectText } from "../../../connect/render.js";
import { checkSlackConnection } from "../../../connect/slack.js";
import { type ConnectCheckReport, type ConnectTarget, noTokenReport } from "../../../connect/types.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { CONNECT_TARGETS } from "../../../integrations/corpusSources.js";
import type { Logger } from "../../../lib/logger.js";
import { logger } from "../../../lib/logger.js";
import { isOneOf } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { CONNECT_USAGE } from "./connectUsage.js";
import { gmailReport, outlookReport } from "./mailboxReports.js";

const USAGE = CONNECT_USAGE;

/** The validated `connect` request. */
interface ConnectArgs {
  readonly source: ConnectTarget;
  readonly json: boolean;
  readonly repo?: string;
  readonly githubOrg?: string;
  /** Which state home the GitHub token, the Gmail grant, and Datadog's keys and site, are read from. */
  readonly home?: string;
}

/**
 * Parse the `connect` tail: a leading `<source>` positional then flags. Pure — a missing/unknown source or
 * a bad flag is an error. `--check` is accepted (the only mode) but not required.
 *
 * @param rest the tail after `connect` (a leading `check` verb word already stripped)
 * @returns the validated request, or the accumulated errors
 */
export function parseConnectArgs({ rest }: { rest: readonly string[] }): Result<ConnectArgs> {
  const rawSource = rest[0];
  if (rawSource === undefined || rawSource.startsWith("-")) {
    return err([`missing source (expected ${CONNECT_TARGETS.join(" | ")})`, USAGE]);
  }
  if (!isOneOf(rawSource, CONNECT_TARGETS)) {
    return err([`unknown source: ${rawSource} (expected ${CONNECT_TARGETS.join(" | ")})`, USAGE]);
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["check", "json"], value: ["repo", "github-org", "home"] },
  });
  if (parsed.isErr()) {
    return err([...parsed.error, USAGE]);
  }
  const { values } = parsed.value;
  return ok({
    json: parsed.value.flags.has("json"),
    source: rawSource,
    ...(values["repo"] !== undefined ? { repo: values["repo"] } : {}),
    ...(values["github-org"] !== undefined ? { githubOrg: values["github-org"] } : {}),
    ...(values["home"] !== undefined ? { home: values["home"] } : {}),
  });
}

/**
 * The resolved Slack tokens. `read`/`kind` are the read chain (user beats bot; none ⇒ unconfigured);
 * `write` is the BOT token and `userWrite` the USER token, each kept separate because all three are
 * frequently different tokens with different verdicts — reporting the read token's scopes as the write
 * verdict is the defect this splits.
 *
 * `userWrite` duplicates `read` whenever the read chain resolved to the user token, and that is fine: the
 * point is that the AS-ME send verdict is computed from the token as-me sends with, not inherited from
 * whichever token happened to win an unrelated chain.
 */
interface SlackTokens {
  readonly read?: string;
  readonly kind: "user" | "bot" | "none";
  readonly write?: string;
  readonly userWrite?: string;
}

/** The injectable effectful seams the `connect` shell composes (fakes in tests, production below). */
export interface ConnectDeps {
  /** The GitHub token for `home`, so `--home B` checks B's stored `github-token`, not the ambient one. */
  readonly githubToken: (args: { home: string | undefined }) => string | undefined;
  readonly slackTokens: () => SlackTokens;
  readonly linearToken: () => string | undefined;
  readonly notionToken: () => string | undefined;
  readonly resolveGithubOrg: (args: { repo?: string; githubOrg?: string }) => Result<string>;
  readonly connectGithub: (args: { org: string; token: string | undefined }) => Promise<ConnectCheckReport>;
  readonly connectSlack: (args: {
    token: string;
    kind: "user" | "bot";
    writeToken: string | undefined;
    userWriteToken: string | undefined;
  }) => Promise<ConnectCheckReport>;
  readonly connectLinear: (args: { token: string }) => Promise<ConnectCheckReport>;
  readonly connectNotion: (args: { token: string }) => Promise<ConnectCheckReport>;
  readonly connectGmail: (args: { home: string | undefined }) => Promise<ConnectCheckReport>;
  readonly connectDatadog: (args: { home: string | undefined }) => Promise<ConnectCheckReport>;
  readonly connectOutlook: (args: { home: string | undefined }) => Promise<ConnectCheckReport>;
  readonly logger: Pick<Logger, "out" | "error">;
}

/** The GitHub branch: resolve the org, then probe (a public probe when no token — read:org will surface). */
async function githubReport({ args, deps }: { args: ConnectArgs; deps: ConnectDeps }): Promise<ConnectCheckReport> {
  const org = deps.resolveGithubOrg({
    ...(args.repo !== undefined ? { repo: args.repo } : {}),
    ...(args.githubOrg !== undefined ? { githubOrg: args.githubOrg } : {}),
  });
  if (org.isErr()) {
    return noTokenReport({ hint: `could not resolve the org: ${org.error.join("; ")}`, source: "github" });
  }
  return deps.connectGithub({ org: org.value, token: deps.githubToken({ home: args.home }) });
}

/** Dispatch to the requested source's report, short-circuiting to a no-token report when unconfigured. */
async function reportFor({ args, deps }: { args: ConnectArgs; deps: ConnectDeps }): Promise<ConnectCheckReport> {
  switch (args.source) {
    case "github":
      return githubReport({ args, deps });
    case "slack": {
      const tokens = deps.slackTokens();
      return tokens.read !== undefined && tokens.kind !== "none"
        ? deps.connectSlack({
            kind: tokens.kind,
            token: tokens.read,
            userWriteToken: tokens.userWrite,
            writeToken: tokens.write,
          })
        : noTokenReport({
            hint: "set SLACK_USER_TOKEN or: slopweaver secrets set slack-user-token",
            source: "slack",
          });
    }
    case "linear": {
      const token = deps.linearToken();
      return token !== undefined
        ? deps.connectLinear({ token })
        : noTokenReport({ hint: "set LINEAR_API_KEY or: slopweaver secrets set linear-token", source: "linear" });
    }
    case "gmail":
      return deps.connectGmail({ home: args.home });
    case "datadog":
      return deps.connectDatadog({ home: args.home });
    case "outlook":
      return deps.connectOutlook({ home: args.home });
    case "notion": {
      const token = deps.notionToken();
      return token !== undefined
        ? deps.connectNotion({ token })
        : noTokenReport({ hint: "set NOTION_TOKEN or: slopweaver secrets set notion-token", source: "notion" });
    }
    default: {
      // ConnectTarget is derived from the registry, so a new connect target fails to compile here rather than being
      // parsed and then preflighted as whichever source the last branch happened to name.
      const unhandled: never = args.source;
      return unhandled;
    }
  }
}

/**
 * Run `connect` over injected dependencies — the testable shell.
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code (0 ready, 2 usage, 3 not-ready finding)
 */
export async function runConnectWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ConnectDeps;
}): Promise<number> {
  const tail = argv.slice(3);
  const rest = tail[0] === "check" ? tail.slice(1) : tail;
  if (rest.includes("--help") || rest.includes("-h") || rest.length === 0) {
    deps.logger.out({ line: USAGE });
    return rest.length === 0 ? EXIT_USAGE : EXIT_OK;
  }
  const parsed = parseConnectArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    return EXIT_USAGE;
  }
  const report = await reportFor({ args: parsed.value, deps });
  if (parsed.value.json) {
    deps.logger.out({ line: renderConnectJson({ report }) });
  } else {
    renderConnectText({ report }).forEach((line) => {
      deps.logger.out({ line: line });
    });
  }
  return report.ok ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Resolve the Slack tokens: the read chain (a user token wins, else a bot token, else none) plus EACH send
 * token on its own, because those are the tokens a send uses regardless of which one wins the read chain.
 */
function productionSlackTokens(): SlackTokens {
  const userToken = slackUserToken();
  const botToken = slackBotToken();
  const resolved = resolveSlackReadToken({ botToken, userToken });
  const writeTokens = {
    ...(botToken !== undefined ? { write: botToken } : {}),
    ...(userToken !== undefined ? { userWrite: userToken } : {}),
  };
  if (resolved.token === undefined) {
    return { kind: "none", ...writeTokens };
  }
  return { kind: userToken !== undefined ? "user" : "bot", read: resolved.token, ...writeTokens };
}

/** Resolve the GitHub org: `--github-org`, else `--repo` owner, else the current `origin` remote's owner. */
function productionResolveGithubOrg({ repo, githubOrg }: { repo?: string; githubOrg?: string }): Result<string> {
  if (githubOrg !== undefined) {
    return ok(githubOrg);
  }
  const parsed = repo !== undefined ? parseRepositorySlug({ slug: repo }) : resolveRepository();
  return parsed.isOk() ? ok(parsed.value.owner) : err(parsed.error);
}

/** Production dependencies (real token reads + SDK probes). */
function productionConnectDeps(): ConnectDeps {
  return {
    connectDatadog: ({ home }) => checkDatadogConnection({ home: resolveHome({ named: home }), logger }),
    connectGithub: ({ org, token }) =>
      checkGithubConnection({ probes: makeGithubConnectProbes({ org, token }), tokenPresent: token !== undefined }),
    connectGmail: ({ home }) => gmailReport({ home }),
    connectLinear: ({ token }) => checkLinearConnection({ probes: makeLinearConnectProbes({ token }) }),
    connectNotion: ({ token }) => checkNotionConnection({ probes: makeNotionConnectProbes({ token }) }),
    connectOutlook: ({ home }) => outlookReport({ home }),
    connectSlack: ({ kind, token, writeToken, userWriteToken }) =>
      checkSlackConnection({
        probes: makeSlackConnectProbes({ token }),
        tokenKind: kind,
        userWrite: makeSlackWriteAuth({ lane: "user", token: userWriteToken }),
        write: makeSlackWriteAuth({ lane: "bot", token: writeToken }),
      }),
    githubToken: ({ home }) => githubToken(home === undefined ? {} : { home }),
    linearToken,
    logger,
    notionToken,
    resolveGithubOrg: productionResolveGithubOrg,
    slackTokens: productionSlackTokens,
  };
}

/**
 * A clearly-fake, never-token-shaped stand-in so the fixture path never hits the "no token configured"
 * branch — the fixture's `connect*` functions below ignore whatever token they're handed anyway.
 */
const FIXTURE_TOKEN = "fixture-no-real-token";

/**
 * Fixture dependencies: every `connect*` call answers from {@link connectFixtureReport} regardless of its
 * arguments — no SDK client is ever constructed on this path, and no token is ever read for real.
 *
 * @param scenario the scenario the harness selected
 * @returns a `ConnectDeps` that never performs I/O
 */
function fixtureConnectDeps({ scenario }: { scenario: ConnectFixtureScenario }): ConnectDeps {
  return {
    connectDatadog: () => Promise.resolve(connectFixtureReport({ scenario, source: "datadog" })),
    connectGithub: () => Promise.resolve(connectFixtureReport({ scenario, source: "github" })),
    connectGmail: () => Promise.resolve(connectFixtureReport({ scenario, source: "gmail" })),
    connectLinear: () => Promise.resolve(connectFixtureReport({ scenario, source: "linear" })),
    connectNotion: () => Promise.resolve(connectFixtureReport({ scenario, source: "notion" })),
    connectOutlook: () => Promise.resolve(connectFixtureReport({ scenario, source: "outlook" })),
    connectSlack: () => Promise.resolve(connectFixtureReport({ scenario, source: "slack" })),
    githubToken: () => FIXTURE_TOKEN,
    linearToken: () => FIXTURE_TOKEN,
    logger,
    notionToken: () => FIXTURE_TOKEN,
    resolveGithubOrg: () => ok("fixture-org"),
    slackTokens: () => ({ kind: "user", read: FIXTURE_TOKEN }),
  };
}

/** The injectable seams `runConnectWithRuntime` chooses between — production wiring is lazy on both sides. */
export interface ConnectRuntimeDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Never called on the fixture path — a stray env var can never cause a real dependency bag to be built. */
  readonly liveDeps: () => ConnectDeps;
  /** Never called on the live path. */
  readonly fixtureDeps: (args: { scenario: ConnectFixtureScenario }) => ConnectDeps;
}

/**
 * Choose between a live and a fixture `connect` run, then hand off to {@link runConnectWithDeps} — which
 * remains the sole parse/dispatch/render/exit-code authority either way.
 *
 * @param argv the full process argv
 * @param deps the runtime selection seams
 * @returns the process exit code
 */
export async function runConnectWithRuntime({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ConnectRuntimeDeps;
}): Promise<number> {
  const selection = selectConnectFixture({ env: deps.env });
  if (selection.isErr()) {
    selection.error.forEach((e) => {
      logger.error({ msg: e });
    });
    return EXIT_USAGE;
  }
  const connectDeps =
    selection.value === undefined ? deps.liveDeps() : deps.fixtureDeps({ scenario: selection.value.scenario });
  return runConnectWithDeps({ argv, deps: connectDeps });
}

/** Production runtime seams: the real environment, lazy live deps, lazy fixture deps. */
function productionConnectRuntimeDeps(): ConnectRuntimeDeps {
  return { env: process.env, fixtureDeps: fixtureConnectDeps, liveDeps: productionConnectDeps };
}

/**
 * Run the `connect` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runConnect(argv: readonly string[]): Promise<number> {
  return runConnectWithRuntime({ argv, deps: productionConnectRuntimeDeps() });
}

export const connectCheckCommand = defineCommand({ run: runConnect });
