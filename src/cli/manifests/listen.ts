/**
 * Lazy manifest for the `listen` noun — slopweaver's first INBOUND surface.
 *
 * `listen` (the bare default) and `listen run` both resolve to the one handler, the convention `refresh` and
 * `connect` already follow. The Socket Mode module loads only when the verb is dispatched, so a websocket
 * client is never on an unrelated invocation's load path.
 *
 * The meta still declares `external-write` + `doorRouted`, and that needs saying because the listener no
 * longer composes an answer: an ADMITTED tag is PRINTED for the calling session, not replied to. What keeps
 * the declaration honest now is two writes, not one — `stubAcknowledgeHandler`'s transport proof, and the
 * responder-refusal reply a non-whitelisted identity actually gets, both through `throughDoor`. Over-declaring
 * an effect is the safe direction; the unsafe one is a verb that writes while claiming to read.
 *
 * `recover` declares `external-write` too, for the same reason `listen`/`run` does: `--scheduled` now feeds an
 * admitted survivor through the same capture UX (reaction, checklist, status) a live socket tag gets, and a
 * refused responder gets the same fixed reply — both through `throughDoor`. Manual (non-`--scheduled`) mode
 * is still exactly the report-only read it always was; the declaration covers the wider of the two shapes on
 * purpose, the same over-declare-rather-than-under-declare reasoning as `listen`/`run` above.
 */

import {
  LISTEN_ARM_USAGE,
  LISTEN_DISARM_USAGE,
  LISTEN_RECONCILE_USAGE,
  LISTEN_RECOVER_USAGE,
  LISTEN_STATUS_USAGE,
  LISTEN_SUPERVISE_USAGE,
  LISTEN_USAGE,
} from "../commands/listen/listenUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const listenMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  effect: "external-write",
  example: "slopweaver listen --check",
  parseRejectIsIoFree: true,
  summary:
    "Capture the next Slack message that ADDRESSES the bot: an admitted one is printed for the calling " +
    "session to answer, a non-whitelisted one gets a fixed refusal reply — never silence, never a composed answer",
  usage: LISTEN_USAGE,
} as const;

const loadListen = () => import("../commands/listen/run.js").then((m) => m.listenCommand);

export const listenManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadListen, meta: listenMeta }),
  arm: lazy({
    load: () => import("../commands/listen/supervise.js").then((m) => m.listenArmCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads the arm record and prints a command. It starts no process and writes nothing at all, which is
      // why the effect is `none` rather than `local-state`.
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver listen arm",
      parseRejectIsIoFree: true,
      summary:
        "Print the ONE shell line the visible loop session runs to start the listener as its own child — a " +
        "fresh arm id and log file, refused when one is already live. Starts nothing itself",
      usage: LISTEN_ARM_USAGE,
    },
  }),
  disarm: lazy({
    load: () => import("../commands/listen/supervise.js").then((m) => m.listenDisarmCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver listen disarm",
      parseRejectIsIoFree: true,
      summary: "Clear the listener's arm record and journal it — sends no signal, idempotent",
      usage: LISTEN_DISARM_USAGE,
    },
  }),
  recover: lazy({
    load: () => import("../commands/listen/recover.js").then((m) => m.listenRecoverCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver listen recover --bot-user U_BOT --channels C_ONE,C_TWO --discover-channels --since 7d",
      parseRejectIsIoFree: true,
      summary:
        "Find tags nobody answered — skipping already-answered, too-old, wrong-place and not-addressed. " +
        "--scheduled additionally captures an admitted survivor (reaction/checklist/status) or refuses one, " +
        "through the door; manual mode stays report-only. --channels is reply ELIGIBILITY in every mode; " +
        "--discover-channels WIDENS a manual pass' breadth with the bot's own membership, on top of the typed list.",
      usage: LISTEN_RECOVER_USAGE,
    },
  }),
  reconcile: lazy({
    load: () => import("../commands/listen/supervise.js").then((m) => m.listenReconcileCommand),
    meta: {
      createsWorkItem: false,
      // Recording a death nothing watched is a FOUND FAULT reported by a verb that ran perfectly — the same
      // reasoning `status` and `supervise` carry.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver listen reconcile --json",
      parseRejectIsIoFree: true,
      summary:
        "Back-write every listener death the arm journal implies but nothing was alive to record — a " +
        "death-watch that is a sibling task of the listener dies with it. Idempotent; never escalates",
      usage: LISTEN_RECONCILE_USAGE,
    },
  }),
  run: lazy({ load: loadListen, meta: listenMeta }),
  status: lazy({
    load: () => import("../commands/listen/supervise.js").then((m) => m.listenStatusCommand),
    meta: {
      createsWorkItem: false,
      // A DOWN listener is a FOUND FAULT reported by a verb that ran perfectly — the same reasoning
      // `doctor` and `cmux spawn` carry.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver listen status --json",
      parseRejectIsIoFree: true,
      summary:
        "Report the supervised listener's liveness — including 'process alive, socket dead', the failure a " +
        "pidfile check can never see — and which commit the loop is running. Exits non-zero when it is DOWN " +
        "or STALE",
      usage: LISTEN_STATUS_USAGE,
    },
  }),
  supervise: lazy({
    load: () => import("../commands/listen/supervise.js").then((m) => m.listenSuperviseCommand),
    meta: {
      createsWorkItem: false,
      // Escalating (leaving the listener DOWN rather than handing back a fourth re-arm command) is a found
      // fault, not a broken tool — same reasoning as `status` above.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver listen supervise --json",
      parseRejectIsIoFree: true,
      summary:
        "One death-watch tick for the loop session: journal a death, count it, and answer re-arm (with the " +
        "command to run) or — after 3 deaths in 15 minutes — escalate, leaving the bot deliberately DOWN",
      usage: LISTEN_SUPERVISE_USAGE,
    },
  }),
};
