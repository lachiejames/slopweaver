/**
 * A bundled, SYNTHETIC, identifier-free demo corpus — the offline fast-loop fixture. `slopweaver seed
 * --demo` writes these through the real bronze writer so the WHOLE loop (`refresh`→`derive`→`distil`→
 * `store read`, and `audit`) runs end-to-end in seconds with NO network and NO tokens, exercising the REAL seams
 * on tiny data (not fake code paths).
 *
 * Every author is a NATIVE-ID-SHAPED fake, not a display name — `isNativeIdShaped` refuses a record whose
 * author isn't its source's id shape, so a fixture using `@alice`/`dave` would silently lose its own
 * people. Slack ids are digit-free upper-case (`UALICE`) and Linear/Notion ids are fake UUIDs, both chosen
 * to also dodge the hygiene gate's raw-workspace-id pattern (`[CUAW][A-Z0-9]{8,}` — only trips with a
 * digit in the tail). Everything else here stays hygiene-clean too: `*.example.com` urls, no absolute home
 * paths, no token shapes. It deliberately carries cross-container references (a cross-cutting concern) and
 * a title shared across sources (a duplication signal) so `derive` + `audit` have real structure to report.
 *
 * PR4.8 added the NOISE the silver quality pass exists to suppress, so the improvement is visible offline:
 * a bot-authored message + an integration-authored issue (both backed by {@link ./demoMembers.demoMembers}, so the
 * `profile.bot` / integration-email rules really fire), and a mined `@gmail` email fragment plus a shared
 * `@ops-oncall` handle spanning three containers (the generic + mention-only cross-cutting drops).
 *
 * Pure data — no clock, no IO.
 */
import type { CorpusRecord } from "../corpus/types.js";

/** The window the demo bronze is filed under (a fixed, synthetic month — no clock). */
export const DEMO_WINDOW = { since: "2026-06-01", until: "2026-07-01" } as const;

/** The shared cross-source concern the demo threads through every source (a cross-cutting + link signal). */
const CONCERN = "PAY-1";

/**
 * The demo's non-GitHub native ids — each id-SHAPED for its own source, never a display name. The three the
 * member rows in `./demoMembers.ts` carry are exported, and a test looks two of them up, so neither duplicates
 * the literal. The Slack one is a digit-free `U…` form and the rest are fake UUIDs, per the hygiene note in the
 * module docstring.
 */
export const SLACK_DEPLOY_BOT_ID = "UDEPLOYBOT";
export const LINEAR_DAVE_ID = "10000000-0000-4000-8000-000000000001";
export const LINEAR_TRACKER_SYNC_ID = "20000000-0000-4000-8000-000000000002";
const NOTION_ERIN_ID = "30000000-0000-4000-8000-000000000003";

/** A url on the synthetic demo domain for a source path. */
function demoUrl({ path }: { path: string }): string {
  return `https://demo.example.com/${path}`;
}

/**
 * A demo GitHub record's address, derived once from where it lives so its `sourceId` and `url` can never disagree:
 * the repository's path on the demo domain, the object's number and kind, and — for a reply on it — which reply.
 *
 * @param repo the repository's path segment on the demo domain
 * @param kind `pull` for a pull request, `issues` for an issue, as the url spells them
 * @param reply a review or comment on the object rather than the object itself
 * @returns the record's source, source id and url
 */
function demoGitHubAddress({
  repo,
  number,
  kind,
  reply,
}: {
  repo: "api" | "web";
  number: number;
  kind: "issues" | "pull";
  reply?: "comment" | "review";
}): Pick<CorpusRecord, "source" | "sourceId" | "url"> {
  const object = { sourceId: `#${number}`, url: `${repo}/${kind}/${number}` };
  if (reply === undefined) {
    return { source: "github", sourceId: object.sourceId, url: demoUrl({ path: object.url }) };
  }
  return {
    source: "github",
    sourceId: `${object.sourceId}:${reply}:0`,
    url: demoUrl({ path: `${object.url}#${reply}` }),
  };
}

