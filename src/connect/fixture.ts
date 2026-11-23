/**
 * Synthetic `connect --check` scenarios for exercising `/slopweaver:onboard`'s conduct without a live SDK
 * call or a real token — never a mock of the classifiers, a REUSE of them: each scenario builds a synthetic
 * probe (the same shape a real SDK call would resolve to) and feeds it through the real, already-tested
 * `classifyGithub`/`classifySlack`/`classifyLinear`/`classifyNotion`/`classifyDatadog`/`classifyOutlook`, so a fixture report can never drift
 * from what a live preflight would actually say for the same probe outcome.
 *
 * Selection requires BOTH `SLOPWEAVER_ONBOARD_HARNESS=1` and a valid `SLOPWEAVER_CONNECT_FIXTURE` — a single
 * stray env var can never divert a real preflight onto a fixture answer, and an unknown scenario value fails
 * loudly rather than silently falling back to either mode.
 */
import { err, ok, type Result } from "../lib/result.js";
import { classifyDatadog, type DatadogProbe } from "./datadog.js";
import { classifyGithub, type GithubProbe } from "./github.js";
import { classifyGmail, type GmailProbe } from "./gmail.js";
import { classifyLinear, type LinearProbe } from "./linear.js";
import { classifyNotion, type NotionProbe } from "./notion.js";
import { classifyOutlook, type OutlookProbe } from "./outlook.js";
import { classifySlack, type SlackProbe } from "./slack.js";
import type { ConnectCheckReport, ConnectTarget } from "./types.js";

/** The three scripted preflight scenarios the harness can select. */
export type ConnectFixtureScenario = "all-ready" | "slack-warning" | "notion-hard-gap";

const SCENARIOS: readonly ConnectFixtureScenario[] = ["all-ready", "slack-warning", "notion-hard-gap"];

/** Whether a raw string names a real scenario. Pure. */
function isConnectFixtureScenario(value: string): value is ConnectFixtureScenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

/** What `selectConnectFixture` decided: which scenario, if any, this run should use. */
export interface ConnectFixtureSelection {
  readonly scenario: ConnectFixtureScenario;
}

/**
 * Decide whether this invocation should answer from a fixture instead of a live probe. Pure.
 *
 * @param env the process environment
 * @returns the selected scenario; `undefined` when neither harness env var is set (the live path); an error
 *   when the two disagree (one set, not the other) or the scenario name is unrecognised — refusing rather
 *   than guessing which mode was meant
 */
