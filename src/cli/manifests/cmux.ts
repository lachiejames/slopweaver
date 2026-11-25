/**
 * Lazy manifest for the `cmux` noun — the whole cmux surface Slopweaver owns: spawning a real visible session
 * in the right workspace, reading its screen, listing the fleet, subscribing to cmux's hook event stream,
 * titling a workspace's row, and inspecting a workspace's process tree. There is deliberately no verb for a
 * sidebar checklist or status lane: the owner reads neither.
 *
 * These verbs exist so that no session ever runs the `cmux` binary itself (rule 3 — one door). The transport
 * behind each one is the client's problem: the control socket for everything cmux exposes a method for, and
 * the `cmux` binary for the few row decorations it does not — see `src/cmux/sidebar.ts`.
 *
 * `effect: "local-state"` mirrors `codex plan`/`codex review`: these touch a local application, never a
 * Slack/GitHub/Linear provider, so this is not the admit door's concern and does not route through it.
 * The read-only rows are the exception, spelled by `readMeta`: `list`, `processes` and `read-screen` are
 * `external-read`, and `templates` is `none` because it only measures this checkout. `events` reads the same
 * way but stays `local-state`, because every drain commits its resumable cursor to the local store
 * (`src/cmux/eventState/`). `events`, `list` and `templates` act on a bare run (a drain, a socket call, a
 * `git` spawn), so none of the three is `dryParseSafe`; the overrides below name the other verbs that do too.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** Read-only verbs: no worktree, no worker process, nothing to route through the admit door. */
const readMeta = {
  ...sharedMeta,
  diagnostic: true,
  effect: "external-read",
} as const;

