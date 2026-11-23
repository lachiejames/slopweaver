/**
 * The generic capability TABLE — every source true for every Slopweaver installation, as data.
 *
 * Held apart from `./sourcePlan.ts`, which plans with it, along the seam the `file-size-ratchet` gate found:
 * the table is a document and the planner is behaviour, and a reader arriving for one never wants the other.
 * Nothing here is installation-specific — a private installation adds or replaces rows by id through
 * `mergedCapabilities`, which is what keeps its organisation names, repository paths and provider
 * identifiers out of this shared repository ([the partition](../../docs/constraints/partition.md)).
 *
 * ## The pattern most rows follow, and why
 *
 * A row names a cheap SCOPE command — which drives, which mailbox, which credential, which roster — and
 * puts the real reading verbs in its `coverage.detail`. That is deliberate, and measured: `drive list
 * --query` takes a Drive query EXPRESSION, Gmail's search ANDs its words, `github read` takes an object URL
 * and `knowledge recall` runs `websearch_to_tsquery`, so a whole natural-language question substituted into
 * one of them either fails outright or filters to nothing and reads as ABSENCE. Turning a question into
 * search terms is the visible session's judgement; a row's job is to be SEEN, and to say where to look and
 * how. `store read` is the exception because it is built to take a question.
 *
 * Which nouns of this build must appear here at all is not left to memory: `./sourceNouns.ts` partitions
 * every noun in `NOUN_GROUPS`, and `unit/canon/sourceNouns.test.ts` fails when a source-reading one has no
 * row. Almost every atlas row is DERIVED from `atlasPlatforms()` by `./atlasCapability.ts` rather than
 * written here, because a row somebody has to remember to write is a source that goes dark. An atlas row
 * is authored here only when the derivation cannot carry the question — a derived row's vocabulary is
 * built from the platform NAME alone, so a question that never names the vendor never reaches it.
 * `saas-spend` is that case and is the only one: it declares `sourceClass: "atlas"` on the trelica
 * platform, which is what suppresses the derived row rather than standing beside it. It lives in
 * `./spendCapability.ts` for the reason the last section here gives.
 *
 * ## One class of word, one row
 *
 * Two rows claiming the same kind of thing is how the SPEND finding happened, so the rule the rows below
 * keep is that a reader skimming for a word finds exactly one. Money RECEIVED is `billing` and says so;
 * money SPENT on SaaS is `saas-spend` and says so; the `audit` row's cost is the corpus's own INGEST
 * cost and says THAT. Each of the three names what it is not, because the failure is never a refusal — a
 * worker reads the nearest row and writes something fluent.
 *
 * ## A row whose RATIONALE is longer than the row gets its own module
 *
 * `./atlasEstateCapability.ts`, `./attachmentsCapability.ts` and `./spendCapability.ts` are the seams
 * `file-size-ratchet` found: this
 * file has to sit under the size cap, and a row carrying a measurement, a hand-off and a named sharp edge is
 * mostly prose that a reader skimming for a WORD never wants. Each row still lands in the table below by
 * reference, so nothing about merging, ordering or the noun partition changes.
 *
 * ## Which rows are not here
 *
 * A row a single integration answers for lives on that integration's manifest (`routing`, its `ordinal` the index it
 * takes in the merged table) and arrives through `integrationRoutingRowsOf`, so a new integration brings its own
 * row. What stays below is every row no one integration owns: the machinery, the corpus and the money pair.
 */
import { registeredIntegrations } from "../integrations/registry.js";
import { integrationRoutingRowsOf, mergedRoutingTable } from "../integrations/routing.js";
import { ATLAS_ESTATE_CAPABILITY } from "./atlasEstateCapability.js";
import { ATTACHMENTS_CAPABILITY } from "./attachmentsCapability.js";
import { QUESTION_COMMAND_TOKEN, type SourceCapability, UNKNOWN_COVERAGE, UNKNOWN_FRESHNESS } from "./profile.js";
import { BILLING_CAPABILITY, SAAS_SPEND_CAPABILITY } from "./spendCapability.js";

