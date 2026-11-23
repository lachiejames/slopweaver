/**
 * The `proposal` noun's rows of `helpTruth.test.ts`'s PROBES table: one valid argv fragment per advertised flag.
 *
 * Split out of that file along the noun seam because the registry file sits under the file-size ratchet at
 * its own size, and every proposal verb's probe rows (and the base invocations they reuse) belong to this one
 * noun. `helpTruth.test.ts` spreads this table into PROBES unchanged, so the contract it enforces is the same.
 */

/** A valid `proposal decide` invocation: --decision/--decider/--why are all required. */
const PROPOSAL_DECIDE_BASE_PROBE: readonly string[] = [
  "--decision",
  "ship it",
  "--decider",
  "the owner",
  "--why",
  "aligned",
];

/** A valid `proposal record-feedback` invocation: --where is required for the kinds that owe an answer. */
const PROPOSAL_RECORD_FEEDBACK_BASE_PROBE: readonly string[] = [
  "--kind",
  "pushback",
  "--who",
  "a reviewer",
  "--what",
  "too broad",
  "--where",
  "https://example.slack.com/archives/C123/p1785114398557099",
];

/** A valid `proposal answer-feedback` invocation: --id/--how are both required. */
const PROPOSAL_ANSWER_FEEDBACK_BASE_PROBE: readonly string[] = ["--id", "f1", "--how", "narrowed the scope"];

/** A valid `proposal supersede` invocation: --by/--why are both required. */
const PROPOSAL_SUPERSEDE_BASE_PROBE: readonly string[] = ["--by", "a-newer-proposal", "--why", "v2 shipped"];

/** A real-shaped Notion page id, for the verbs that take one. */
const NOTION_PAGE = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";

/** Every `proposal <verb>` row of the PROBES table, keyed exactly as that table keys them. */
export const PROPOSAL_PROBES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "proposal answer-feedback": {
    "--home": [...PROPOSAL_ANSWER_FEEDBACK_BASE_PROBE, "--home", "/tmp"],
    "--how": PROPOSAL_ANSWER_FEEDBACK_BASE_PROBE,
    "--id": PROPOSAL_ANSWER_FEEDBACK_BASE_PROBE,
    "--json": [...PROPOSAL_ANSWER_FEEDBACK_BASE_PROBE, "--json"],
  },
  "proposal audience": {
    "--audience": ["--audience", "the engineering channel"],
    "--home": ["--audience", "the engineering channel", "--home", "/tmp"],
    "--json": ["--audience", "the engineering channel", "--json"],
  },
  "proposal decide": {
    "--date": [...PROPOSAL_DECIDE_BASE_PROBE, "--date", "2026-08-01T00:00:00.000Z"],
    "--decider": PROPOSAL_DECIDE_BASE_PROBE,
    "--decision": PROPOSAL_DECIDE_BASE_PROBE,
    "--home": [...PROPOSAL_DECIDE_BASE_PROBE, "--home", "/tmp"],
    "--json": [...PROPOSAL_DECIDE_BASE_PROBE, "--json"],
    "--outcome": [...PROPOSAL_DECIDE_BASE_PROBE, "--outcome", "rejected"],
    "--why": PROPOSAL_DECIDE_BASE_PROBE,
  },
  "proposal destination": {
    "--home": ["show", "--home", "/tmp"],
    "--json": ["show", "--json"],
    "--parent": ["set", "notion-page", "--parent", NOTION_PAGE],
    "--target-id": ["set", "linear-document", "--target-kind", "team", "--target-id", NOTION_PAGE],
    "--target-kind": ["set", "linear-document", "--target-kind", "project", "--target-id", NOTION_PAGE],
  },
  "proposal draft": {
    "--form": [],
    "--form-example": ["--form-example"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/draft.md"],
  },
  "proposal drift": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--slug": ["--slug", "a-slug"],
  },
  "proposal feedback": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "pushback"],
    "--slug": ["--slug", "a-slug"],
    "--unanswered": ["--unanswered"],
  },
  "proposal follow-up": {
    "--date": ["--ref", "a-handover-doc", "--date", "2026-08-01T00:00:00.000Z"],
    "--home": ["--ref", "a-handover-doc", "--home", "/tmp"],
    "--json": ["--ref", "a-handover-doc", "--json"],
    "--label": ["--ref", "a-handover-doc", "--label", "the fix"],
    "--ref": ["--ref", "a-handover-doc"],
  },
  "proposal intake": {
    "--brief": [],
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "an-intake"],
    "--json": ["--json"],
  },
  "proposal lint": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "proposal list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--status": ["--status", "shared"],
  },
  "proposal publish": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--icon": ["--icon", "🧭"],
    "--intake": ["--intake", "an-intake"],
    "--json": ["--json"],
    "--title": ["--title", "A title"],
  },
  "proposal record-feedback": {
    "--date": [...PROPOSAL_RECORD_FEEDBACK_BASE_PROBE, "--date", "2026-08-01T00:00:00.000Z"],
    "--home": [...PROPOSAL_RECORD_FEEDBACK_BASE_PROBE, "--home", "/tmp"],
    "--json": [...PROPOSAL_RECORD_FEEDBACK_BASE_PROBE, "--json"],
    "--kind": PROPOSAL_RECORD_FEEDBACK_BASE_PROBE,
    "--what": PROPOSAL_RECORD_FEEDBACK_BASE_PROBE,
    "--where": PROPOSAL_RECORD_FEEDBACK_BASE_PROBE,
    "--who": PROPOSAL_RECORD_FEEDBACK_BASE_PROBE,
  },
  "proposal record-slack": {
    "--home": ["--permalink", "https://example.slack.com/archives/C123/p1785114398557099", "--home", "/tmp"],
    "--json": ["--permalink", "https://example.slack.com/archives/C123/p1785114398557099", "--json"],
    "--permalink": ["--permalink", "https://example.slack.com/archives/C123/p1785114398557099"],
  },
  "proposal show": {
    "--history": ["--history"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "proposal status": {
    "--date": ["--why", "posted to #dev", "--date", "2026-08-01T00:00:00.000Z"],
    "--home": ["--why", "posted to #dev", "--home", "/tmp"],
    "--json": ["--why", "posted to #dev", "--json"],
    "--why": ["--why", "posted to #dev"],
  },
  "proposal supersede": {
    "--by": PROPOSAL_SUPERSEDE_BASE_PROBE,
    "--date": [...PROPOSAL_SUPERSEDE_BASE_PROBE, "--date", "2026-08-01T00:00:00.000Z"],
    "--home": [...PROPOSAL_SUPERSEDE_BASE_PROBE, "--home", "/tmp"],
    "--json": [...PROPOSAL_SUPERSEDE_BASE_PROBE, "--json"],
    "--why": PROPOSAL_SUPERSEDE_BASE_PROBE,
  },
  "proposal sync": {
    "--home": ["--source", NOTION_PAGE, "--home", "/tmp"],
    "--json": ["--source", NOTION_PAGE, "--json"],
    "--limit": ["--source", NOTION_PAGE, "--limit", "50"],
    "--source": ["--source", NOTION_PAGE],
  },
  "proposal teaser": {
    "--form": [],
    "--home": ["--home", "/tmp"],
    "--intake": ["--intake", "an-intake"],
    "--json": ["--json"],
    "--page": ["--page", "https://app.notion.com/p/a-1"],
  },
};