/** The `cmux` noun's verbs as lazy manifest entries. */
export const cmuxManifest: Readonly<Record<string, VerbManifestEntry>> = {
  close: lazy({
    load: () => import("../commands/cmux/close.js").then((m) => m.cmuxCloseCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: "slopweaver cmux close workspace:15",
      summary:
        "Close a cmux workspace and its session row, then SIGTERM the orphaned node processes (an nx daemon) " +
        "its fleet worktree left running, unless another live seat still holds that tree; --via-card presses an app " +
        "session's own card Stop instead",
      usage:
        "usage: slopweaver cmux close <workspace> [--harness <value>] [--home <value>] [--via-card] [--workspace <value>]",
    },
  }),
  events: lazy({
    load: () => import("../commands/cmux/events.js").then((m) => m.cmuxEventsCommand),
    meta: {
      ...readMeta,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver cmux events --since 81900 --name agent.hook.Stop --json",
      summary: "Stream cmux's hook events — drain from a resumable cursor, or --follow live",
      usage:
        "usage: slopweaver cmux events [--category <value>] [--home <value>] [--limit <value>] [--name <value>] " +
        "[--since <value>] [--workspace <value>] [--follow] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/cmux/list.js").then((m) => m.cmuxListCommand),
    meta: {
      ...readMeta,
      dryParseSafe: false,
      example: "slopweaver cmux list --json",
      summary: "Every cmux workspace in every window, with its id as well as its ref — --full adds its directory",
      usage: "usage: slopweaver cmux list [--harness <value>] [--full] [--json]",
    },
  }),
  pin: lazy({
    load: () => import("../commands/cmux/pin.js").then((m) => m.cmuxPinCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run pins its own workspace, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux pin --workspace workspace:15",
      summary: "Pin a workspace — refuses when a DIFFERENT one is already pinned rather than leaving two",
      usage: "usage: slopweaver cmux pin [--workspace <value>]",
    },
  }),
  picture: lazy({
    load: () => import("../commands/cmux/picture.js").then((m) => m.cmuxPictureCommand),
    meta: {
      ...readMeta,
      // A run asks the app's socket, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux picture app:0b5e --harness app --json",
      summary:
        "What one app-hosted session has done this run of the app: its tool calls counted by kind, the ones in " +
        "flight and the last ended, never a tool's input, output or title",
      usage: "usage: slopweaver cmux picture <handle> --harness <value> [--json]",
    },
  }),
  processes: lazy({
    load: () => import("../commands/cmux/processes.js").then((m) => m.cmuxProcessesCommand),
    meta: {
      ...readMeta,
      example: "slopweaver cmux processes --workspace workspace:15",
      summary: "The real OS process tree cmux attributes to one workspace — what that session has spawned",
      usage: "usage: slopweaver cmux processes [--workspace <value>] [--json]",
    },
  }),
  "read-screen": lazy({
    load: () => import("../commands/cmux/readScreen.js").then((m) => m.cmuxReadScreenCommand),
    meta: {
      ...readMeta,
      example: "slopweaver cmux read-screen --workspace workspace:1 --scrollback 200 --json",
      summary: "Read a cmux workspace's current live terminal text — never a cached value",
      usage:
        "usage: slopweaver cmux read-screen [--scrollback <value>] [--surface <value>] [--workspace <value>] [--json]",
    },
  }),
  reseat: lazy({
    load: () => import("../commands/cmux/reseat.js").then((m) => m.cmuxReseatCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: "slopweaver cmux reseat --all --dry-run",
      summary:
        "Stop a workspace's claude and relaunch the SAME session in place with --resume, on a routed plan's " +
        "credential or the one --plan names — the chair included; --all does every seat a restore left logged out, " +
        "limit-walled or booted on no configured plan, chair first",
      usage:
        "usage: slopweaver cmux reseat <workspace>|--all [--all] [--dry-run] [--force] [--home <value>] [--json] " +
        "[--model <value>] [--plan <value>] [--timeout-seconds <value>]",
    },
  }),
  dialog: lazy({
    load: () => import("../commands/cmux/dialog.js").then((m) => m.cmuxDialogCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run reads the open dialog, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux dialog --dismiss",
      summary:
        "From INSIDE a seat, list the modal dialogs cmux is holding open; --dismiss presses Cancel on the one " +
        'allowlisted prompt ("Run Project Action?") and journals it — never another button, never another dialog',
      usage: "usage: slopweaver cmux dialog [--dismiss] [--home <value>] [--json]",
    },
  }),
  revive: lazy({
    load: () => import("../commands/cmux/revive.js").then((m) => m.cmuxReviveCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run revives cmux, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux revive --json",
      summary:
        "From OUTSIDE cmux, knock on its control socket, read a reply by what the seats' own calls last heard, and " +
        "when cmux has been hung for the bound while the app runs, quit and reopen the app — the desktop app runs it " +
        "every minute; refused inside cmux",
      usage: "usage: slopweaver cmux revive [--bound-seconds <value>] [--dry-run] [--home <value>] [--json]",
    },
  }),
  send: lazy({
    load: () => import("../commands/cmux/send.js").then((m) => m.cmuxSendCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: 'slopweaver cmux send --workspace workspace:15 "slopweaver handover resume a-doc"',
      summary:
        "Type one line into a session's surface and submit it — reporting whether it was accepted or queued behind a running turn; a relay whose paste would pass 800 characters goes as a file read back byte for byte, and the line typed names it",
      usage:
        "usage: slopweaver cmux send <text> [--delivery <value>] [--harness <value>] [--home <value>] " +
        "[--surface <value>] [--workspace <value>] [--interrupt]",
    },
  }),
  spawn: lazy({
    load: () => import("../commands/cmux/run.js").then((m) => m.cmuxSpawnCommand),
    meta: {
      ...sharedMeta,
      // A boot that produces no visible change is a FOUND FAULT (the exact failure this noun exists to
      // catch), not a broken tool — same reasoning as `doctor`.
      diagnostic: true,
      example: "slopweaver cmux spawn identity-resolves-or-refuses --model sonnet",
      // Some flag-value refusals come after the doc lookup and seat preflight.
      parseRejectIsIoFree: false,
      summary:
        "Provision a handover doc's worktree, open a cmux workspace in it, boot Claude or Codex, verify it, send its pickup command — one receipt line, --full for the worktree and boot detail. A Codex seat whose home has no Slopweaver install is refused first",
      usage:
        "usage: slopweaver cmux spawn <slug> [--build] [--deps <value>] [--dev-build] [--dir <value>] " +
        "[--driver <value>] [--effort <value>] [--force] [--full] [--harness <value>] [--home <value>] --model <value> [--no-dev-build] " +
        "[--no-install] [--plan <value>] [--require-current-base] [--template <value>] [--timeout-seconds <value>] [--wait]",
    },
  }),
  stop: lazy({
    load: () => import("../commands/cmux/stop.js").then((m) => m.cmuxStopCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: 'slopweaver cmux stop workspace:15 --why "your poll-gate hook has held a tool call 41m"',
      summary:
        "Stop what a peer seat is doing and say why, without waiting for it — the lever behind `slopweaver perf`'s REACT line",
      usage:
        "usage: slopweaver cmux stop <workspace> [--harness <value>] [--surface <value>] [--why <value>] [--workspace <value>]",
    },
  }),
  strands: lazy({
    load: () => import("../commands/cmux/strands.js").then((m) => m.cmuxStrandsCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run reads every workspace's screen, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux strands --submit",
      summary:
        "Every composer in the fleet holding a line nobody submitted, with the denominator — and `--submit` " +
        "presses them through",
      usage: "usage: slopweaver cmux strands [--json] [--submit]",
    },
  }),
  submit: lazy({
    load: () => import("../commands/cmux/submit.js").then((m) => m.cmuxSubmitCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: "slopweaver cmux submit --workspace workspace:15",
      summary: "Press Enter on a session's composer and nothing else — refuses a suggestion Claude Code wrote itself",
      usage: "usage: slopweaver cmux submit [--surface <value>] [--workspace <value>] [--force]",
    },
  }),
  templates: lazy({
    load: () => import("../commands/cmux/templates.js").then((m) => m.cmuxTemplatesCommand),
    meta: {
      ...readMeta,
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver cmux templates",
      summary: "Every launch template, what it leaves out, and what it loads at launch, measured off this checkout",
      usage: "usage: slopweaver cmux templates [--json]",
    },
  }),
  takeover: lazy({
    load: () => import("../commands/cmux/takeover.js").then((m) => m.cmuxTakeoverCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run takes the workspace over, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux takeover --dry-run",
      summary:
        "The successor handoff as one verb — verify this session is sweeping, resolve the predecessor from " +
        "cmux's own pin, confirm its run finished, then unpin/pin/title/close in order",
      usage: "usage: slopweaver cmux takeover [--dry-run] [--home <value>]",
    },
  }),
  title: lazy({
    load: () => import("../commands/cmux/run.js").then((m) => m.cmuxTitleCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      example: 'slopweaver cmux title "the staging pool investigation" --workspace workspace:86',
      summary: "Set the title a workspace's sidebar row shows — for a workspace nobody spawned",
      usage: "usage: slopweaver cmux title <text> [--workspace <value>]",
    },
  }),
  unpin: lazy({
    load: () => import("../commands/cmux/pin.js").then((m) => m.cmuxUnpinCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // A bare run unpins its own workspace, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux unpin --workspace workspace:15",
      summary: "Unpin a workspace — idempotent when it was not pinned",
      usage: "usage: slopweaver cmux unpin [--workspace <value>]",
    },
  }),
  usage: lazy({
    load: () => import("../commands/cmux/usage.js").then((m) => m.cmuxUsageCommand),
    meta: {
      ...readMeta,
      // A run asks the app's socket, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver cmux usage --harness app --json",
      summary:
        "What each app-hosted session has spent this run of the app, by plan: the model asked for against the one " +
        "that ran, tokens in each vendor's own categories, and tokens per hour",
      usage: "usage: slopweaver cmux usage --harness <value> [--home <value>] [--json]",
    },
  }),
};
