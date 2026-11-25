/**
 * The `fleet` noun — the board's single pane of glass.
 *
 * Lazy like every other manifest: `--help` is answered from `meta.usage` without loading the module, which is
 * why `usage` below is a LITERAL rather than computed from the verb's flag spec. The help-truth ratchet is what
 * keeps the literal honest — it pushes every advertised flag through the real parser.
 *
 * `up` / `say` / `stop` / `reap` — the levers that launched, instructed and ended a headless `claude -p`
 * agent — are gone. AGENTS.md rule 2 bans a detached, unwatched agent outright, so there is nothing left for
 * those verbs to do. `status` is a pure read of git, `gh` and the run journal, and it stays. `health`, `resume`
 * and `configure` are the restart recovery the desktop app drives; `resume` relaunches only in visible workspaces.
 * `restore-policy` turns off cmux's own bare relaunch of those seats, so `resume` is the one path back. `recover` opens
 * one visible throwaway app session per plan it tries, closes each, and says whether either vendor answers.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `fleet` noun's verbs as lazy manifest entries. */
export const fleetManifest: Readonly<Record<string, VerbManifestEntry>> = {
  burn: lazy({
    load: () => import("../commands/fleet/burnRun.js").then((m) => m.fleetBurnCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the local transcripts and rollouts and prints the burn, so it acts rather than printing usage.
      dryParseSafe: false,
      // Reads the local Claude transcripts, the plan register and each registered Codex home's rollouts — no probe, no
      // network — and `--record-reading` appends the printed document to the local readings ledger.
      effect: "local-state",
      example: "slopweaver fleet burn --json",
      parseRejectIsIoFree: true,
      summary:
        "How many tokens Claude and Codex each burned in the last 24 hours, what seven days at that rate would burn, and how many sessions are drawing now",
      usage: "usage: slopweaver fleet burn [--home <value>] [--now <value>] [--record-reading <value>] [--json]",
    },
  }),
  ceiling: lazy({
    load: () => import("../commands/fleet/ceilingRun.js").then((m) => m.fleetCeilingCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the drawdown journal and prints the seven-day report, so it acts rather than printing usage.
      dryParseSafe: false,
      // The drawdown journal, the Claude accounts file and the supervisor tick ledger; `--publish` writes one local
      // page under $SLOPWEAVER_HOME and places no card. No probe, no network.
      effect: "local-state",
      example: "slopweaver fleet ceiling --days 7",
      parseRejectIsIoFree: true,
      summary:
        "How much of the Claude plans' week went unused against the seats that worked, and how many working seats the plans carry until they reset",
      usage: "usage: slopweaver fleet ceiling [--days <value>] [--home <value>] [--now <value>] [--json] [--publish]",
    },
  }),
  configure: lazy({
    load: () => import("../commands/fleet/recoveryRun.js").then((m) => m.fleetConfigureCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver fleet configure --capacity 15",
      parseRejectIsIoFree: true,
      summary: "Set how many seats the fleet runs — the denominator of the sessions page's capacity line",
      usage: "usage: slopweaver fleet configure [--capacity <value>] [--home <value>] [--json]",
    },
  }),
  history: lazy({
    load: () => import("../commands/fleet/historyRun.js").then((m) => m.fleetHistoryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the tick ledger and prints the last 24 hours, so it acts rather than printing usage.
      dryParseSafe: false,
      // The supervisor tick ledger, read from its end. No probe, no network.
      effect: "none",
      example: "slopweaver fleet history --hours 24 --json",
      parseRejectIsIoFree: true,
      summary:
        "The fleet's recent states as the supervisor's ticks recorded them: the machine's hold and load, the plans' ceilings, how many worked and how many ready rows had nobody on",
      usage: "usage: slopweaver fleet history [--hours <value>] [--home <value>] [--now <value>] [--json]",
    },
  }),
  landed: lazy({
    load: () => import("../commands/fleet/landedRun.js").then((m) => m.fleetLandedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run spawns `git`, so it acts rather than printing usage.
      dryParseSafe: false,
      // `git rev-parse` and `git log` of the checkout's main, the PR ledger, the board and the autonomy register.
      // No fetch, no network.
      effect: "none",
      example: "slopweaver fleet landed --limit 10",
      parseRejectIsIoFree: true,
      summary:
        "What landed on main, each change beside the words of yours that asked for it, the rule it landed under and the proof it carried",
      usage:
        "usage: slopweaver fleet landed [--dir <value>] [--home <value>] [--limit <value>] [--ref <value>] [--json]",
    },
  }),
  health: lazy({
    load: () => import("../commands/fleet/recoveryRun.js").then((m) => m.fleetHealthCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: false,
      // The process table, `ps`/`lsof` on each live session, the local credential stores and files under the
      // home. No cmux: the desktop app runs it from outside cmux every poll. Its console line is
      // `checkout console`'s read, which fetches the upstream when due and files its fetch claim under the home.
      effect: "local-state",
      example: "slopweaver fleet health --json",
      parseRejectIsIoFree: true,
      summary:
        "The sessions page: every seat red, recovering or green, the fleet healthy, recovering, degraded or down, the capacity line, and the one hand step",
      usage: "usage: slopweaver fleet health [--home <value>] [--json]",
    },
  }),
  recover: lazy({
    load: () => import("../commands/fleet/recoverRun.js").then((m) => m.fleetRecoverCommand),
    meta: {
      createsWorkItem: false,
      // Exits 3 when a vendor did not answer: a finding, not a broken tool.
      diagnostic: true,
      doorRouted: false,
      // A bare run opens sessions, so it acts rather than printing usage.
      dryParseSafe: false,
      // Opens and closes visible sessions in the desktop app, one at a time, spending one short turn on each plan it
      // tries; writes their ledger rows and an empty scratch directory under the home.
      effect: "local-state",
      example: "slopweaver fleet recover",
      parseRejectIsIoFree: true,
      summary:
        "Whether Claude and Codex can each start a session in the desktop app: one visible throwaway turn per vendor, falling back plan by plan, each reason printed as one JSON line",
      usage: "usage: slopweaver fleet recover [--home <value>]",
    },
  }),
  "restore-policy": lazy({
    load: () => import("../commands/fleet/restorePolicyRun.js").then((m) => m.fleetRestorePolicyCommand),
    meta: {
      createsWorkItem: false,
      // Read mode exits 3 when cmux's own restore is on: a finding, not a broken tool.
      diagnostic: true,
      doorRouted: false,
      // A bare run reads cmux's config and reports its restore policy, so it acts rather than printing usage.
      dryParseSafe: false,
      // Reads cmux's config; `--apply` writes ONE file outside the state home — `~/.config/cmux/cmux.json`, backed
      // up beside itself first — and runs `cmux reload-config`. No network, no model.
      effect: "local-state",
      example: "slopweaver fleet restore-policy --apply",
      parseRejectIsIoFree: true,
      summary:
        "Whether cmux relaunches Claude seats itself on reopen (bare, without their setup token) — and with --apply, turn that off so fleet resume brings them back, supervisor first",
      usage: "usage: slopweaver fleet restore-policy [--apply] [--config <value>] [--json]",
    },
  }),
  resume: lazy({
    load: () => import("../commands/fleet/recoveryRun.js").then((m) => m.fleetResumeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare run takes the fleet lock and relaunches seats, so it acts rather than printing usage.
      dryParseSafe: false,
      // Starts the console and relaunches walled or bare-shell seats in their own visible cmux workspaces; writes the journal.
      effect: "local-state",
      example: "slopweaver fleet resume",
      parseRejectIsIoFree: true,
      summary:
        "Bring the fleet back after a restart or a lockout: the console, then the supervisor, then every walled or bare-shell seat by priority",
      usage:
        "usage: slopweaver fleet resume [--episode <value>] [--home <value>] [--json] [--reorient-seconds <value>] [--timeout-seconds <value>]",
    },
  }),
  status: lazy({
    load: () => import("../commands/fleet/run.js").then((m) => m.fleetStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads every run's remote state, so it acts rather than printing usage.
      dryParseSafe: false,
      // Shells `git ls-remote` and `gh pr view`, which are reads of a remote. Nothing is written anywhere.
      effect: "external-read",
      example: "slopweaver fleet status",
      parseRejectIsIoFree: true,
      summary: "The single pane — every field measured at call time from git, the PR checks and the run journal",
      usage: "usage: slopweaver fleet status [<slug>…] [--base <value>] [--dir <value>] [--home <value>] [--json]",
    },
  }),
  why: lazy({
    load: () => import("../commands/fleet/whyRun.js").then((m) => m.fleetWhyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the readings ledger and prints the last hour, so it acts rather than printing usage.
      dryParseSafe: false,
      // The readings ledger only: readings a supervisor tick already recorded. No `top`, no probe, no network.
      effect: "none",
      example: "slopweaver fleet why --minutes 60",
      parseRejectIsIoFree: true,
      summary:
        "Why the fleet is not running more working seats right now, and what the machine measured over the last minutes",
      usage: "usage: slopweaver fleet why [--home <value>] [--minutes <value>] [--now <value>] [--json]",
    },
  }),
};
