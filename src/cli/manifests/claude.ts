/**
 * Lazy manifest for the `claude` noun — which of the owner's Claude Max plans the fleet is on, and how much
 * of each remains (see `cli/manifest.ts`).
 *
 * Its effect is `external-read` rather than `local-state`, because the gauge genuinely reaches Anthropic's
 * API — the budget it reports arrives as headers on a real response, and pretending otherwise would put a
 * network call outside the inventory that exists to find exactly that.
 *
 * `rotate` WAS the only verb in the repository that writes a Claude credential, and writes none now: the copy
 * it performed is retired, so `--commit` renders a registered refusal and `--discard-unreturnable` is rejected
 * rather than ignored. What it still does is report which plan was named.
 *
 * `watch` is the foreground loop that keeps every store alive and REPORTS the rotation it recommends. Its effect is `local-state` because it refreshes each store's own credential in
 * place — the keep-alive half — and writes its own records. It no longer writes the ACTIVE slot at all: the
 * credential copy is retired (`../commands/claude/rotate.ts` § This verb no longer writes a credential), so a
 * tick that names a plan to rotate to now REPORTS that and performs nothing.
 *
 * `route` answers the question `cmux spawn` answers silently — which plan a spawn of a given model would land
 * on — by calling that spawn's own routing function rather than a copy of it, so the answer can be checked
 * without opening a workspace. Its effect is `local-state` rather than `read-only` and that is a real change:
 * the gate it shares with a spawn REPAIRS a store the provider refused whose token has merely expired, by
 * running the CLI's own OAuth refresh under it.
 *
 * `pause` and `resume` are the DECLARED-state pair. A plan the provider refuses for a reason no code can
 * repair — a claude.ai subscription paused on a bounced charge, say — otherwise costs a probe, a doomed
 * repair and a red line on every single spawn, and grades the fleet's acceptance `unmeasurable` forever.
 * Pausing it writes a reason and a date onto its row, and every surface that reads plans skips it and says
 * so once. Their effect is `local-state`: they rewrite `accounts.json` and touch no credential at all.
 *
 * `gauge` is READ-ONLY: it takes each store's token out of the keychain, spends one output token asking the
 * provider a question whose answer is entirely in the response headers, and forgets it. No code path it
 * reaches can write a credential, which is why it ships ahead of the swap rather than beside it. It answers
 * BOTH halves of the owner's ruling — `--plan <alias>` reads one plan, and with no alias it
 * aggregates every plan and prints the balance block a supervisor decides the next spawn from.
 *
 * `forecast` is READ-ONLY and offline: it reads the drawdown journal `watch` writes and runs that history forward
 * against each plan's usage limit, so it can say whether the plans WOULD run dry before a reset if the trend
 * repeats — a historical trend, never a fact — without spending a single probe.
 *
 * `token` and `mint` are the two ways a plan gets its setup token, and both write it only through
 * `claude/seatTokenAdmit.ts`, once one probe proves the windows and the enrolled account. `token` takes a
 * value the owner pasted; `mint` runs the plan's own setup-token login under a pseudo-terminal, pre-fills
 * the plan's ENROLLED address on the login page, and reads the token off its screen.
 *
 * `reset` reads a plan's free usage-limit resets and, with `--claim`, spends one through the door. A setup token
 * cannot reach either call, so it presents a profile-scoped sign-in — the plan's own store's, else the default
 * slot's — only once one gauge probe binds it to the plan's enrolled organisation. It writes no credential.
 *
 * `seat` is READ-ONLY and local: it reads what one session booted on, the way `gauge` reads the chair, and refuses
 * its turn when that is an API key or no configured plan. `hooks/hooks.json` runs it on every `UserPromptSubmit`.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const gaugeMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver claude gauge",
  parseRejectIsIoFree: true,
  summary:
    "Read every configured Claude Max plan's five-hour, weekly and Fable budget, how far apart they are, and what spawns next where",
  usage: "usage: slopweaver claude gauge [--plan <alias>] [--json]",
} as const;

const forecastMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  // `none`: it reads the drawdown journal and the configured plans, writes nothing and spends no probe.
  effect: "none",
  example: "slopweaver claude forecast --weeks 4",
  parseRejectIsIoFree: true,
  summary:
    "Run the measured burn forward as a historical trend: would the plans, each held to its usage limit, run dry before a reset, under today's router and the alternatives",
  usage:
    "usage: slopweaver claude forecast [--weeks <1..12>] [--demand trailing|peak] [--now <iso>] [--home <dir>] [--json]",
} as const;

const pauseMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver claude pause plan-one --reason "claude.ai subscription paused on a bounced charge"',
  parseRejectIsIoFree: true,
  summary:
    "Take one plan out of the fleet with a reason: it stops being probed, routed and counted, instead of printing an unrepairable refusal on every spawn",
  usage: 'usage: slopweaver claude pause <alias> --reason "<why>"',
} as const;

const resumeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver claude resume plan-one",
  parseRejectIsIoFree: true,
  summary: "Put a paused plan back into the fleet, so it is probed, routed and counted again",
  usage: "usage: slopweaver claude resume <alias>",
} as const;

const routeMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  // `local-state`, not `external-read`: it runs the same gate a spawn runs, and that gate repairs a store the
  // provider refused whose token has merely expired — which writes that store's credential in place.
  effect: "local-state",
  example: "slopweaver claude route --model fable",
  parseRejectIsIoFree: true,
  summary: "Ask which plan a spawn of a given model would land on, repairing an expired store on the way",
  usage: "usage: slopweaver claude route [--model <model>]",
} as const;

const seatMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  // `none`: one registry listing and the `ps`/`lsof`/`stat` reads `claude gauge` makes of the chair, of one pid —
  // local, no provider call and no write.
  effect: "none",
  example: "slopweaver claude seat --session <id>",
  parseRejectIsIoFree: true,
  summary:
    "Say whether a Claude session was booted on a configured plan, and refuse its turn when it is on the default " +
    "login, a store no plan names, or an API key — the UserPromptSubmit hook runs it with --from-payload",
  usage: "usage: slopweaver claude seat (--session <id> | --from-payload)",
} as const;

const rotateMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver claude rotate --to plan-one",
  parseRejectIsIoFree: true,
  summary: "Report which plan was named; the credential copy this used to perform is retired",
  usage: "usage: slopweaver claude rotate --to <alias> [--commit]",
} as const;

const watchMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver claude watch --wait",
  parseRejectIsIoFree: true,
  summary:
    "Keep every non-active Claude credential store alive and report what the fleet would rotate to — a " +
    "standing session `session standing` grades, which refuses to start beside a running one (`--wait` queues)",
  usage: "usage: slopweaver claude watch [--interval <1..60>] [--once] [--dry-run] [--json] [--wait]",
} as const;

const signinMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver claude signin --status",
  parseRejectIsIoFree: true,
  summary: "Walk each configured plan's sign-in in your own terminal, verifying which account landed",
  usage:
    "usage: slopweaver claude signin [--status] [--json] [--page] [--out <path>] [--plan <alias>] [--enroll <alias>] [--reenroll <alias,...>]",
} as const;

const tokenMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  // `local-state`: it spends one probe request over the pasted token and, only once that proves the windows and
  // the enrolled account, writes the token into the plan's store directory.
  effect: "local-state",
  example: "slopweaver claude token --status",
  parseRejectIsIoFree: true,
  summary:
    "Hand a plan the setup token the owner minted, written only once it proves the windows and the enrolled account",
  usage: "usage: slopweaver claude token [--status] [--plan <alias>] [--stdin]",
} as const;

const mintMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  // `local-state`, like `token`: it runs the plan's own setup-token login, spends one probe over what it
  // prints, and writes the token into the plan's store directory only once that proves itself.
  effect: "local-state",
  example: "slopweaver claude mint --plan plan-one",
  parseRejectIsIoFree: true,
  summary:
    "Run a plan's setup-token login with its enrolled address pre-filled on the login page, and write only a token that proves itself",
  usage: "usage: slopweaver claude mint --plan <alias>",
} as const;

const resetMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  // `external-write`: without `--claim` it only reads, but with it the claim spends a reset through the door.
  effect: "external-write",
  example: "slopweaver claude reset --plan plan-five",
  parseRejectIsIoFree: true,
  summary:
    "Read a Claude plan's free usage-limit resets over a sign-in proven to be that plan's, and with --claim " +
    "spend one through the provider's own call, journalled so a retry settles the same claim",
  usage: "usage: slopweaver claude reset --plan <alias> [--claim] [--grant <id>] [--json] [--home <dir>]",
} as const;

const spendMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  // `external-read`: one GET of the provider's usage answer; the only write is the local readings ledger.
  effect: "external-read",
  example: "slopweaver claude spend --plan plan-five",
  parseRejectIsIoFree: true,
  summary:
    "Read a Claude plan's monthly spend and limit over a sign-in proven to be that plan's, record it, and say " +
    "what the plan's usage limit makes of it in dollars — the reading routing trusts for an hour",
  usage: "usage: slopweaver claude spend --plan <alias> [--json] [--home <dir>]",
} as const;

/** The `claude` noun's verbs as lazy manifest entries. */
export const claudeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  forecast: lazy({
    load: () => import("../commands/claude/forecastRun.js").then((m) => m.claudeForecastCommand),
    meta: forecastMeta,
  }),
  gauge: lazy({
    load: () => import("../commands/claude/run.js").then((m) => m.claudeGaugeCommand),
    meta: gaugeMeta,
  }),
  mint: lazy({
    load: () => import("../commands/claude/mintRun.js").then((m) => m.claudeMintCommand),
    meta: mintMeta,
  }),
  pause: lazy({
    load: () => import("../commands/claude/pauseRun.js").then((m) => m.claudePauseCommand),
    meta: pauseMeta,
  }),
  reset: lazy({
    load: () => import("../commands/claude/resetRun.js").then((m) => m.claudeResetCommand),
    meta: resetMeta,
  }),
  resume: lazy({
    load: () => import("../commands/claude/pauseRun.js").then((m) => m.claudeResumeCommand),
    meta: resumeMeta,
  }),
  route: lazy({
    load: () => import("../commands/claude/routeRun.js").then((m) => m.claudeRouteCommand),
    meta: routeMeta,
  }),
  rotate: lazy({
    load: () => import("../commands/claude/rotate.js").then((m) => m.claudeRotateCommand),
    meta: rotateMeta,
  }),
  seat: lazy({
    load: () => import("../commands/claude/seatRun.js").then((m) => m.claudeSeatCommand),
    meta: seatMeta,
  }),
  signin: lazy({
    load: () => import("../commands/claude/signinRun.js").then((m) => m.claudeSigninCommand),
    meta: signinMeta,
  }),
  spend: lazy({
    load: () => import("../commands/claude/spendRun.js").then((m) => m.claudeSpendCommand),
    meta: spendMeta,
  }),
  token: lazy({
    load: () => import("../commands/claude/tokenRun.js").then((m) => m.claudeTokenCommand),
    meta: tokenMeta,
  }),
  watch: lazy({
    load: () => import("../commands/claude/watch.js").then((m) => m.claudeWatchCommand),
    meta: watchMeta,
  }),
};
