/**
 * The `handover` noun — the orchestration-doc board.
 *
 * Lazy like every other manifest: `--help` is answered from `meta.usage` without loading the module, so
 * listing the surface costs nothing. That is why every `usage` below is a LITERAL rather than computed from the
 * verb's flag spec — importing the command module to build one string would load it on every `catalog`, which is
 * exactly what laziness exists to avoid. The help-truth ratchet is what keeps the literal honest.
 *
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { handoverAskManifest } from "./handoverAsks.js";
import { handoverBoardReadManifest } from "./handoverBoardReads.js";
import { lifecycleMeta } from "./handoverLifecycleMeta.js";
import { handoverRulingManifest } from "./handoverRulings.js";
import { handoverSeatManifest } from "./handoverSeats.js";

const checkMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver handover check --doc ~/.slopweaver/handovers/thing.md",
  parseRejectIsIoFree: true,
  summary: "Verify one orchestration doc — references committed, no stale counts, dependencies real",
  usage:
    "usage: slopweaver handover check --doc <path> [--repo <dir>] [--dir <path>] [--home <dir>] " +
    "[--require-status-summary]",
} as const;

/** The `handover` noun's verbs as lazy manifest entries. */
export const handoverManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...handoverAskManifest,
  ...handoverBoardReadManifest,
  ...handoverRulingManifest,
  ...handoverSeatManifest,
  abandon: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverAbandonCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover abandon my-doc --why "superseded"',
      summary: "Give up on a run, explicitly — a typed ending, so nothing is left silently open",
      usage:
        "usage: slopweaver handover abandon <slug> [--base <value>] [--dir <value>] [--home <value>] [--why <value>]",
    }),
  }),
  amend: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverAmendCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover amend my-doc --why "planning found the premise was wrong"',
      summary: "Record that the doc changed mid-run, and why — an unrecorded amendment makes its own probes lie",
      usage:
        "usage: slopweaver handover amend <slug> [--base <value>] [--dir <value>] [--home <value>] [--why <value>]",
    }),
  }),
  answer: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverAnswerCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover answer my-doc --answer "use main"',
      summary: "Answer the question a paused run recorded, reopening it",
      usage:
        "usage: slopweaver handover answer <slug> [--answer <value>] [--base <value>] [--dir <value>] [--home <value>]",
    }),
  }),
  check: lazy({
    load: () => import("../commands/handover/checkRun.js").then((m) => m.handoverCheckCommand),
    meta: checkMeta,
  }),
  artifact: lazy({
    load: () => import("../commands/handover/closeRun.js").then((m) => m.handoverArtifactCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover artifact my-row --url https://example.invalid/page",
      parseRejectIsIoFree: true,
      summary:
        "Record where a row's answer was published, SUPERSEDING the last one — the only recorded value a later event may correct",
      usage: "usage: slopweaver handover artifact <slug> --url <url> [--dir <path>] [--home <dir>]",
    } as const,
  }),
  claim: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverClaimCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover claim my-doc --why "moving this run into Codex"',
      summary: "Claim a released or dead run for this visible session; live or unknown takeovers require --force",
      usage:
        "usage: slopweaver handover claim <slug> [--base <value>] [--dir <value>] [--force] [--home <value>] [--why <value>]",
    }),
  }),
  correct: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverCorrectCommand),
    meta: lifecycleMeta({
      example:
        'slopweaver handover correct my-doc --question "which base, given 9/8/9/10 of 12?" --why "quoted one run as the outcome" --still-real "four runs read 09:40Z"',
      summary:
        "Restate a waiting run's question truly on the journal, and its still-real check with it, so the Queue card reads both",
      usage:
        "usage: slopweaver handover correct <slug> [--base <value>] [--dir <value>] [--home <value>] [--question <value>] [--still-real <value>] [--why <value>]",
    }),
  }),
  close: lazy({
    load: () => import("../commands/handover/closeRun.js").then((m) => m.handoverCloseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover close my-row --summary "landed in the fix pull request"',
      parseRejectIsIoFree: true,
      summary:
        "Record that a row's WORK SHIPPED, so every reader derives `done` — needs no open run, and nothing edits `status:`",
      usage:
        "usage: slopweaver handover close <slug> --summary <what shipped> [--artifact <url>] " +
        "[--dir <path>] [--home <dir>]",
    } as const,
  }),
  finish: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverFinishCommand),
    meta: lifecycleMeta({
      example: "slopweaver handover finish my-doc --lessons none",
      summary:
        "Close a run — refuses while any declared probe still fails, or while it has not said whether it " +
        "learned anything, and prints the residue",
      usage:
        "usage: slopweaver handover finish <slug> [--base <value>] [--dir <value>] [--dry-run [--beside-question]] " +
        "[--home <value>] [--lessons none] [--park-index <n> --parked-at <utc instant>] [--probed-repo <dir>] " +
        "[--probed-tree <session-worktree|doc-repo>] [--probe]",
    }),
  }),
  hook: lazy({
    load: () => import("../commands/handover/hookRun.js").then((m) => m.handoverHookCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver handover hook",
      parseRejectIsIoFree: true,
      summary: "Report an open orchestration run to Claude Code as hook context (always exits 0)",
      usage: "usage: slopweaver handover hook [--dir <path>]",
    } as const,
  }),
  lint: lazy({
    load: () => import("../commands/handover/lintRun.js").then((m) => m.handoverLintCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover lint --doc ~/.slopweaver/handovers/thing.md --fix",
      parseRejectIsIoFree: true,
      summary: "Default a missing `artifact:` before a hand-written doc ever reaches register-hygiene",
      usage: "usage: slopweaver handover lint [--doc <path>] [--fix] [--dir <path>] [--home <dir>]",
    } as const,
  }),
  pause: lazy({
    load: () => import("../commands/handover/pauseRun.js").then((m) => m.handoverPauseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover pause a-daily-post --on "the reviewer it was sent to"',
      parseRejectIsIoFree: true,
      summary: "Park a row on a PERSON — still live and visible, with no deadline and nothing that can be overdue",
      usage:
        "usage: slopweaver handover pause <slug> --on <who> [--why <text>] [--since <iso>] " +
        "[--dir <path>] [--home <dir>]\n" +
        "  --on is required: `paused` with nobody named is the parking this state was built to replace.\n" +
        "  --since is provenance only. Nothing counts from it: no until-date, no cadence, no reminder.",
    } as const,
  }),
  currency: lazy({
    load: () => import("../commands/handover/currencyRun.js").then((m) => m.handoverCurrencyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // It reads Slack and GitHub and writes to no provider; `--record-reading <by>` adds one local append to the
      // readings ledger, which is how the console's Queue takes its own currency check on opening.
      effect: "external-read",
      example: "slopweaver handover currency --json",
      parseRejectIsIoFree: true,
      summary:
        "For every ask waiting on the owner: whether its done-check has passed, and whether the owner has said anything since it was asked that is filed to it or not filed at all",
      usage:
        "usage: slopweaver handover currency [--json] [--full] [--record-reading <by>] [--now <iso>] [--dir <path>] [--home <dir>]",
    } as const,
  }),
  reconcile: lazy({
    load: () => import("../commands/handover/reconcileRun.js").then((m) => m.handoverReconcileCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover reconcile --json",
      parseRejectIsIoFree: true,
      summary:
        "Rank the whole board and say which live sessions are on its top, which are not, what is ready with nobody on it, and what is held",
      usage: "usage: slopweaver handover reconcile [--json] [--full] [--now <iso>] [--dir <path>] [--home <dir>]",
    } as const,
  }),
  reap: lazy({
    load: () => import("../commands/handover/reapRun.js").then((m) => m.handoverReapCommand),
    meta: lifecycleMeta({
      example: "slopweaver handover reap --dry-run",
      summary:
        "Close every open run cycle whose session the live-session registry proves is dead — a typed `orphaned` ending the dead session could never write itself",
      usage: "usage: slopweaver handover reap [--dry-run] [--json] [--now <iso>] [--home <dir>]",
    }),
  }),
  prune: lazy({
    load: () => import("../commands/handover/pruneRun.js").then((m) => m.handoverPruneCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover prune --priority p0",
      parseRejectIsIoFree: true,
      summary:
        "The TRIMMED board — which rows still earn their keep, and which the register already decided, each with its witness",
      usage:
        "usage: slopweaver handover prune [--priority p0|p1|p2|p3] [--verdicts] [--json] [--now <iso>] " +
        "[--dir <path>] [--home <dir>]\n" +
        "  Reads the DERIVED state, never the `status:` line — 111 of the 121 p0 rows one page offered as a " +
        "queue were already settled on disk when it listed them as waiting.\n" +
        "  Report-only by construction: every performable verdict prints the `handover settle` command " +
        "and this verb never runs one, because settle asks two gates first. A relay row about an open hand card " +
        "also needs settle to be told what happens to that card, which this verb never guesses: settle refuses and names the card.",
    } as const,
  }),
  release: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverReleaseCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover release my-doc --why "continue in Claude Code"',
      summary: "Release this session's run so another visible Claude Code or Codex session can claim it",
      usage:
        "usage: slopweaver handover release <slug> [--base <value>] [--dir <value>] [--home <value>] [--why <value>]",
    }),
  }),
  resume: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverResumeCommand),
    meta: lifecycleMeta({
      example: "slopweaver handover resume my-doc",
      summary: "Rebuild a run's brief from its journal — the verb to run after losing context to a compaction",
      usage: "usage: slopweaver handover resume <slug> [--base <value>] [--dir <value>] [--home <value>] [--probe]",
    }),
  }),
  start: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverStartCommand),
    meta: lifecycleMeta({
      example: "slopweaver handover start my-doc --branch feat/thing",
      summary: "Open a run — refuses a doc whose probes already pass, which is the shipped-but-ready killer",
      usage:
        "usage: slopweaver handover start <slug> [--base <value>] [--branch <value>] [--dir <value>] [--home <value>] [--probe]",
    }),
  }),
  unpause: lazy({
    load: () => import("../commands/handover/pauseRun.js").then((m) => m.handoverUnpauseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover unpause a-daily-post --why "they replied in the thread"',
      parseRejectIsIoFree: true,
      summary: "Take a row off pause — the deliberate act `handover start` and `cmux spawn` refuse to do for you",
      usage:
        "usage: slopweaver handover unpause <slug> [--status ready|in-progress] [--why <text>] " +
        "[--dir <path>] [--home <dir>]",
    } as const,
  }),
  settle: lazy({
    load: () => import("../commands/handover/settleVerbRun.js").then((m) => m.handoverSettleCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover settle my-ask --as filed --witness my-doc --lessons none",
      parseRejectIsIoFree: true,
      summary:
        "End an ask row — filed as a doc, answered inline, or declined by the owner with a reason; a relay row " +
        "about an open hand card also says whether that card is done, re-cut or kept",
      usage:
        "usage: slopweaver handover settle <slug> --as filed|answered|declined --witness <value> " +
        "[--reason <text>] [--lessons none] [--card done|recut|kept [--card-why <reason>] [--card-new <step id>]] " +
        "[--dir <path>] [--home <dir>]",
    } as const,
  }),
  "sign-off": lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverSignOffCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover sign-off my-doc --note "probes re-run, the PR is merged"',
      summary: "Record a SECOND party vouching for a run — what makes an unsigned self-closure visible as unsigned",
      usage:
        "usage: slopweaver handover sign-off <slug> [--base <value>] [--by <value>] [--dir <value>] [--home <value>] [--note <value>]",
    }),
  }),
};
