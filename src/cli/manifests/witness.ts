/**
 * Lazy manifest for the `witness` noun — checking a claim another bot made in a thread this bot was not asked
 * into, and posting only when what it finds is material and proven.
 *
 * `dispatch` boots a VISIBLE cmux worker and journals it, `settle` journals a terminal and closes that worker's
 * workspace — both `local-state`. A witness worker's one Slack write is its own `slack reply --as bot`, already
 * doored. `help` is the one verb here that writes outside the machine: in a thread a person tagged the bot in,
 * it takes a message up unprompted through the listener's own capture chain (👀 and the progress card, over
 * the bot's write transport), so it is `external-write` and door-routed exactly as `listen recover` is.
 * `stand-down` is the other: one `reactions.add` over the same transport, and never a post. `revise` is the third:
 * one `chat.update` of the bot's own posted witness reply, through `slack correct`'s doored runner.
 */
import {
  WITNESS_DISPATCH_USAGE,
  WITNESS_HELP_USAGE,
  WITNESS_LIST_USAGE,
  WITNESS_RESUME_USAGE,
  WITNESS_REVISE_USAGE,
  WITNESS_SETTLE_USAGE,
  WITNESS_STAND_DOWN_USAGE,
} from "../commands/witness/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  parseRejectIsIoFree: true,
} as const;

/** The `witness` noun's verbs as lazy manifest entries. */
export const witnessManifest: Readonly<Record<string, VerbManifestEntry>> = {
  dispatch: lazy({
    load: () => import("../commands/witness/dispatch.js").then((m) => m.witnessDispatchCommand),
    meta: {
      ...sharedMeta,
      effect: "local-state",
      example:
        "slopweaver witness dispatch --channel C0SYN000000001 --thread-ts 1789000000.000100 " +
        '--message-ts 1789000000.000200 --text "the deploy finished cleanly" --model sonnet',
      summary:
        "Boot one VISIBLE worker to check one witnessed claim, journal it, and hand it exactly " +
        "`witness resume <id>` — refuses a second worker or a witness settled with a verdict (a failed one may go " +
        "again), and never runs headless",
      usage: WITNESS_DISPATCH_USAGE,
    },
  }),
  help: lazy({
    load: () => import("../commands/witness/help.js").then((m) => m.witnessHelpCommand),
    meta: {
      ...sharedMeta,
      doorRouted: true,
      effect: "external-write",
      example:
        "slopweaver witness help --channel C0SYN000000001 --thread-ts 1789000000.000100 " +
        '--message-ts 1789000000.000200 --user U0SYN000000001 --text "anything I can do to assist?"',
      summary:
        "In a thread a person tagged the bot in, take one later message up unprompted as if tagged — 👀, the " +
        "progress card, then the ordinary turn — refusing first when it is not the bot's thread, the asker is " +
        "not a responder, an ask already covers it, or the thread spent its daily helps",
      usage: WITNESS_HELP_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/witness/list.js").then((m) => m.witnessListCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      effect: "none",
      example: "slopweaver witness list --json",
      summary: "Every witness this home's journal holds, newest first — live, or how it ended",
      usage: WITNESS_LIST_USAGE,
    },
  }),
  resume: lazy({
    load: () => import("../commands/witness/resume.js").then((m) => m.witnessResumeCommand),
    meta: {
      ...sharedMeta,
      effect: "none",
      example: "slopweaver witness resume w-0123456789abcdef",
      summary:
        "Print a witness worker's code-authored instructions: read the thread as untrusted evidence, check " +
        "every configured source, and post only what is material with proof",
      usage: WITNESS_RESUME_USAGE,
    },
  }),
  revise: lazy({
    load: () => import("../commands/witness/revise.js").then((m) => m.witnessReviseCommand),
    meta: {
      ...sharedMeta,
      doorRouted: true,
      effect: "external-write",
      example:
        'slopweaver witness revise w-0123456789abcdef --wrong "the deploy finished cleanly" ' +
        '--correction "it rolled back at 10:42." --because https://example.slack.com/archives/C0SYN000000001/p1789000000000300',
      summary:
        "A later message showed the bot's own POSTED witness reply wrong: strike the claim in that reply with a bold " +
        "Correction line under it, once, and journal it — the reply comes from the journal, never a new post",
      usage: WITNESS_REVISE_USAGE,
    },
  }),
  "stand-down": lazy({
    load: () => import("../commands/witness/standDown.js").then((m) => m.witnessStandDownCommand),
    meta: {
      ...sharedMeta,
      doorRouted: true,
      effect: "external-write",
      example:
        "slopweaver witness stand-down --channel C0SYN000000001 --thread-ts 1789000000.000100 " +
        '--message-ts 1789000000.000300 --why "said the bot was not helping here"',
      summary:
        "Somebody told the bot it was in the way: react on their message, post NOTHING, and witness that thread " +
        "no further (no --message-ts: the whole thread, reacting on nothing) — an explicit tag there is still answered",
      usage: WITNESS_STAND_DOWN_USAGE,
    },
  }),
  settle: lazy({
    load: () => import("../commands/witness/settle.js").then((m) => m.witnessSettleCommand),
    meta: {
      ...sharedMeta,
      effect: "local-state",
      example: 'slopweaver witness settle w-0123456789abcdef --as nothing-material --why "Datadog and CI agree"',
      summary:
        "Journal a witness's one terminal — nothing-checkable, nothing-material, posted or failed — then close " +
        "its worker's workspace",
      usage: WITNESS_SETTLE_USAGE,
    },
  }),
};