/**
 * The synthetic demo corpus — a small multi-source table (~13 records across 6 containers). A flat, static,
 * identifier-free data literal (no logic): kept as a module const, not a function body, so it stays a data
 * table rather than a 150-line "function".
 */
const DEMO_RECORDS: readonly CorpusRecord[] = [
  {
    ...demoGitHubAddress({ kind: "pull", number: 101, repo: "web" }),
    author: "octo-dev",
    container: "acme-web",
    kind: "pr",
    refs: [CONCERN, "#7"],
    text: "Add a bounded retry to the payments client so a transient 500 doesn't drop a charge.",
    title: "Add payment retry",
    tsIso: "2026-06-03T09:00:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "pull", number: 101, repo: "web", reply: "review" }),
    author: "reviewer-kim",
    container: "acme-web",
    kind: "review",
    refs: [CONCERN],
    text: "Approving — please cap the retry count and add a jittered backoff before merge.",
    tsIso: "2026-06-03T11:30:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "pull", number: 101, repo: "web", reply: "comment" }),
    author: "octo-dev",
    container: "acme-web",
    kind: "comment",
    refs: ["#7"],
    text: "Backoff added. This closes the retry half of the payments reliability work.",
    tsIso: "2026-06-03T12:00:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "pull", number: 102, repo: "web" }),
    author: "octo-dev",
    container: "acme-web",
    kind: "pr",
    refs: [CONCERN],
    text: "Stabilise the flaky checkout end-to-end test that guards the payments path.",
    title: "Fix flaky checkout test",
    tsIso: "2026-06-05T14:00:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "issues", number: 7, repo: "api" }),
    author: "octo-dev",
    container: "acme-api",
    kind: "issue",
    refs: [CONCERN],
    text: "Define the canonical retry policy the web and mobile clients should both follow.",
    title: "Payments retry policy",
    tsIso: "2026-06-02T08:00:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "pull", number: 205, repo: "api" }),
    author: "dependabot[bot]",
    container: "acme-api",
    kind: "pr",
    refs: [],
    text: "Bump the http client dependency to the latest patch release.",
    title: "Bump deps",
    tsIso: "2026-06-06T02:00:00.000Z",
  },
  {
    author: "UALICE",
    container: "payments-war-room",
    kind: "message",
    refs: [CONCERN, "#7"],
    source: "slack",
    sourceId: "slack-msg-1",
    text: "Heads up: retries are landing this week — see the policy issue for the agreed limits.",
    tsIso: "2026-06-04T09:15:00.000Z",
    url: demoUrl({ path: "slack/payments-war-room/p1" }),
  },
  {
    author: "UBOB",
    container: "payments-war-room",
    kind: "message",
    refs: [CONCERN],
    source: "slack",
    sourceId: "slack-msg-2",
    text: "Confirmed the backoff numbers with the API team, we're aligned on the retry ceiling.",
    tsIso: "2026-06-04T10:05:00.000Z",
    url: demoUrl({ path: "slack/payments-war-room/p2" }),
  },
  {
    author: "UCAROL",
    container: "eng-general",
    kind: "message",
    refs: [CONCERN],
    source: "slack",
    sourceId: "slack-msg-3",
    text: "Nice — the payments retry work unblocks the mobile release we were holding.",
    tsIso: "2026-06-05T16:20:00.000Z",
    url: demoUrl({ path: "slack/eng-general/p9" }),
  },
  {
    author: LINEAR_DAVE_ID,
    container: "PAY",
    kind: "issue",
    refs: ["#7"],
    source: "linear",
    sourceId: CONCERN,
    text: "Track the payments retry policy rollout across the web and API services.",
    title: "Payments retry policy",
    tsIso: "2026-06-01T09:00:00.000Z",
    url: demoUrl({ path: "linear/PAY-1" }),
  },
  {
    author: LINEAR_DAVE_ID,
    container: "PAY",
    kind: "issue",
    refs: [CONCERN],
    source: "linear",
    sourceId: "PAY-2",
    text: "Add idempotency keys so a retried charge can never double-bill a member.",
    title: "Add idempotency keys",
    tsIso: "2026-06-07T09:00:00.000Z",
    url: demoUrl({ path: "linear/PAY-2" }),
  },
  {
    author: NOTION_ERIN_ID,
    container: "Runbooks",
    kind: "page",
    refs: [CONCERN],
    source: "notion",
    sourceId: "notion-page-1",
    text: "Runbook: how the payments retry policy behaves in an incident and who to page.",
    title: "Payments retry policy",
    tsIso: "2026-06-08T09:00:00.000Z",
    url: demoUrl({ path: "notion/runbooks/retry" }),
  },
  {
    author: NOTION_ERIN_ID,
    container: "Runbooks",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId: "notion-page-2",
    text: "Runbook: the on-call rotation, escalation ladder, and severity definitions.",
    title: "Oncall handbook",
    tsIso: "2026-06-09T09:00:00.000Z",
    url: demoUrl({ path: "notion/runbooks/oncall" }),
  },
  // ── PR4.8 noise: what the silver quality pass suppresses ───────────────────────────────────────────
  {
    // A BOT posting like a teammate (backed by a `profile.bot` member row) — dropped from the directory.
    author: SLACK_DEPLOY_BOT_ID,
    container: "eng-general",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "slack-msg-4",
    text: "Deploy of the api service finished in 41s. 12 checks passed.",
    tsIso: "2026-06-05T18:00:00.000Z",
    url: demoUrl({ path: "slack/eng-general/p12" }),
  },
  {
    // An INTEGRATION account (backed by a member row on an app email domain) — dropped from the directory.
    author: LINEAR_TRACKER_SYNC_ID,
    container: "PAY",
    kind: "issue",
    refs: [CONCERN],
    source: "linear",
    sourceId: "PAY-9",
    text: "Mirrored from the external tracker: retry policy rollout checklist.",
    title: "Mirror: retry policy rollout",
    tsIso: "2026-06-08T09:00:00.000Z",
    url: demoUrl({ path: "linear/PAY-9" }),
  },
  {
    // The `@gmail` fragment + a shared handle across 3 containers: a generic + a mention-only drop.
    ...demoGitHubAddress({ kind: "issues", number: 110, repo: "web" }),
    author: "octo-dev",
    container: "acme-web",
    kind: "issue",
    refs: ["@gmail", "@ops-oncall"],
    text: "Escalations still go to the shared alias ops@gmail.example.com — route them to @ops-oncall.",
    title: "Route escalations off the shared alias",
    tsIso: "2026-06-06T09:00:00.000Z",
  },
  {
    ...demoGitHubAddress({ kind: "issues", number: 7, repo: "api", reply: "comment" }),
    author: "reviewer-kim",
    container: "acme-api",
    kind: "comment",
    refs: ["@gmail", "@ops-oncall"],
    text: "Same here — ops@gmail.example.com is stale, @ops-oncall owns the rotation now.",
    tsIso: "2026-06-06T10:00:00.000Z",
  },
  {
    author: "UALICE",
    container: "payments-war-room",
    kind: "message",
    refs: ["@gmail", "@ops-oncall"],
    source: "slack",
    sourceId: "slack-msg-5",
    text: "Reminder: stop cc-ing ops@gmail.example.com, ping @ops-oncall instead.",
    tsIso: "2026-06-06T11:00:00.000Z",
    url: demoUrl({ path: "slack/payments-war-room/p5" }),
  },
];

/**
 * The bundled synthetic demo records ({@link DEMO_RECORDS}) — the offline fast-loop corpus.
 *
 * @returns the demo corpus records, in a stable order
 */
export function demoRecords(): readonly CorpusRecord[] {
  return DEMO_RECORDS;
}