export function selectConnectFixture({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<ConnectFixtureSelection | undefined> {
  const harnessFlag = env["SLOPWEAVER_ONBOARD_HARNESS"];
  const scenarioValue = env["SLOPWEAVER_CONNECT_FIXTURE"];
  if (harnessFlag === undefined && scenarioValue === undefined) {
    return ok(undefined);
  }
  if (harnessFlag !== "1") {
    return err([
      "SLOPWEAVER_CONNECT_FIXTURE is set but SLOPWEAVER_ONBOARD_HARNESS=1 is not — refusing rather than guessing which mode was meant",
    ]);
  }
  if (scenarioValue === undefined) {
    return err([
      `SLOPWEAVER_ONBOARD_HARNESS=1 but SLOPWEAVER_CONNECT_FIXTURE is not set — name one of: ${SCENARIOS.join(" | ")}`,
    ]);
  }
  if (!isConnectFixtureScenario(scenarioValue)) {
    return err([`unknown SLOPWEAVER_CONNECT_FIXTURE: ${scenarioValue} (expected ${SCENARIOS.join(" | ")})`]);
  }
  return ok({ scenario: scenarioValue });
}

/** A synthetic GitHub probe: healthy unless the scenario says otherwise (no scenario touches GitHub yet). */
function githubProbeFor(): GithubProbe {
  return { authReachable: true, reposSampled: 3, samlPresent: true, teamsReadable: true, tokenPresent: true };
}

/** A synthetic Slack probe — `slack-warning` reports a bot (reduced-breadth) token; every other scenario a user token. */
function slackProbeFor({ scenario }: { scenario: ConnectFixtureScenario }): SlackProbe {
  return {
    authReachable: true,
    channelsSampled: 4,
    emailVisible: true,
    humanMembersSampled: 6,
    membersSampled: 8,
    tokenKind: scenario === "slack-warning" ? "bot" : "user",
    write: { bot: { kind: "absent" }, user: { kind: "absent" } },
  };
}

/** A synthetic Linear probe: healthy in every scenario (no scenario touches Linear yet). */
function linearProbeFor(): LinearProbe {
  return { authReachable: true, curatedSampled: 1, issuesSampled: 5, projectsSampled: 2, usersSampled: 3 };
}

/**
 * A synthetic Gmail probe. Under `slack-warning` the grant is read-only, which is the shape the preflight
 * reports as WARNING rows rather than as a failure — the distinction the Gmail check exists to make, and the
 * one worth having a fixture for.
 */
function gmailProbeFor({ scenario }: { scenario: ConnectFixtureScenario }): GmailProbe {
  const full = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
  ];
  return {
    account: "fixture@example.invalid",
    grantPresent: true,
    grantedScopes: scenario === "slack-warning" ? full.slice(0, 2) : full,
    messagesTotal: 3,
    profileReachable: true,
  };
}

/** A synthetic Datadog probe: both keys verified in every scenario (no scenario touches Datadog yet). */
function datadogProbeFor(): DatadogProbe {
  return { configReasons: [], site: "us3.datadoghq.com", verification: "verified", verifyReasons: [] };
}

/** A synthetic Outlook probe: a full grant whose `/me` reached Graph, in every scenario. */
function outlookProbeFor(): OutlookProbe {
  return {
    account: "fixture@example.invalid",
    clientIdPresent: true,
    grantPresent: true,
    grantedScopes: ["User.Read", "Mail.ReadWrite", "MailboxSettings.Read", "Mail.Send"],
    meReachable: true,
    meRefusal: undefined,
  };
}

/** A synthetic Notion probe — `notion-hard-gap` reports a person user with NO email (the missing capability). */
function notionProbeFor({ scenario }: { scenario: ConnectFixtureScenario }): NotionProbe {
  return {
    anyPerson: true,
    authReachable: true,
    emailVisible: scenario !== "notion-hard-gap",
    pagesSampled: 2,
    usersSampled: 3,
  };
}

/**
 * Classify one source's synthetic probe for the selected scenario, through the real per-source classifier.
 *
 * @param scenario the selected fixture scenario
 * @param source which source's report to build
 * @returns the finalised report, exactly as a live preflight would render it for this probe outcome
 */
function classifyFor({
  scenario,
  source,
}: {
  scenario: ConnectFixtureScenario;
  source: ConnectTarget;
}): ConnectCheckReport {
  switch (source) {
    case "datadog":
      return classifyDatadog({ probe: datadogProbeFor() });
    case "github":
      return classifyGithub({ probe: githubProbeFor() });
    case "slack":
      return classifySlack({ probe: slackProbeFor({ scenario }) });
    case "linear":
      return classifyLinear({ probe: linearProbeFor() });
    case "gmail":
      return classifyGmail({ probe: gmailProbeFor({ scenario }) });
    case "outlook":
      return classifyOutlook({ probe: outlookProbeFor() });
    case "notion":
      return classifyNotion({ probe: notionProbeFor({ scenario }) });
    default: {
      // ConnectTarget is derived from the registry: a new target fails to compile here instead of reading as Notion.
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/**
 * Build the deterministic fixture report for one source under one scenario — no SDK client constructed, no
 * token read, no network call made.
 *
 * @param scenario the selected fixture scenario
 * @param source the source being previewed
 * @returns the report, carrying the additive `fixture` marker so it can never be mistaken for a live probe
 */
export function connectFixtureReport({
  scenario,
  source,
}: {
  scenario: ConnectFixtureScenario;
  source: ConnectTarget;
}): ConnectCheckReport {
  return { ...classifyFor({ scenario, source }), fixture: { scenario } };
}
