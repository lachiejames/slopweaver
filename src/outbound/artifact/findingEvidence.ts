/**
 * Which address a `finding` card may rest on: the system of record for the thing it claims, never a tracker.
 *
 * ## The ruling
 *
 * A daily hunt kept answering "no big issues in Datadog in the last twenty-four hours" when it should have
 * looked far beyond Datadog telemetry, at security and money among everything else. The form held its citation to a Datadog graph view, so a finding
 * evidenced in Xero, Vanta, CrowdStrike or the warehouse could never become the bot's card, and every hunt was
 * pulled back to the one source a card could cite.
 *
 * ## Why an allowlist, and never "any https"
 *
 * A finding is the ONE top-level post a high-stakes channel admits (`../slack/highStakesChannel.ts`), on the
 * grounds that it is defensible on its face. `skills/automation/reference/organisation-intelligence.md` names
 * the bar: a finding is evidenced from the system of record for what it claims, and a ticket alone is not
 * evidence. So each source below is a console the fleet already reads, Datadog keeps its exact graph-view check,
 * and a tracker or a conversation is refused by name. Adding a source is a one-line change with a test.
 *
 * Every host here was read off a link the repository's own atlases or docs already carry, not guessed.
 */
import { isDatadogConsoleHost } from "../../datadog/config.js";
import { isDatadogGraphUrl, servedPath } from "../assistant/graphFindings.js";

/** One console a finding may cite, and the path shapes on it that are a tracker rather than evidence. */
interface FindingEvidenceSource {
  /** Exact hostnames, matched whole, so `go.xero.com.example` is not Xero. */
  readonly hosts: readonly string[];
  /** The name a reader sees on the card's link, `the <name> view`. */
  readonly name: string;
  /** Paths on this host that track work rather than evidence it, refused as a tracker. */
  readonly trackerPaths?: readonly RegExp[];
}

/** The consoles a non-Datadog finding may cite, each a source the hunt reads. */
export const FINDING_EVIDENCE_SOURCES: readonly FindingEvidenceSource[] = [
  {
    hosts: ["github.com"],
    name: "GitHub",
    trackerPaths: [/^\/[^/]+\/[^/]+\/(issues|discussions|projects)(\/|$)/i, /^\/orgs\/[^/]+\/projects(\/|$)/i],
  },
  { hosts: ["go.xero.com", "reporting.xero.com"], name: "Xero" },
  { hosts: ["app.vanta.com"], name: "Vanta" },
  { hosts: ["falcon.crowdstrike.com", "falcon.us-2.crowdstrike.com"], name: "CrowdStrike" },
  { hosts: ["app.trelica.com"], name: "Trelica" },
  { hosts: ["app.hex.tech", "eu.hex.tech"], name: "Hex" },
  { hosts: ["admin.google.com"], name: "Google Admin" },
  { hosts: ["console.cloud.google.com"], name: "Google Cloud" },
  { hosts: ["console.jumpcloud.com"], name: "JumpCloud" },
  { hosts: ["dash.cloudflare.com"], name: "Cloudflare" },
  { hosts: ["app.nightfall.ai"], name: "Nightfall" },
  { hosts: ["app.inngest.com"], name: "Inngest" },
  { hosts: ["dashboard.knock.app"], name: "Knock" },
  { hosts: ["console.twilio.com"], name: "Twilio" },
];

/** The name a Datadog citation carries on the card. */
const DATADOG_SOURCE_NAME = "Datadog";

/** Hosts that hold tickets or conversation, refused by name because a tracker is where a finding STARTS. */
const TRACKER_HOSTS: readonly RegExp[] = [/^linear\.app$/, /\.atlassian\.net$/, /^([a-z0-9-]+\.)?slack\.com$/];

/** What one citation address is: a source a finding may rest on, or why it may not. */
export type FindingEvidence =
  { readonly kind: "admitted"; readonly name: string } | { readonly kind: "refused"; readonly reason: string };

/** The refusal for a tracker or a conversation, quoting the evidence bar. */
const TRACKER_REFUSAL =
  "citationUrl is a ticket or a conversation, and a finding is evidenced from the system of record for what it " +
  "claims; a tracker link alone is not evidence (skills/automation/reference/organisation-intelligence.md). " +
  "Cite the console that shows it happening.";

/** The refusal for an address on no listed console, naming the ones that are. */
function unlistedRefusal(): string {
  const names = [DATADOG_SOURCE_NAME, ...FINDING_EVIDENCE_SOURCES.map((source) => source.name)].join(", ");
  return (
    "citationUrl must open the system of record for the finding: a Datadog console graph view (logs, traces, " +
    `RUM, metric or dashboard), or an https page on one of ${names}. A new source is a one-line change to ` +
    "src/outbound/artifact/findingEvidence.ts."
  );
}

/**
 * Judge one citation address: Datadog by its exact graph-view check, every other source by https and a listed host.
 *
 * @param url the finding's `citationUrl`, as authored
 * @returns the source it rests on, or the refusal naming what would be admitted
 */
export function findingEvidenceOf({ url }: { url: string }): FindingEvidence {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "refused", reason: unlistedRefusal() };
  }
  const host = parsed.hostname.toLowerCase();
  if (isDatadogConsoleHost({ hostname: host })) {
    if (isDatadogGraphUrl({ url })) {
      return { kind: "admitted", name: DATADOG_SOURCE_NAME };
    }
    return { kind: "refused", reason: unlistedRefusal() };
  }
  if (TRACKER_HOSTS.some((pattern) => pattern.test(host))) {
    return { kind: "refused", reason: TRACKER_REFUSAL };
  }
  const source = FINDING_EVIDENCE_SOURCES.find((candidate) => candidate.hosts.includes(host));
  if (source === undefined || parsed.protocol !== "https:") {
    return { kind: "refused", reason: unlistedRefusal() };
  }
  const served = servedPath({ pathname: parsed.pathname });
  if (served === undefined) {
    return { kind: "refused", reason: unlistedRefusal() };
  }
  // A repeated slash and a capitalised segment still reach the same page on a console, so a tracker path is
  // judged on the collapsed spelling and case-blind.
  const path = served.replace(/\/{2,}/g, "/");
  if (source.trackerPaths?.some((pattern) => pattern.test(path)) === true) {
    return { kind: "refused", reason: TRACKER_REFUSAL };
  }
  return { kind: "admitted", name: source.name };
}

/**
 * The label on a finding card's primary link: `the Datadog view`, `the Xero view`.
 *
 * @param url the finding's `citationUrl`
 * @returns the label naming the source, or `the cited view` for an address the form would refuse
 */
export function findingEvidenceLabel({ url }: { url: string }): string {
  const evidence = findingEvidenceOf({ url });
  if (evidence.kind === "refused") {
    return "the cited view";
  }
  return `the ${evidence.name} view`;
}
