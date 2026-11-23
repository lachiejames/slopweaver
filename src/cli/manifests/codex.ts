/**
 * Lazy manifest for the `codex` noun (the Codex brain; see `cli/manifest.ts`).
 *
 * Laziness matters more here than for most nouns: the Codex SDK pulls a ~300MB platform binary, and no
 * unrelated verb should load any of it. Each entry's `load` is only invoked once the router has already
 * matched the verb, and `--help` is answered from `meta.usage` without loading the module at all.
 *
 * There is deliberately NO bare-noun (`DEFAULT_VERB`) entry: `slopweaver codex` alone is ambiguous between
 * planning and reviewing, and those differ in whether a diff exists at all. Making the caller name one is
 * the same discipline as requiring an explicit bound.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

const planMeta = {
  ...sharedMeta,
  example: "slopweaver codex plan --pass p1 --task-file ./task.md --bound-seconds 1800",
  summary: "Run a Codex planning pass (P1 comprehension, P2 plan, P3 pre-mortem), streamed and killable",
  usage:
    "usage: slopweaver codex plan --pass p1|p2|p3 --task-file <path> --bound-seconds <n> " +
    "[--model <id>] [--repo <dir>] [--home <dir>]",
} as const;

const reviewMeta = {
  ...sharedMeta,
  example:
    'slopweaver codex review --pass r3 --property-id p1 --property "no migration is destructive" ' +
    "--base origin/main --bound-seconds 240 --max-diff-bytes 262144",
  summary: "Review ONE falsifiable property against a host-computed diff, bounded and streamed",
  usage:
    "usage: slopweaver codex review --pass r1|r2|r3 --property-id <id> --property <claim> " +
    "--base <ref> --bound-seconds <n> --max-diff-bytes <n> [--model <id>] [--repo <dir>] [--home <dir>]",
} as const;

const statusMeta = {
  ...sharedMeta,
  diagnostic: true,
  dryParseSafe: false,
  example: "slopweaver codex status",
  summary: "Show which Codex passes have run in THIS checkout for a branch, and whether each is still current",
  usage: "usage: slopweaver codex status [--check] [--branch <name>] [--repo <dir>] [--home <dir>]",
} as const;

const supersedeMeta = {
  ...sharedMeta,
  example: 'slopweaver codex supersede --artifact <id> --reason "the wording was unsatisfiable"',
  summary:
    "Retire ONE review pass whose property WORDING could not be satisfied, or ONE pass that recorded no tree, " +
    "with the reason on the record",
  usage:
    "usage: slopweaver codex supersede --artifact <id> --reason <text> " +
    "[--branch <name>] [--repo <dir>] [--home <dir>]",
} as const;

const quotaMeta = {
  ...sharedMeta,
  diagnostic: true,
  example: "slopweaver codex quota show --plan codex-one",
  summary:
    "Inspect or clear one registered destination's cached Codex usage-exhaustion record, " +
    "which `cmux spawn --driver codex` fast-fails on",
  usage: "usage: slopweaver codex quota <clear|show> (--plan <alias> | --routed) [--home <dir>]",
} as const;

const resetMeta = {
  ...sharedMeta,
  doorRouted: true,
  effect: "external-write",
  example: "slopweaver codex reset --at-limit",
  summary:
    "Redeem a free usage-limit reset on a Codex destination at its pause bar — one named plan, or every one at its " +
    "limit once per account — through the provider's own app-server call, journalled with the store before and after",
  usage: "usage: slopweaver codex reset (--plan <alias> [--credit <id>] | --at-limit) [--home <dir>]",
} as const;

const pluginSyncMeta = {
  ...sharedMeta,
  // A bare run syncs the Codex install, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex plugin-sync",
  summary:
    "Keep the Codex install of Slopweaver on the main checkout's commit: export HEAD, point the personal " +
    "marketplace at it, re-run `codex plugin add`",
  usage: "usage: slopweaver codex plugin-sync [--decide | --log] [--home <dir>]",
} as const;

/**
 * NOT `diagnostic`, for `watch`'s reason below: `--trust` has Codex write its own config, so a harness treating
 * `diagnostic: true` as safe to run would be wrong about it. The bare form only reads.
 */
const hooksMeta = {
  ...sharedMeta,
  // A bare run asks the app-server what each hook's trust is, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex hooks",
  summary:
    "Name every Slopweaver plugin hook Codex skips in one $CODEX_HOME, read from Codex's own hooks/list; " +
    "`--trust` has Codex trust each one the fleet installed, so no hook ever waits on the owner's hand",
  usage: "usage: slopweaver codex hooks [--codex-home <dir>] [--trust] [--json]",
} as const;

