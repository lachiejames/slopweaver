/**
 * Lazy manifest for the `session` noun — the supervisor's own ledger of the chats it knows about, spawned
 * via `cmux spawn` or registered by hand. `effect: "local-state"` unless a row says otherwise: every write
 * lands under `$SLOPWEAVER_HOME`, nothing external. `list`, `depth` and `fallbacks` only read.
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

/** The `session` noun's verbs as lazy manifest entries. */
export const sessionManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "reach-grant": lazy({
    load: () => import("../commands/session/reachGrant.js").then((m) => m.sessionReachGrantCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver session reach-grant --tool twilio --reason "verifying the number the atlas walk found"',
      summary:
        "Record a bounded, journalled grant to reach ONE production-facing system with a raw command — " +
        "30 minutes, one tool, never an ambient override",
      usage: "usage: slopweaver session reach-grant --tool <value> --reason <value> [--home <value>]",
    },
  }),
  close: lazy({
    load: () => import("../commands/session/run.js").then((m) => m.sessionCloseCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver session close a-doc --workspace workspace:1",
      summary:
        "Mark a session closed by hand (cmux close does this automatically for a spawned one); " +
        "--workspace targets one row of a duplicate spawn rather than the whole slug",
      usage: "usage: slopweaver session close <session-key> [--home <value>] [--workspace <value>]",
    },
  }),
  compaction: lazy({
    load: () => import("../commands/session/compaction.js").then((m) => m.sessionCompactionCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional, so a bare run reads ~/.claude/projects and reports; `--record-reading` makes
      // `recordReading` append a reading to the readings ledger under the state home.
      diagnostic: true,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver session compaction --days 7 --check",
      summary:
        "What auto-compaction cost the fleet — seconds spent summarising, and how much of what each one " +
        "dropped had to be fetched again — what a 350k/400k/600k window would have cost over the same " +
        "week, and whether the cost has risen since the last recorded reading",
      usage:
        "usage: slopweaver session compaction [--days <value>] [--windows <value>] [--tolerance <value>] " +
        "[--projects-dir <value>] [--record-reading <value>] [--home <value>] [--check] [--alert] [--json]",
    },
  }),
  spend: lazy({
    load: () => import("../commands/session/spend.js").then((m) => m.sessionSpendCommand),
    meta: {
      ...sharedMeta,
      // Reads ~/.claude/projects and counts merged PRs through the GitHub door; `--record-reading` appends a
      // reading via `recordReading`, and `--finding` has `registerAskRow` run `handover register --finding`,
      // which creates a board row (the register verb itself declares `createsWorkItem: true`).
      createsWorkItem: true,
      diagnostic: true,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver session spend --days 7",
      summary:
        "The token-optimisation pass: the fleet's draw by seat kind, model and gate refusal over whole UTC " +
        "days, units per landed change against the last reading, and every drain it can price with its fix — " +
        "--finding registers one board row only when there is a win to show",
      usage:
        "usage: slopweaver session spend [--days <value>] [--repos <owner/name,...>] [--min-share <value>] " +
        "[--tolerance <value>] [--projects-dir <value>] [--record-reading <value>] [--home <value>] [--finding] [--json]",
    },
  }),
  "no-subagents": lazy({
    load: () => import("../commands/session/noSubagents.js").then((m) => m.sessionNoSubagentsCommand),
    meta: {
      ...sharedMeta,
      // It reads its own session id and writes one record; no subprocess, no network. A bare run detects the
      // session BEFORE it checks `--why`, so outside a session it fails as an error rather than a usage refusal.
      dryParseSafe: false,
      example: 'slopweaver session no-subagents --why "this loop must never block on a native subagent call"',
      summary:
        "Declare that THIS session's brief forbids sub-agents, so the Agent/Task PreToolUse gate refuses one " +
        "in it — the gate behind 'a gate, not prose'",
      usage: "usage: slopweaver session no-subagents --why <value> [--hours <value>] [--home <value>] | --clear",
    },
  }),
  "close-done": lazy({
    load: () => import("../commands/session/closeDone.js").then((m) => m.sessionCloseDoneCommand),
    meta: {
      ...sharedMeta,
      // With no args it ACTS: `runSessionCloseDone` closes finished workspaces and prunes worktrees.
      dryParseSafe: false,
      example: "slopweaver session close-done --dry-run",
      summary:
        "Close every spawned workspace whose run finished, whose ask was settled or whose doc is terminal, and " +
        "every bot-turn ask worker or answer reviewer whose turn has ended, each on an idle screen, and every " +
        "finished fleet resume tab on a bare shell that ended healthy or was superseded; park every at-rest " +
        "seat whose one idle Claude Code session holds its open run (checkpoint and unsent drafts journalled on " +
        "its row, then closed, resumable with cmux spawn); close the " +
        "ledger rows whose workspaces are already gone, SIGTERM the orphaned node processes (an nx daemon) " +
        "each closed seat’s fleet worktree left running unless a live seat still holds it, reclaim each " +
        "closed seat’s worktree when every prune rail clears it, and print the count",
      usage:
        "usage: slopweaver session close-done [--dir <value>] [--home <value>] [--dry-run] [--json] " +
        "[--keep-worktrees]",
    },
  }),
  depth: lazy({
    load: () => import("../commands/session/depth.js").then((m) => m.sessionDepthCommand),
    meta: {
      ...sharedMeta,
      // Read-only: it reads the registry, each transcript's tail and the cmux inventory, and writes nothing;
      // every flag is optional, so a bare `runSessionDepth` does that reading and prints the report.
      diagnostic: true,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver session depth --threshold 400000 --json",
      summary: "How many tokens each live session is carrying, and which are respawn candidates",
      usage:
        "usage: slopweaver session depth [--home <value>] [--loop-session-key <value>] [--threshold <value>] [--json]",
    },
  }),
  fallbacks: lazy({
    load: () => import("../commands/session/fallbacks.js").then((m) => m.sessionFallbacksCommand),
    meta: {
      ...sharedMeta,
      // Read-only: it reads the registry, each transcript WHOLE and the cmux inventory, and writes nothing;
      // its only flag is `--json`, so a bare `runSessionFallbacks` does that reading and prints the report.
      diagnostic: true,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver session fallbacks --json",
      summary:
        "Which live seats a safeguard fallback moved off the model they were seated with, of ANY tier — the " +
        "class the Fable-only chair gate cannot see",
      usage: "usage: slopweaver session fallbacks [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/session/run.js").then((m) => m.sessionListCommand),
    meta: {
      ...sharedMeta,
      // Every flag is optional, so a bare run reads the session log (`readSessionLogText`) and prints it. No write.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver session list --json",
      summary: "The current state of every session the supervisor is tracking",
      usage: "usage: slopweaver session list [--home <value>] [--json]",
    },
  }),
  watch: lazy({
    load: () => import("../commands/session/watch.js").then((m) => m.sessionWatchCommand),
    meta: {
      ...sharedMeta,
      // It subscribes to cmux's own hook stream and every run commits its resume cursor and fold, together, to the
      // local store; every flag is optional, so a bare run does that rather than printing usage. `--record-reading`
      // appends the `--json-report` document to the local readings ledger.
      diagnostic: true,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver session watch --follow --idle-minutes 15",
      summary:
        "Fold cmux's hook events into per-session signals — needs-input, logged-out, limit-retrying, idle, silent, working",
      usage:
        "usage: slopweaver session watch [--home <value>] [--idle-minutes <value>] [--record-reading <value>] [--since <value>] [--follow] [--include-stale] [--json] [--json-report] [--reset-state]",
    },
  }),
  record: lazy({
    load: () => import("../commands/session/run.js").then((m) => m.sessionRecordCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver session record a-doc --note "waiting on an answer to the naming question"',
      summary: "Note a session's status, registering it if this is the first thing recorded about it",
      usage: "usage: slopweaver session record <session-key> --note <value> [--home <value>]",
    },
  }),
  respawn: lazy({
    load: () => import("../commands/session/respawn.js").then((m) => m.sessionRespawnCommand),
    meta: {
      ...sharedMeta,
      // Opens a real cmux workspace and writes under the state home: a spawned visible process is local
      // state, never a Slack/GitHub/Linear write, so there is no door to route through.
      example: "slopweaver session respawn loop --successor live-loop-16sep-a",
      summary:
        "Retire the Slack loop once it has drifted off main and boot its successor — refuses unless it is " +
        "stale, quiet, and its successor's run is free; it reads as respawned only once --confirm sees " +
        "the successor's own listener arm live from its own tree",
      usage:
        "usage: slopweaver session respawn loop [--successor <value>] [--home <value>] [--force] [--dry-run] [--confirm]",
    },
  }),
  "re-seat": lazy({
    load: () => import("../commands/session/reSeat.js").then((m) => m.sessionReSeatCommand),
    meta: {
      ...sharedMeta,
      // With no args it ACTS — reads every screen, closes and boots — so a bare invocation is not a dry parse.
      // Like `respawn`, a spawned visible process is local state, never a provider write.
      dryParseSafe: false,
      example: "slopweaver session re-seat --dry-run",
      summary:
        "Re-seat every walled seat — reopened logged out after a restart, or sitting on a usage-limit retry " +
        "spinner — by closing it and re-running cmux spawn for its ledger row, one boot at a time under the " +
        "capacity read; never the pinned chair",
      usage: "usage: slopweaver session re-seat [--dry-run] [--home <value>] [--json] [--timeout-seconds <value>]",
    },
  }),
  standing: lazy({
    load: () => import("../commands/session/standing.js").then((m) => m.sessionStandingCommand),
    meta: {
      ...sharedMeta,
      // It reads each standing session's records, its live process tree and git, and exits 3 on anything needing
      // attention; `publishSupervisorEvent` appends its transition event to the supervisor stream, and every flag
      // is optional, so a bare run does all of that.
      diagnostic: true,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver session standing --loop-session-key today-loop-doc --json",
      summary:
        "Whether the Slack loop and the credential keep-alive are live, and which commit each standing " +
        "session is actually running",
      usage: "usage: slopweaver session standing [--home <value>] [--json] [--loop-session-key <value>]",
    },
  }),
};
