/**
 * The `queue` noun — the replies the door held rather than sent.
 *
 * `list` and `show` only read the queue log, so they are `none`; `drop` is `local-state`: it appends to one JSONL under
 * `$SLOPWEAVER_HOME` and touches nothing outside the machine. `release` is the outlier and the reason this noun exists — it POSTS
 * the held draft, so it declares `external-write` + `doorRouted`, and it genuinely is routed: the release
 * replays the original withhold finding and waives it with the override token, so the door ledger records a
 * waived withhold rather than an ordinary send.
 *
 * `defer` and `deferred` are the owner's Queue PAGE's: "Come back to it" on a card, and the read the page orders by. Both
 * are `local-state` over one JSONL of the owner's presses (`src/queueDefer/`), and neither reaches anything off the machine.
 *
 * `refusals` is the CHAIR's: the cards a gate withheld from the owner's Queue, read from the running console on this machine
 * (`src/queueRefusals/`). It writes nothing; the supervisor tick reads it so a withheld card is routed, not lost.
 * `stopping` is the chair's too: the cards stopping the owner's work — a blocker on a priority, a stopped automation — in the owner's
 * Queue's order, read the same way (`src/queueStopping/`), so the tick digest's first line names where the owner's chat
 * update raises the first of them.
 */
import { QUEUE_DEFER_USAGE, QUEUE_DEFERRED_USAGE } from "../commands/queue/deferUsage.js";
import { QUEUE_REFUSALS_USAGE } from "../commands/queue/refusalsUsage.js";
import { QUEUE_STOPPING_USAGE } from "../commands/queue/stoppingUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const queueManifest: Readonly<Record<string, VerbManifestEntry>> = {
  defer: lazy({
    load: () => import("../commands/queue/deferRun.js").then((m) => m.queueDeferCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver queue defer --kind ask --id policy-approvals",
      parseRejectIsIoFree: true,
      summary:
        "Come back to it: record that the owner put off a Queue card, so it steps below every card they have not; --restore puts it back",
      usage: QUEUE_DEFER_USAGE,
    } as const,
  }),
  deferred: lazy({
    load: () => import("../commands/queue/deferRun.js").then((m) => m.queueDeferredCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Every flag is optional: a bare run calls `readCardDeferrals` and prints the standing deferrals.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver queue deferred --json",
      parseRejectIsIoFree: true,
      summary:
        "The Queue cards the owner has put off and not put back, oldest first, and any ledger line that did not read",
      usage: QUEUE_DEFERRED_USAGE,
    } as const,
  }),
  drop: lazy({
    load: () => import("../commands/queue/run.js").then((m) => m.queueDropCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver queue drop q-1a2b3c4d --note "answered by hand"',
      parseRejectIsIoFree: true,
      summary: "Resolve a held reply without sending it — the draft stays in the log, only its state changes",
      usage: "usage: slopweaver queue drop <id> [--note <text>] [--home <dir>]",
    } as const,
  }),
  list: lazy({
    load: () => import("../commands/queue/run.js").then((m) => m.queueListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Every flag is optional: a bare run calls `loadQueue` and lists the held replies. It only reads (`readQueueText`), so `none`.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver queue list",
      parseRejectIsIoFree: true,
      summary: "List the replies the door held rather than sent — held only, unless --all",
      usage: "usage: slopweaver queue list [--all] [--json] [--home <dir>]",
    } as const,
  }),
  refusals: lazy({
    load: () => import("../commands/queue/refusalsRun.js").then((m) => m.queueRefusalsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // Every flag is optional: a bare run makes `fetchQueueRefusals`'s GET to the running console and reports.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver queue refusals --json",
      parseRejectIsIoFree: true,
      summary:
        "The Queue cards a gate withheld from the owner's Queue, by key and the gate's reason, read from the running console",
      usage: QUEUE_REFUSALS_USAGE,
    } as const,
  }),
  release: lazy({
    load: () => import("../commands/queue/run.js").then((m) => m.queueReleaseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver queue release q-1a2b3c4d --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "THE BREAK-GLASS: post a held draft to its thread, through the door, with the withhold recorded as waived",
      usage: "usage: slopweaver queue release <id> [--form <json|->] [--dry-run] [--note <text>] [--home <dir>]",
    } as const,
  }),
  stopping: lazy({
    load: () => import("../commands/queue/stoppingRun.js").then((m) => m.queueStoppingCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // Every flag is optional: a bare run makes `fetchQueueStopping`'s GET to the running console and reports.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver queue stopping --json",
      parseRejectIsIoFree: true,
      summary:
        "The Queue cards stopping the owner's work, in the order their Queue leads with them, read from the running console",
      usage: QUEUE_STOPPING_USAGE,
    } as const,
  }),
  show: lazy({
    load: () => import("../commands/queue/run.js").then((m) => m.queueShowCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // `runQueueShow` only reads: `findItem` folds the log and nothing is appended (unlike `drop`'s `appendQueueEvent`).
      effect: "none",
      example: "slopweaver queue show q-1a2b3c4d",
      parseRejectIsIoFree: true,
      summary: "Print one held entry whole: who asked, why it was held, and the draft itself",
      usage: "usage: slopweaver queue show <id> [--json] [--home <dir>]",
    } as const,
  }),
};