const rulesContextMeta = {
  ...sharedMeta,
  // A bare run opens the store and writes the context cache, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex rules-context",
  summary:
    "The Codex-only SessionStart emitter — print this Slopweaver checkout's always-on rules as additionalContext, " +
    "the set a Claude session gets through AGENTS.md's @ imports",
  usage: "usage: slopweaver codex rules-context",
} as const;

const burnMeta = {
  ...sharedMeta,
  diagnostic: true,
  // A bare run reads every destination's rollout logs and prints the report, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex burn --days 21",
  summary:
    "Measure how many sessions each Codex model, effort and plan buys per weekly and five-hour window, " +
    "from every registered destination's rollout logs",
  usage: "usage: slopweaver codex burn [--days <n>] [--json] [--home <dir>]",
} as const;

const gaugeMeta = {
  ...sharedMeta,
  diagnostic: true,
  // A bare run reads Codex's latest rollout log and prints the budget, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex gauge",
  summary: "Read Codex's latest rate-limit budget off its own rollout log, with the reading's own age beside it",
  usage: "usage: slopweaver codex gauge [--json]",
} as const;

const routeMeta = {
  ...sharedMeta,
  diagnostic: true,
  dryParseSafe: false,
  example: "slopweaver codex route",
  summary:
    "Rank every registered Codex destination and name the one new work takes, with what every other one is doing",
  usage: "usage: slopweaver codex route [--json] [--full] [--home <dir>]",
} as const;

const reviewFallbackMeta = {
  ...sharedMeta,
  example:
    'slopweaver codex review-fallback prepare --pass r3 --property-id p1 --property "no migration is destructive" ' +
    "--base origin/main --max-diff-bytes 262144",
  summary:
    "The review pass a VISIBLE Claude session takes when Codex is capped, no Codex plan is registered, or Codex refused the review on policy twice: prepare the packet, then record the receipt the landing floor reads",
  usage:
    "usage: slopweaver codex review-fallback prepare --pass r1|r2|r3 --property-id <id> --property <claim> " +
    "--base <ref> --max-diff-bytes <n> [--after-refusal <artifactId>] [--repo <dir>] [--home <dir>] [--json]\n" +
    "       slopweaver codex review-fallback record --request <id> --answer-file <path> " +
    "[--workspace <ref>] [--model <name>] [--repo <dir>] [--home <dir>] [--json]",
} as const;

const planFallbackMeta = {
  ...sharedMeta,
  example: "slopweaver codex plan-fallback prepare --pass p2 --task-file ./task.md",
  summary:
    "The plan pass a VISIBLE Claude session takes BEFORE the work when Codex is capped or no Codex plan is registered: prepare the packet, then record the receipt the plan floor reads",
  usage:
    "usage: slopweaver codex plan-fallback prepare --pass p1|p2|p3 --task-file <path> [--repo <dir>] [--home <dir>] [--json]\n" +
    "       slopweaver codex plan-fallback record --request <id> --answer-file <path> " +
    "[--workspace <ref>] [--model <name>] [--repo <dir>] [--home <dir>] [--json]",
} as const;

const usageMeta = {
  ...sharedMeta,
  diagnostic: true,
  // A bare run reads this checkout's git, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex usage",
  summary:
    "Count what the recorded Codex passes cost — per arm, with unmeasured passes counted rather than summed as zero",
  usage: "usage: slopweaver codex usage [--repo <dir>] [--home <dir>] [--diff-sha256 <sha>] [--rates <path>] [--json]",
} as const;

/**
 * `watch` is NOT `diagnostic`, and the difference is real rather than conservative.
 *
 * Every other read-only Codex verb here reports and stops. The recurring arm of this one may open a visible
 * cmux workspace, so a harness that treats `diagnostic: true` as "safe to run for information" would be
 * wrong about it. `--once` and `--dry-run` are the diagnostic shapes, and they are flags rather than
 * separate verbs precisely so a caller has to say which they want.
 */
const watchMeta = {
  ...sharedMeta,
  // A bare run starts the watch loop, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex watch --once --dry-run",
  summary:
    "Watch Codex's budget burn against this account's own measured pace, and open ONE visible session when it is anomalous",
  usage:
    "usage: slopweaver codex watch [--once] [--dry-run] [--interval-seconds <n>] [--repo <dir>] " +
    "[--home <dir>] [--codex-home <dir>] [--json]",
} as const;

