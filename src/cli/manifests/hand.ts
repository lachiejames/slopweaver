/**
 * Lazy manifest for the `hand` noun — the HAND-STEP register: the narrow set of steps only the owner's hands can
 * take, the floating macOS note that carries one, and the push lane that reaches the owner about them.
 *
 * `effect: "local-state"`: every write lands in `$SLOPWEAVER_HOME/hand-steps/`, nothing external, no model.
 * The two macOS surfaces are drawn on the owner's own machine through `open` and `osascript` and send nowhere.
 */
import { HAND_LINE_RETIRE_USAGE_LINE } from "../commands/hand/lineRetireUsage.js";
import { HAND_SURFACE_USAGE_LINE } from "../commands/hand/surfaceUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `hand` noun's verbs as lazy manifest entries. */
export const handManifest: Readonly<Record<string, VerbManifestEntry>> = {
  done: lazy({
    load: () => import("../commands/hand/done.js").then((m) => m.handDoneCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver hand done gcloud-signin --did "signed in, the deploy resumed" --by-session workspace:77',
      summary: "Settle one step and close its note, recording what was actually done in the words of whoever saw it",
      usage: "usage: slopweaver hand done <id> --did <what was done> --by-session <text> [--home <dir>] [--json]",
    },
  }),
  "line-retire": lazy({
    load: () => import("../commands/hand/lineRetire.js").then((m) => m.handLineRetireCommand),
    meta: {
      ...sharedMeta,
      // A bare run reads the register and prints the preview, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand line-retire --json",
      summary:
        "Retire an UNREADABLE register line whose step a later readable line already settled, so readers stop " +
        "reporting it as a gap — a sidecar row matched by line number and sha256, never an edit to the append-only " +
        "register; bare previews, --apply carries the preview's digest",
      usage: HAND_LINE_RETIRE_USAGE_LINE,
    },
  }),
  list: lazy({
    load: () => import("../commands/hand/list.js").then((m) => m.handListCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // A bare run reconciles settled steps first, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand list --json",
      summary:
        "Every step still waiting on the owner, OLDEST FIRST unless --ranked asks for the shared ranking — reconciling " +
        "anything the owner pressed Done on, and settling every step whose board row has finished, before it reads; " +
        "--gaps keeps only the cards naming a place on the web they link nowhere on",
      usage: "usage: slopweaver hand list [--ranked] [--gaps] [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  post: lazy({
    load: () => import("../commands/hand/post.js").then((m) => m.handPostCommand),
    meta: {
      ...sharedMeta,
      // With `--check-in --row`, it reads the row's pull requests before parsing — even beside `--help` or an
      // unknown flag — so neither its usage path nor its reject path is free of I/O.
      dryParseSafe: false,
      example:
        "slopweaver hand post --id gcloud-signin " +
        '--what "Run the gcloud login the deploy is waiting on" ' +
        '--literal "gcloud auth application-default login" --where "any terminal" ' +
        '--unblocks "handover run datadog-monitor-deploy" ' +
        '--if-ignored "the Datadog monitor deploy stays unshipped and its alerts stay off" ' +
        "--row datadog-monitor-deploy --blocks " +
        '--witness "slopweaver hand done gcloud-signin --did \\"signed in\\"" --by-session workspace:77',
      parseRejectIsIoFree: false,
      summary:
        "Record ONE step only the owner's hands can take and raise the floating note for it in the same breath — " +
        "refusing a step that names the fleet as its actor or asks a bare go-ahead, because a session that can do a " +
        "thing does it, one carrying a command the fleet could run itself, and one that does not say where it happens. " +
        "A step names its board row (--row) and leaves the owner's queue when that row finishes, or says --standalone; " +
        "and it says whether it --blocks work or is a --check-in, which every surface ranks last",
      usage:
        "usage: slopweaver hand post --id <slug> --what <one sentence> --unblocks <text> " +
        "[--if-ignored <what happens if they do nothing>] --witness <text> " +
        "--by-session <text> (--row <slug> | --standalone) (--blocks | --check-in) [--supersedes <open step id>] " +
        "(--url <https://…> | --open <kind>:<id> | --literal <text> | --no-address <why>) " +
        "[--checklist <json>] [--opened <https://…>] [--where <text>] [--cites <url,url>] " +
        "[--shot <png> --box <x,y,w,h=label> ...] " +
        "[--recheck browser-session:<https origin> | slack-member:<channel id>] " +
        "[--read-owner-words <call anchor,...>] [--context slopweaver|work] [--posted-iso <iso>] [--quiet] [--home <dir>] [--json]",
    },
  }),
  push: lazy({
    load: () => import("../commands/hand/push.js").then((m) => m.handPushCommand),
    meta: {
      ...sharedMeta,
      // A bare run reconciles settled steps first, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand push --by-session supervisor",
      summary:
        "The push lane: ONE macOS notification when something has ARRIVED for the owner since the last pass, and at " +
        "no other time — never on persistence, never on departure, never on age",
      usage: "usage: slopweaver hand push [--dry-run] [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  recheck: lazy({
    load: () => import("../commands/hand/recheck.js").then((m) => m.handRecheckCommand),
    meta: {
      ...sharedMeta,
      // A bare run is the real pass: it probes every open step's origin and settles the met ones.
      dryParseSafe: false,
      example: "slopweaver hand recheck --by-session supervisor",
      summary:
        "Retire every open step whose precondition already holds — the owner is signed in, they are in the channel — read " +
        "once per origin through the atlas's own sign-in test or the door, and journalled as no hand touching it; " +
        "the supervisor's tick runs it ahead of the sign-in monitor",
      usage: "usage: slopweaver hand recheck [--dry-run] [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  retract: lazy({
    load: () => import("../commands/hand/retract.js").then((m) => m.handRetractCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver hand retract mon-park-a-turn-routed-under-1e87ab --why "a parked run, already on the owner\'s queue" ' +
        "--by-session workspace:77",
      summary:
        "Take a mis-posted step off the owner's queue, settled as a RETRACTION naming why — never as done, and never " +
        "left open the way a dismissed note is",
      usage: "usage: slopweaver hand retract <id> [<id> …] --why <text> --by-session <text> [--home <dir>] [--json]",
    },
  }),
  mute: lazy({
    load: () => import("../commands/hand/mute.js").then((m) => m.handMuteCommand),
    meta: {
      ...sharedMeta,
      // A bare run records any kind-answer press the note left, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand mute list",
      summary:
        "The note's Never for this kind, read and reversed — list every muted monitor kind and every note held " +
        "until it gets worse, mute a kind from a terminal, or remove a mute or release a hold; a muted kind's cards still post",
      usage:
        "usage: slopweaver hand mute list|add <kind>|remove <kind|subject> [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  show: lazy({
    load: () => import("../commands/hand/show.js").then((m) => m.handShowCommand),
    meta: {
      ...sharedMeta,
      // A bare run reconciles settled steps first, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand show",
      summary:
        "Raise the floating note for one open step — above whatever the owner is looking at, outside the browser, " +
        "taking no keyboard focus, with the step's literal already on the clipboard",
      usage: "usage: slopweaver hand show [<id>] [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  snooze: lazy({
    load: () => import("../commands/hand/snooze.js").then((m) => m.handSnoozeCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver hand snooze gcloud-signin --for 1h --by-session work-console",
      summary:
        "Take a step's note down UNTIL a time the owner chose — 1h, 3h or 09:00 tomorrow — the answer the note's Not now… " +
        "band gives; never a bare dismiss, and nothing written about whether the step happened",
      usage: "usage: slopweaver hand snooze <id> --for 1h|3h|tomorrow [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  surface: lazy({
    load: () => import("../commands/hand/surface.js").then((m) => m.handSurfaceCommand),
    meta: {
      ...sharedMeta,
      effect: "none",
      example:
        "slopweaver hand surface --row actions-runner-outage --ask-slug actions-runner-outage-access " +
        '--tried "re-ran the failed jobs" --doc https://docs.github.com/en/actions --documented "queued jobs pick a runner" ' +
        '--observed "jobs sit queued" --codex "Codex agrees on the docs" --why "I do not know why" ' +
        '--access "read on the org runner settings" --holder Rosa --would-settle "whether the pool is empty" ' +
        '--urgency breaking --breaks "every merge" --by now --note-what "Ask Rosa for read on the runner settings" ' +
        "--question … --problem … --options … --lean … --risk … --blast-radius … --still-real … " +
        "--evidence <permalink> --observed-by workspace:77 --context work",
      summary:
        "A seat's honest mid-investigation report — tried, documented against observed, an honest why, a hedge, " +
        "the named access and its holder — printed with the Queue card line every report gets, and the checked " +
        "floating-note line on every --urgency but none: something may break, a send the owner approved waits on their " +
        "sign-in, seats idle, the owner is keen to see it, or silence is a close call",
      usage: HAND_SURFACE_USAGE_LINE,
    },
  }),
  wake: lazy({
    load: () => import("../commands/hand/wake.js").then((m) => m.handWakeCommand),
    meta: {
      ...sharedMeta,
      // A bare run reconciles settled steps first, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver hand wake --by-session supervisor",
      summary:
        "Raise the note again for every open step whose snooze has lapsed, stacked beside any note already up " +
        "— the supervisor's tick runs it, because nothing resident may",
      usage: "usage: slopweaver hand wake [--by-session <text>] [--home <dir>] [--json]",
    },
  }),
};
