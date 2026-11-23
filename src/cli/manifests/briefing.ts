/**
 * `slopweaver briefing corrections` — the half of a page that shows where it changed which writes the marks.
 *
 * It diffs the next version against the store's newest freeze, which `briefing freeze` (`./freezeRun.ts`) took of
 * what the owner read, and writes the computed marks onto it. It never publishes.
 *
 * chair ran every sweep (anything done with Python is done in TypeScript
 * inside Slopweaver and exposed through the CLI). `card` is the same replacement for the open-pages document: the
 * one row-authoring verb, and with `--drop` the one row-removing one, so `cardsN-M.py` and the jq edits that
 * followed it have no reason to exist.
 *
 * `freeze` and `corrections` are the pair that answers one need — a republished page has to show
 * WHERE it changed. `freeze` keeps the bytes each publish put in front of the owner; `corrections` diffs the next
 * version against them and writes the marks. The order matters and is not optional either way round: with
 * no freeze there is nothing to diff, and with no diff the marks are somebody's memory.
 */
import {
  BRIEFING_ARCHIVE_USAGE,
  BRIEFING_CARD_USAGE,
  BRIEFING_CHECK_USAGE,
  BRIEFING_CORRECTIONS_USAGE,
  BRIEFING_FOLD_CAPS_USAGE,
  BRIEFING_FREEZE_USAGE,
  BRIEFING_RECUT_USAGE,
  BRIEFING_RENDER_USAGE,
  BRIEFING_SWEEP_BLOCK_USAGE,
} from "../commands/briefing/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const briefingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  archive: lazy({
    load: () => import("../commands/briefing/archiveRun.js").then((m) => m.briefingArchiveCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing archive --form ./scratchpad/form.json",
      parseRejectIsIoFree: true,
      summary:
        "Move a briefing form's oldest folded notes and history sections into a dated archive file, so the form fits the section caps again",
      usage: BRIEFING_ARCHIVE_USAGE,
    },
  }),
  card: lazy({
    load: () => import("../commands/briefing/cardRun.js").then((m) => m.briefingCardCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing card --open-pages ./scratchpad/open-pages.json --row ./scratchpad/row.json",
      parseRejectIsIoFree: true,
      summary:
        "Append one open-pages row — held to every cap, framing and voice rule the rendered card meets — atomically, refusing rather than truncating, or drop the one row the owner's recorded ruling settled, so a card is never authored or removed by a script or a hand edit",
      usage: BRIEFING_CARD_USAGE,
    },
  }),
  check: lazy({
    load: () => import("../commands/briefing/run.js").then((m) => m.briefingCheckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver briefing check ./scratchpad/fleet-briefing.html",
      parseRejectIsIoFree: true,
      summary: "Refuse a fleet-briefing artifact whose react-now cards or page put a wall of text above the fold",
      usage: BRIEFING_CHECK_USAGE,
    },
  }),
  corrections: lazy({
    load: () => import("../commands/briefing/correctionsRun.js").then((m) => m.briefingCorrectionsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing corrections --artifact <id> --page ./scratchpad/fleet-briefing.html",
      parseRejectIsIoFree: true,
      summary:
        "Mark a republished page where it actually changed, computed from the diff against the version the owner already read, never from an author's list",
      usage: BRIEFING_CORRECTIONS_USAGE,
    },
  }),
  freeze: lazy({
    load: () => import("../commands/briefing/freezeRun.js").then((m) => m.briefingFreezeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing freeze --artifact <id> --page ./scratchpad/fleet-briefing.html",
      parseRejectIsIoFree: true,
      summary:
        "Keep the exact bytes a publish put in front of the owner, so a later correction edits a file rather than a memory of one",
      usage: BRIEFING_FREEZE_USAGE,
    },
  }),
  "fold-caps": lazy({
    load: () => import("../commands/briefing/foldCapsRun.js").then((m) => m.briefingFoldCapsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing fold-caps --form ./scratchpad/form.json",
      parseRejectIsIoFree: true,
      summary:
        "Join the adjacent paragraphs and lists of any fold carrying more than four blocks, changing no word, so the form fits the fold's shape rule again",
      usage: BRIEFING_FOLD_CAPS_USAGE,
    },
  }),
  recut: lazy({
    load: () => import("../commands/briefing/recutRun.js").then((m) => m.briefingRecutCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver briefing recut --form ./scratchpad/form.json --out ./scratchpad/form.json",
      parseRejectIsIoFree: true,
      summary:
        "Rewrite the fleet words in a form's authored prose into plain ones, and name the ones it has no plain substitution for",
      usage: BRIEFING_RECUT_USAGE,
    },
  }),
  "sweep-block": lazy({
    load: () => import("../commands/briefing/sweepBlockRun.js").then((m) => m.briefingSweepBlockCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver briefing sweep-block --form ./scratchpad/form.json --workspace workspace:55 --handoff handoff-9250 --model fable --pinned-at 2026-09-13T00:11:07Z --sleeping false --alignment "<the reconcile headline>" --headline-sentence "<the bold first sentence>" --headline-sentence "<one more sentence>" --fold "<one paragraph>" --fold-summary "<what the fold holds>"',
      parseRejectIsIoFree: true,
      summary:
        "Apply one supervisor sweep to the briefing form — the header taken over, ruled cards dropped, the alignment line set and one recent block added — validated whole against the schema before anything is written",
      usage: BRIEFING_SWEEP_BLOCK_USAGE,
    },
  }),
  render: lazy({
    load: () => import("../commands/briefing/renderRun.js").then((m) => m.briefingRenderCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver session-start --json --no-record > list.json && slopweaver briefing render --form - --your-list list.json --open-prs --open-artifacts open-pages.json --out ./scratchpad/fleet-briefing.html < form.json",
      parseRejectIsIoFree: true,
      summary:
        "Emit the fleet-briefing page from a typed form whose schema refuses a wall of text, with the owner's list, a card per open pull request, the ranked validity-marked index of every open artifact, and — behind --ticks — the three narrative sections projected from the supervisor tick ledger rather than authored — refusing outright when the owner's list or the open-page index was snapshotted more than ninety minutes before the render, so a day-old half can never sit under a current-looking header",
      usage: BRIEFING_RENDER_USAGE,
    },
  }),
};
