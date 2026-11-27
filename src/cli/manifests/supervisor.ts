/**
 * Lazy manifest for the `supervisor` noun — the verbs that keep the supervisor role's standing rules in
 * files rather than in a prompt a successor retypes, and the intake check over what the owner typed into it
 * (see `cli/manifest.ts`).
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { supervisorStateDocManifest } from "./supervisorStateDoc.js";

/** The `supervisor` noun's verbs as lazy manifest entries; the state-doc family is `./supervisorStateDoc.ts`. */
export const supervisorManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...supervisorStateDocManifest,
  chain: lazy({
    load: () => import("../commands/supervisor/chainRun.js").then((m) => m.supervisorChainCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // Every flag is optional: a bare `runChain` reads the pin chain journal and prints it (`--rescan` appends links).
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver supervisor chain --rescan",
      parseRejectIsIoFree: true,
      summary:
        "List every session that has held the supervisor pin — the succession `intake` walks — and rescan the transcripts to repair it",
      usage: "usage: slopweaver supervisor chain [--rescan] [--home <dir>] [--json]",
    },
  }),
  intake: lazy({
    load: () => import("../commands/supervisor/intakeRun.js").then((m) => m.supervisorIntakeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // Every flag is optional: a bare `runIntake` scans the board and the chain's transcripts and prints the report.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver supervisor intake",
      parseRejectIsIoFree: true,
      summary:
        "Walk the whole supervisor chain and say which turns the owner typed into it no row, settlement or mark witnesses",
      usage:
        "usage: slopweaver supervisor intake [--session <id>] [--since <iso>] [--now <iso>] [--home <dir>] [--json]",
    },
  }),
  "intake-mark": lazy({
    load: () => import("../commands/supervisor/intakeMarkRun.js").then((m) => m.supervisorIntakeMarkCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver supervisor intake-mark --turn transcript:<session>#<turn> --as card --witness "Merge the stack tonight?"',
      parseRejectIsIoFree: true,
      summary:
        "Record that an owner turn became a page card, an answer, or asked for nothing — the witness the intake check reads; an answer naming a row carries the owner's words onto it",
      usage:
        "usage: slopweaver supervisor intake-mark --turn <pointer> --as card|answered|no-ask --witness <text> [--now <iso>] [--home <dir>]",
    },
  }),
  "owner-turns": lazy({
    load: () => import("../commands/supervisor/ownerTurnsRun.js").then((m) => m.supervisorOwnerTurnsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // Every flag is optional: a bare `runSupervisorOwnerTurns` reads the owner's turns, prints a chunk and appends receipts.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver supervisor owner-turns",
      parseRejectIsIoFree: true,
      summary:
        "Print every turn the owner typed into the supervisor chain in the last seven days, verbatim and in bounded chunks, recording one receipt per turn — the read `cmux takeover` refuses to move the pin without",
      usage:
        "usage: slopweaver supervisor owner-turns [--days <n>] [--bytes <n>] [--session <id>|codex:<thread-id>] [--home <dir>] [--now <iso>] [--check] [--json]",
    },
  }),
  reoriented: lazy({
    load: () => import("../commands/fleet/reorientedRun.js").then((m) => m.supervisorReorientedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Every flag is optional: a bare `runSupervisorReoriented` reads the fleet journal and appends the caught-up event.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver supervisor reoriented --attempt <uuid>",
      parseRejectIsIoFree: true,
      summary:
        "Say the supervisor is caught up after a restart — the one line that turns it green and lets `fleet resume` start every other seat",
      usage: "usage: slopweaver supervisor reoriented [--attempt <uuid>] [--home <dir>] [--json]",
    },
  }),
  "successor-summary": lazy({
    load: () =>
      import("../commands/supervisor/successorSummaryRun.js").then((m) => m.supervisorSuccessorSummaryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver supervisor successor-summary --reconcile reconcile.json --out summary.md",
      parseRejectIsIoFree: true,
      summary:
        "Derive the outcomes half of a successor handover — the outcomes the owner kept on their Workstreams register with their anchors and this tick's coverage, then the whole ready set — sealed with a hash `state-archive` verifies",
      usage:
        "usage: slopweaver supervisor successor-summary --reconcile <json|-> [--out <path>] [--now <iso>] [--json]",
    },
  }),
  "tick-draft": lazy({
    load: () => import("../commands/supervisor/tickDraftRun.js").then((m) => m.supervisorTickDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver supervisor tick-draft --tick-id handoff-9249-tick-7 --workspace workspace:55 --handoff handoff-9249 --started 2026-09-12T21:18:42Z --captured 2026-09-12T21:25:00Z --actions actions.json --judgements judgements.json --capacity capacity.json --out draft.json",
      parseRejectIsIoFree: true,
      summary:
        "Build a sweep tick's tick-record draft from the source verbs' own JSON the tick redirected — every reading from a document, never a constant",
      usage:
        "usage: slopweaver supervisor tick-draft --tick-id <id> --workspace <ws> --handoff <handoff> --started <iso> --captured <iso> --actions <path> --judgements <path> --out <path|-> [--capacity <path>] [--seat-ceiling <path>] [--gauge <path>] [--listener <path>] [--reconcile <path>] [--watch <path>] [--close-done <path>] [--recipe-due <path>] [--velocity <path>] [--friction <path>] [--json]",
    },
  }),
  tick: lazy({
    load: () => import("../commands/supervisor/tickRun.js").then((m) => m.supervisorTickCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver supervisor tick close --dir ~/.slopweaver/supervisor-scratch/handoff-9292",
      parseRejectIsIoFree: true,
      summary:
        "One chair sweep: `open` takes and digests every reading, writes the whole digest to tick-<n>/digest.txt and prints only what changed since tick n-1 plus every standing obligation, folding the rest behind that file, and writes the tick file, `fill` edits it in place (carrying the last tick's folds and judgements, adding or replacing a row by id) so no pass reaches for jq, `close` refuses a malformed one naming the field, then commits the form, page and tick row and prints the next sweep prompt last; `--your-list` hands it a list session-start already wrote when its own refresh overruns under load",
      usage:
        "usage: slopweaver supervisor tick seat --dir <scratch dir> --workspace <workspace:n> --model <model> --pinned-at <iso> --loop-session-key <key> [--handoff <handoff-n>] [--landing-repos <owner/name,...>] [--replace] | tick open --dir <scratch dir> [--tick <n>] [--bin <path>] [--home <dir>] | tick fill --dir <scratch dir> [--tick <n>] [--carry-from <n>] [--headline-sentence <text>]... [--fold <text>... | --fold-file <path>...] [--fold-at <i>] [--fold-summary <text>] [--lede <text>] [--alignment-summary <text>] [--earlier-summary <text>] [--alignment-detail <text>]... [--drop-card <prefix>]... [--sleeping true|false] [--open-pages-reviewed true|false] [--shift <text> | --shift-file <path> | --quiet-shift] [--actions <json path>] [--judgements <json path>] [--drop-action <id>]... [--drop-judgement <id>]... | tick close --dir <scratch dir> [--tick <n>] [--bin <path>] [--home <dir>] [--your-list <path>]",
    },
  }),
  "tick-capture": lazy({
    load: () => import("../commands/supervisor/scratchRun.js").then((m) => m.supervisorTickCaptureCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver supervisor tick-capture --dir ~/.slopweaver/supervisor-scratch/handoff-9271 --tick 4 --loop-session-key live-bot-loop-15sep-a",
      parseRejectIsIoFree: true,
      summary:
        "Take every reading a sweep tick takes into its own directory, one file per reading, and print the tick-draft flags those files supply — never a copied tick.sh",
      usage:
        "usage: slopweaver supervisor tick-capture --dir <scratch dir> --tick <label> --loop-session-key <key> [--bin <path>] [--home <dir>] [--json]",
    },
  }),
  "refresh-run": lazy({
    load: () => import("../commands/supervisor/scratchRefresh.js").then((m) => m.supervisorRefreshRunCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver supervisor refresh-run --dir ~/.slopweaver/supervisor-scratch/handoff-9271",
      parseRejectIsIoFree: true,
      summary:
        "Rebuild a seat's run.json from session-start and its autonomy-qualified.jsonl from the ledger, every bare #<number> qualified — never a copied refresh-run.sh",
      usage:
        "usage: slopweaver supervisor refresh-run --dir <scratch dir> [--repo <owner/name>] [--bin <path>] [--home <dir>] [--json]",
    },
  }),
  "scratch-carry": lazy({
    load: () => import("../commands/supervisor/scratchRun.js").then((m) => m.supervisorScratchCarryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver supervisor scratch-carry --from ~/.slopweaver/supervisor-scratch/handoff-9270 --to ~/.slopweaver/supervisor-scratch/handoff-9271",
      parseRejectIsIoFree: true,
      summary:
        "Carry only the state a seat inherits — form.json, open-pages.json, shell.txt — from the predecessor's scratch, never its readings or scripts",
      usage:
        "usage: slopweaver supervisor scratch-carry --from <predecessor dir> --to <successor dir> [--dry-run] [--json]",
    },
  }),
  "tick-record": lazy({
    load: () => import("../commands/supervisor/tickRecordRun.js").then((m) => m.supervisorTickRecordCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // `gateChairThenRun` reads the pinned chair and its telemetry BEFORE the flags parse (and may type
      // `/model fable` into the caller's workspace), so a bare run or an unknown flag is not a dry parse.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver supervisor tick-record --draft draft.json --reconcile reconcile.json",
      parseRejectIsIoFree: false,
      summary:
        "Append one finalised sweep tick — its twelve source readings, its actions and the owner's own turns verbatim — to the ledger the briefing's narrative sections are derived from",
      usage:
        "usage: slopweaver supervisor tick-record --draft <json|-> --reconcile <json|-> [--home <dir>] [--now <iso>] [--json]",
    },
  }),
  "tick-reseal": lazy({
    load: () => import("../commands/supervisor/tickResealRun.js").then((m) => m.supervisorTickResealCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Every flag is optional: a bare run streams and hashes the whole tick ledger for its preview.
      dryParseSafe: false,
      effect: "local-state",
      example:
        'slopweaver supervisor tick-reseal --apply --source-sha256 <hex> --reason "carried home: stats stale after sanitising"',
      parseRejectIsIoFree: true,
      summary:
        "Reseal a tick ledger whose rows carry stale stats — a bare run previews and prints the digest, `--apply` backs it up, rewrites it under the ledger's lock, reads it back clean and journals a receipt",
      usage:
        'usage: slopweaver supervisor tick-reseal [--home <dir>] [--json] | tick-reseal --apply --source-sha256 <hex> --reason "<why>" [--now <iso>] [--home <dir>] [--json]',
    },
  }),
  "owner-turn-record": lazy({
    load: () => import("../commands/supervisor/ownerTurnRun.js").then((m) => m.supervisorOwnerTurnRecordCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver supervisor owner-turn-record --file ~/.slopweaver/supervisor-scratch/handoff-9291/owner-turn-291-60.txt",
      parseRejectIsIoFree: true,
      summary:
        "Record one owner-turn-*.txt a seat just wrote into the store, byte-exact and hashed — the file stays, the store holds the owner's words",
      usage: "usage: slopweaver supervisor owner-turn-record --file <path> [--home <dir>] [--json]",
    },
  }),
  "owner-turn-show": lazy({
    load: () => import("../commands/supervisor/ownerTurnRun.js").then((m) => m.supervisorOwnerTurnShowCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver supervisor owner-turn-show --ref <ref>",
      parseRejectIsIoFree: true,
      summary:
        "Print an owner turn from the store by anchor or turn label — never from disk, so a reclaimed file still reads",
      usage: "usage: slopweaver supervisor owner-turn-show --ref <anchor|turn> [--all] [--home <dir>] [--json]",
    },
  }),
  "sweep-prompt": lazy({
    load: () => import("../commands/supervisor/run.js").then((m) => m.supervisorSweepPromptCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // `gateChairThenRun` reads the pinned chair and its telemetry BEFORE the flags parse, and on an off-Fable
      // chair `recordChairRestoreAttempt` appends a restore row under the state home, so this is not a dry parse.
      dryParseSafe: false,
      effect: "local-state",
      example: 'slopweaver supervisor sweep-prompt --shift "merge queue: one pull request rebasing"',
      parseRejectIsIoFree: false,
      summary: "Render the sweep wakeup prompt from the standing contract file plus this tick's shift state",
      usage: "usage: slopweaver supervisor sweep-prompt [--shift <text> | --shift-file <path>] [--budget] [--json]",
    },
  }),
};
