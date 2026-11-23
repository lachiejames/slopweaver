/**
 * The `supervisor` noun's STATE-DOC family — `state-amend`, `state-fold`, `state-archive` and `state-check`, the
 * four verbs that edit or judge the supervisor state doc (`../../../skills/supervisor/reference/state-doc.md`).
 *
 * Its own module because adding `state-fold` took `./supervisor.ts` past the file-size ratchet's cap, and this
 * family is the seam a reader would draw anyway: these four verbs, and no other supervisor verb, read the
 * state doc.
 *
 * It is NOT a second declaration. `.claude/rules/area-cli.md`'s one-declaration rule is about a second COPY
 * of a verb's `CommandMeta`; every entry below is declared here and nowhere else, and `./supervisor.ts`
 * spreads this object into the one `supervisorManifest` the barrel folds. Every `usage` is a LITERAL so
 * `--help` never loads a command module, and the help-truth ratchet keeps it honest.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The verbs that edit or judge the supervisor state doc. */
export const supervisorStateDocManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "state-amend": lazy({
    load: () => import("../commands/supervisor/stateDocEditRun.js").then((m) => m.supervisorStateAmendCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver supervisor state-amend --doc ~/state.md --handoff 9249 --row "07:5x TICK ZERO."',
      parseRejectIsIoFree: true,
      summary:
        "Append rows to a seat's own boot block in the supervisor state doc, refusing rather than truncating at either line cap",
      usage:
        "usage: slopweaver supervisor state-amend --doc <path> --handoff <n> --row <text> [--row <text> ...] [--after-rulings] [--json]",
    },
  }),
  "state-archive": lazy({
    load: () => import("../commands/supervisor/stateDocEditRun.js").then((m) => m.supervisorStateArchiveCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver supervisor state-archive --doc ~/state.md --predecessor 9248 --successor 9249 --archive state-9248.md --description "the 9248 seat" --block-file block.md --successor-summary summary.md',
      parseRejectIsIoFree: true,
      summary:
        "Move the predecessor's boot block into a no-clobber archive file, chain the archive note, and install the successor's block",
      usage:
        "usage: slopweaver supervisor state-archive --doc <path> --predecessor <n> --successor <n> --archive <file name> --description <text> --block-file <path> --successor-summary <path> [--when <text>] [--json]",
    },
  }),
  "state-check": lazy({
    load: () => import("../commands/supervisor/run.js").then((m) => m.supervisorStateCheckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver supervisor state-check --path ~/state.md",
      parseRejectIsIoFree: true,
      summary: "Judge a supervisor state doc against the whole-doc and current-boot-block line caps",
      usage: "usage: slopweaver supervisor state-check --path <doc> [--json]",
    },
  }),
  "state-fold": lazy({
    load: () => import("../commands/supervisor/stateDocEditRun.js").then((m) => m.supervisorStateFoldCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver supervisor state-fold --doc ~/state.md --handoff 9249 --keep 10 --archive state-9249-fold-1.md --description "ticks to 14:00"',
      parseRejectIsIoFree: true,
      summary:
        "Mid-shift, move a seat's oldest boot-block rows into a no-clobber archive file and leave one note row, so a block at its line cap can take rows again",
      usage:
        "usage: slopweaver supervisor state-fold --doc <path> --handoff <n> --keep <rows> --archive <file name> --description <text> [--when <text>] [--json]",
    },
  }),
};