/** The rows no one integration owns, in the decisive order the merged table keeps between them. */
const LOCAL_CAPABILITIES: readonly SourceCapability[] = [
  {
    availability: {
      kind: "unavailable",
      reason:
        "Slopweaver has no direct production-database connector; use the installation's governed data access. " +
        "Where that access is a Hex workspace over the warehouse, the `hex` capability on this same roster is " +
        "the reader — masked and access-controlled by Hex itself, never ingested",
    },
    command: [],
    coverage: UNKNOWN_COVERAGE,
    effect: "read",
    freshness: UNKNOWN_FRESHNESS,
    id: "production-data",
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["prod", "production", "database", "db", "table", "query the db", "row", "rows", "migration"],
    truthMode: "current",
    what: "the production database and anything read out of it",
  },
  BILLING_CAPABILITY,
  SAAS_SPEND_CAPABILITY,
  ATLAS_ESTATE_CAPABILITY,
  {
    availability: { kind: "available" },
    command: ["slopweaver", "fleet", "status"],
    coverage: {
      detail:
        "every handover document currently on the orchestration board, each checked against its own worktree's current branch — never a general list of the owner's open pull requests, and never every repository the owner has",
      kind: "bounded",
    },
    effect: "read",
    freshness: { detail: "measured from git, GitHub and the run journal when called", kind: "live" },
    id: "fleet-status",
    owner: "slopweaver",
    sourceClass: "repository",
    terms: ["ci", "checks", "branch", "branches", "green", "failing checks"],
    truthMode: "current",
    what: "which pull request, if any, is open for each live or waiting orchestration workstream, and whether that workstream's own run is blocked",
  },
  {
    availability: { kind: "available" },
    command: ["slopweaver", "handover", "list"],
    coverage: { detail: "every handover document in the configured local board", kind: "complete" },
    effect: "read",
    freshness: { detail: "measured from handover documents and run journals when called", kind: "live" },
    id: "handover-list",
    owner: "slopweaver",
    sourceClass: "orchestration",
    terms: ["run", "runs", "workstream", "workstreams", "in flight", "orchestration", "handover", "blocked"],
    truthMode: "current",
    what: "the orchestration board and its runnable, active and waiting workstreams",
  },
  {
    availability: { kind: "available" },
    command: ["slopweaver", "queue", "list"],
    coverage: { detail: "every item in the configured local withheld queue", kind: "complete" },
    effect: "read",
    freshness: { detail: "measured from the queue when called", kind: "live" },
    id: "queue-list",
    owner: "slopweaver",
    sourceClass: "orchestration",
    terms: ["queue", "queued", "held", "withheld", "draft", "drafts", "approval", "approvals"],
    truthMode: "current",
    what: "the replies the admit door held rather than sent",
  },
  {
    availability: { kind: "available" },
    command: ["slopweaver", "audit", "run"],
    coverage: {
      detail:
        "metadata only: every source leg present in the configured local corpus, with its record count, newest record and INGEST cost — never a record's contents, so this leg can say the corpus holds 9,000 Slack records and nothing at all about what any of them says",
      kind: "complete",
    },
    effect: "read",
    freshness: { detail: "measured from the local corpus when called", kind: "snapshot" },
    id: "audit",
    owner: "slopweaver",
    // `artifact`, not `corpus`, and the id is deliberately unchanged. This row counts the corpus; it never
    // reads one of its records. Rendered under the history class it printed `current/read/corpus` — the
    // only corpus-class leg on a 44-row roster that had no history in it — so a session skimming for
    // history coverage found exactly one thing that looked like it and was not. `artifact` is this
    // installation describing ITSELF (beside `catalog`, which describes the build), which is what an audit
    // is. The id stays because it is the join key a private overlay replaces a generic row by
    // (`mergedCapabilities`), and renaming it would silently un-join any installation that had tuned it.
    sourceClass: "artifact",
    terms: ["corpus", "coverage", "stale", "staleness", "ingest", "records", "freshness"],
    truthMode: "current",
    what: "how much the corpus holds and how fresh it is — source counts, newest record and what INGEST cost to build, never the records themselves and never what this organisation spends",
  },
  {
    availability: { kind: "available" },
    command: ["slopweaver", "catalog", "list"],
    coverage: { detail: "every command registered in this Slopweaver build", kind: "complete" },
    effect: "read",
    freshness: { detail: "the currently loaded plugin build", kind: "snapshot" },
    id: "catalog",
    owner: "slopweaver",
    sourceClass: "artifact",
    terms: ["verb", "verbs", "command", "commands", "capability", "capabilities", "catalog", "can you"],
    truthMode: "current",
    what: "the command surface this plugin build exposes",
  },
  {
    availability: { kind: "available" },
    // Which profile every browser leg reads — a fact about this machine, answered with no page opened and no
    // Chrome driven. The reach itself is per-page and belongs to the verbs this row's coverage names.
    command: ["slopweaver", "browser", "profile"],
    coverage: {
      detail:
        "which of the owner's own Chrome profiles every browser leg reads. Whether a given site is REACHABLE is per-origin and its own act: `slopweaver browser cookies --origin <url>` reports whether the owner's Chrome holds a live session for it, then `browser open --url` and `browser read --session <id>` look at the page. It sees exactly what the owner sees signed in and nothing they are signed out of, and every leg goes through these verbs rather than a hand-driven browser",
      kind: "bounded",
    },
    effect: "read",
    freshness: { detail: "whatever the page shows when the browser leg runs", kind: "live" },
    id: "browser",
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["portal", "login", "log in", "signed in", "website", "browser", "web page"],
    truthMode: "current",
    what: "a page in the owner's own signed-in Chrome — a vendor portal, a console, or any surface with no API here, read as the owner sees it",
  },
  ATTACHMENTS_CAPABILITY,
  {
    availability: { kind: "available" },
    // The whole roster, not the question: `identity resolve` takes ONE name, handle, email or id, so a
    // materialised sentence resolves to nothing and would read as "we do not know that person".
    command: ["slopweaver", "identity", "show"],
    coverage: {
      detail:
        "every canonical person the derived roster holds, with their per-source ids and how each was linked. " +
        "Resolving ONE is the separate act: `slopweaver identity resolve <name|handle|email|id>` answers to " +
        "a colleague and NEVER to a stranger, so an unresolvable name is reported rather than guessed at, " +
        "and `identity org-domains` is which email domains are the org's own. As fresh as the last " +
        "`slopweaver derive`, so a colleague who joined since is absent rather than unknown",
      kind: "bounded",
    },
    effect: "read",
    freshness: { detail: "the roster the last `slopweaver derive` built from the corpus", kind: "snapshot" },
    id: "identity-directory",
    owner: "slopweaver",
    // `artifact`, not `corpus`, for exactly the reason the `audit` row below carries: this installation
    // describing an INDEX it built — names, handles and per-source ids, never a record's contents. The
    // reclassification of `audit` was made because the only corpus-class leg on that roster with no
    // history in it was the one thing a session skimming for history coverage found and misread. A derived
    // roster would recreate that shape; it is corpus-DERIVED, which is not the same as being one.
    sourceClass: "artifact",
    terms: ["who is", "who's", "colleague", "teammate", "handle", "mention", "identity", "roster"],
    truthMode: "current",
    what: "which colleague a name, handle, email or provider id belongs to, and the same human's ids across GitHub, Slack, Linear and Notion",
  },
  {
    availability: { kind: "available" },
    // The register, not the question: `knowledge recall` runs `websearch_to_tsquery`, which ANDs every
    // content word, so a whole sentence comes back empty and an empty page here reads as "nobody has ever
    // learned this". Composing the words is the visible session's judgement.
    command: ["slopweaver", "knowledge", "list"],
    coverage: {
      detail:
        "every lesson, preference and trace the register holds, filterable by domain, tier, verdict, surface " +
        "or learner — and `--repeats` for what more than one run has now learned INDEPENDENTLY, which is the " +
        'signal to make it a rule. Searching is the separate act: `slopweaver knowledge recall "<the nouns ' +
        'of the question>"` is full text over the memories table and ANDs its words, and it REFUSES rather ' +
        "than reporting an empty page when the store is unreachable — so an empty answer is an answer",
      kind: "bounded",
    },
    effect: "read",
    freshness: { detail: "every lesson recorded up to now; a row carries the command that re-checks it", kind: "live" },
    id: "knowledge-register",
    owner: "slopweaver",
    sourceClass: "corpus",
    terms: ["have we hit this", "known issue", "lesson", "lessons", "gotcha", "we learned", "knowledge"],
    truthMode: "history",
    what: "what the fleet's own investigations have already learned the hard way — each claim with its verdict, what was measured, and the command that settles it again",
  },
  {
    availability: { kind: "available" },
    command: ["slopweaver", "transcripts", "sessions"],
    coverage: {
      detail:
        "every Claude session transcript on THIS machine, newest first, with the measured retention floor " +
        "stated — so it is bounded by what the host still holds, never by the org. The readers are the " +
        "separate act: `transcripts turns` the turns a person took, tool results and reminders stripped, " +
        "`transcripts errors` every tool call that errored, `transcripts latency` how long each took, " +
        "`transcripts summary` the counts and autonomy ratio, `transcripts boot-hooks` each RECORDED " +
        "unstarted SessionStart hook, `transcripts draw` each verb's tokens a tick and cap retries. Nothing else",
      kind: "bounded",
    },
    effect: "read",
    freshness: { detail: "read off this machine's transcript files when the planned command runs", kind: "live" },
    id: "session-transcripts",
    owner: "slopweaver",
    sourceClass: "artifact",
    // Never the bare `transcript`: a meeting transcript is a document the mail and Drive doors hold, and
    // routing that word here once sent a turn to this machine's disk instead (the `drive` row).
    terms: [
      "session",
      "sessions",
      "session transcript",
      "session transcripts",
      "agent transcript",
      "agent transcripts",
      "claude transcript",
      "claude transcripts",
      "what did the agent do",
      "tool error",
      "tool errors",
    ],
    truthMode: "history",
    what: "what the agent sessions on this machine actually did — the turns taken, the tool calls that failed, and how long each took",
  },
  {
    availability: { kind: "available" },
    // `store read`: Postgres full-text plus a fan-out of readers whose every finding quotes its record. The id is `corpus` because `./profile.ts`
    // reserves it so no private overlay can substitute its own history source, and a second capability for
    // the same source was a duplicate rather than a second thing to reach. What keys on this row is its
    // `truthMode`, NOT its id — `../live/turn/judgement` resolves a need against the historical SET and
    // refuses a `current` claim built from it, so the invariant survives the row being renamed or an
    // installation adding history legs beside it.
    command: ["slopweaver", "store", "read", QUESTION_COMMAND_TOKEN],
    coverage: {
      detail:
        "whatever the last `slopweaver store load` put in the Supabase store — a bounded recent window per platform, never the whole history. `slopweaver store status` is what it actually holds, and an empty answer means that window holds nothing, never that the org does not. It does NOT hold a board workstream's own run journal: resolve the slug with `handover list`, then read `handover resume <slug>` as a separate act. The SAME store has readers below the fan-out, and they are acts rather than rows because a second capability for one source is a duplicate: `slopweaver store cite \"<question>\"` is the selected records with their citations and no LLM; `slopweaver store query --source <s> --search <text>` filters the content rows by source, kind, container, author, person or time; `slopweaver store facets --facet <f>` counts them grouped by one indexed column; `slopweaver store probe <keyword> …` fans every keyword across the seven search shapes and reports where a term actually lives; `store hits`, `store peek`, `store open` and `store around` then read one shape's rows, a window centred on the match, a record whole, and what was being said around it",
      kind: "bounded",
    },
    effect: "read",
    freshness: {
      detail:
        "as fresh as the last `store load`; the store keeps no cursor of its own, so state the load rather than implying live",
      kind: "snapshot",
    },
    id: "corpus",
    owner: "slopweaver",
    sourceClass: "corpus",
    terms: ["what did we decide", "why did we", "history", "rationale", "decision", "decisions", "who owns"],
    truthMode: "history",
    what: "what the org's own Slack, GitHub, Linear and Notion records say — selected by Postgres full-text and structured filters, then read by a parallel fan-out whose every finding must quote the record it came from",
  },
];

/** Generic capabilities true for every Slopweaver installation, in decisive order. */
export const GENERIC_SOURCE_CAPABILITIES: readonly SourceCapability[] = mergedRoutingTable({
  integration: integrationRoutingRowsOf({ manifests: registeredIntegrations() }),
  local: LOCAL_CAPABILITIES,
});
