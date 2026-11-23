/**
 * Lazy manifest for the `autonomy` noun — the AUTONOMY LEDGER: every act a session took under graduated
 * autonomy, why it was obvious, and the owner's retroactive word on it.
 *
 * `effect: "local-state"`: every write lands in the local store's `autonomy_event` table, nothing external, no
 * model — except `adopt`, which repairs a legacy `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` before its one-time
 * import. `qualify` is the one write that revises a stored act in place, and only its bare references. It is the recording half of the graduated level, as
 * `AGENTS.md`'s rule 10 names it.
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

/** The `autonomy` noun's verbs as lazy manifest entries. */
export const autonomyManifest: Readonly<Record<string, VerbManifestEntry>> = {
  adopt: lazy({
    load: () => import("../commands/autonomy/adopt.js").then((m) => m.autonomyAdoptCommand),
    meta: {
      ...sharedMeta,
      // A bare run reads the ledger and reports the rows it would change, so it acts rather than printing usage.
      dryParseSafe: false,
      example: "slopweaver autonomy adopt",
      summary:
        "Make rows that were hand-appended before this noun existed readable again — reports what would " +
        "change and writes nothing without --apply",
      usage: "usage: slopweaver autonomy adopt [<actionId>=<replacement> ...] [--apply] [--home <dir>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/autonomy/list.js").then((m) => m.autonomyListCommand),
    meta: {
      ...sharedMeta,
      // A bare run reads the ledger and prints every act, so it acts rather than printing usage.
      dryParseSafe: false,
      // It only reads the ledger back and renders it; `adopt`, `record`, `steer` and `steer-class` are the writers.
      effect: "none",
      example: "slopweaver autonomy list --unsteered",
      summary:
        "Read the ledger back, newest act first, each carrying the owner's latest word on it — or `--unsteered` for " +
        "the acts the owner has not reacted to yet",
      usage:
        "usage: slopweaver autonomy list [--kind <slug>] [--by-session <text>] [--since <iso>] " +
        "[--unsteered] [--home <dir>] [--json]",
    },
  }),
  qualify: lazy({
    load: () => import("../commands/autonomy/qualify.js").then((m) => m.autonomyQualifyCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver autonomy qualify finding-pr.watchpr-dies --repo acme/widgets",
      summary:
        "Write one stored act's bare GitHub references as owner/repo#<number> so the briefing renders it again — " +
        "reports what would change and writes nothing without --apply",
      usage: "usage: slopweaver autonomy qualify <actionId> --repo <owner/repo> [--apply] [--home <dir>]",
    },
  }),
  record: lazy({
    load: () => import("../commands/autonomy/record.js").then((m) => m.autonomyRecordCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver autonomy record --action-id 16644-enqueue --kind press-merge-when-ready " +
        '--subject https://github.com/acme/acme-admin/pull/<number> --by-session "workspace:123" ' +
        '--why "CI green, mergeable, every thread resolved, no code-owner request outstanding" ' +
        '--said "I merged your pull request on the admin app — every check had passed and nobody was left to ' +
        'press the button" ' +
        '--witness "slopweaver github enqueue --pr <number> -> queued at position 1"',
      summary:
        "Record ONE act taken under graduated autonomy — what was done, on which checkable object, why it " +
        "was obvious the owner would want it, the same act in words the owner reads, and the verb line that witnesses it",
      usage:
        "usage: slopweaver autonomy record --action-id <id> --kind <slug> --subject <id> --by-session <text> " +
        "--why <text> --said <text> --witness <text> [--done-iso <iso>] [--run <slug>] [--steer <text>] " +
        "[--home <dir>] [--json]",
    },
  }),
  "steer-class": lazy({
    load: () => import("../commands/autonomy/steerClass.js").then((m) => m.autonomySteerClassCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver autonomy steer-class self-merge-own-prs --kinds press-merge-when-ready,land-own-pull-request " +
        '--steer "pressing merge when ready … has been like the standing rule for ages" ' +
        "--anchor transcript:<session>#<turn> --by-session supervisor",
      summary:
        "Record the owner's standing word on a whole class of act — every act of the listed kinds reads as settled by " +
        "it, before and after, and leaves the owner's check-in list",
      usage:
        "usage: slopweaver autonomy steer-class <classId> --kinds <a,b,c> --steer <their words> " +
        "--anchor <where they said it> [--subject-prefix <literal>] --by-session <text> [--home <dir>] [--json]",
    },
  }),
  steer: lazy({
    load: () => import("../commands/autonomy/steer.js").then((m) => m.autonomySteerCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver autonomy steer 16644-enqueue --steer "yep, exactly right" --by-session supervisor',
      summary:
        "Record the owner's retroactive word about one act, appended against its id — what the supervisor runs after " +
        "the owner reads the ledger on their briefing and says something about a row",
      usage:
        "usage: slopweaver autonomy steer <actionId> --steer <their words> --by-session <text> " +
        "[--home <dir>] [--json]",
    },
  }),
};