const signinMeta = {
  ...sharedMeta,
  diagnostic: true,
  // A bare run reads $CODEX_HOME/auth.json and prints its state, so it acts rather than printing usage.
  dryParseSafe: false,
  example: "slopweaver codex signin --status",
  summary: "Report what $CODEX_HOME/auth.json says, without ever reading a token value out of it",
  usage: "usage: slopweaver codex signin [--status] [--json]",
} as const;

/**
 * The `codex` noun's verbs as lazy manifest entries.
 *
 * `gauge`, `route` and `signin` are the Codex twins of `src/cli/manifests/claude.ts`'s budget verbs. `gauge`
 * and `signin` are `local-state`: they read a file Codex already wrote. `route` and `status` ask every store's
 * own app-server who is signed in and what its limits read now (`src/codex/accountLive.ts`) — no token spent,
 * but a question to OpenAI all the same — and are `local-state` rather than `external-read` because that read
 * files the answer: each store's `codex_sign_in_observation` row (`src/codex/signInRecordStore.ts`) and the fleet
 * cap record (the store's `codex_fleet_cap` row, `src/codex/fleetCapPort.ts`). A bare run of either does all of
 * that, so neither is `dryParseSafe`.
 * `quota clear` writes a clear mark that disarms the cached exhaustion record, so `quota` is `local-state` too. There is no Codex twin of `claude rotate`, and
 * `../commands/codex/gaugeRun.ts`'s header carries why. `reset` is the one `external-write`: it spends a free
 * usage-limit reset on the account, so it goes through the door. `hooks` asks the app-server the same way,
 * and it alone launches with the installed plugins loaded, since their hooks are its subject — but it stays
 * `local-state`, because `--trust` has Codex write its own config and one meta covers both forms.
 */
export const codexManifest: Readonly<Record<string, VerbManifestEntry>> = {
  burn: lazy({
    load: () => import("../commands/codex/burnRun.js").then((m) => m.codexBurnCommand),
    meta: burnMeta,
  }),
  gauge: lazy({
    load: () => import("../commands/codex/gaugeRun.js").then((m) => m.codexGaugeCommand),
    meta: gaugeMeta,
  }),
  hooks: lazy({
    load: () => import("../commands/codex/hooksRun.js").then((m) => m.codexHooksCommand),
    meta: hooksMeta,
  }),
  plan: lazy({
    load: () => import("../commands/codex/run.js").then((m) => m.codexPlanCommand),
    meta: planMeta,
  }),
  "plan-fallback": lazy({
    load: () => import("../commands/codex/fallbackPlanRun.js").then((m) => m.codexPlanFallbackCommand),
    meta: planFallbackMeta,
  }),
  "plugin-sync": lazy({
    load: () => import("../commands/codex/pluginSyncRun.js").then((m) => m.codexPluginSyncCommand),
    meta: pluginSyncMeta,
  }),
  quota: lazy({
    load: () => import("../commands/codex/quotaRun.js").then((m) => m.codexQuotaCommand),
    meta: quotaMeta,
  }),
  reset: lazy({
    load: () => import("../commands/codex/resetRun.js").then((m) => m.codexResetCommand),
    meta: resetMeta,
  }),
  review: lazy({
    load: () => import("../commands/codex/run.js").then((m) => m.codexReviewCommand),
    meta: reviewMeta,
  }),
  "review-fallback": lazy({
    load: () => import("../commands/codex/fallbackReviewRun.js").then((m) => m.codexReviewFallbackCommand),
    meta: reviewFallbackMeta,
  }),
  "rules-context": lazy({
    load: () => import("../commands/codex/rulesContextRun.js").then((m) => m.codexRulesContextCommand),
    meta: rulesContextMeta,
  }),
  route: lazy({
    load: () => import("../commands/codex/routeRun.js").then((m) => m.codexRouteCommand),
    meta: routeMeta,
  }),
  signin: lazy({
    load: () => import("../commands/codex/gaugeRun.js").then((m) => m.codexSigninCommand),
    meta: signinMeta,
  }),
  status: lazy({
    load: () => import("../commands/codex/statusRun.js").then((m) => m.codexStatusCommand),
    meta: statusMeta,
  }),
  supersede: lazy({
    load: () => import("../commands/codex/supersedeRun.js").then((m) => m.codexSupersedeCommand),
    meta: supersedeMeta,
  }),
  usage: lazy({
    load: () => import("../commands/codex/usageRun.js").then((m) => m.codexUsageCommand),
    meta: usageMeta,
  }),
  watch: lazy({
    load: () => import("../commands/codex/watchRun.js").then((m) => m.codexWatchCommand),
    meta: watchMeta,
  }),
};
