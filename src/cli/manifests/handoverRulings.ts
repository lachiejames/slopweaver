/**
 * The `handover` noun's RULING family — `rule`, `gate`, the two verbs that account for rulings recorded
 * before the event kind existed, and `risk`, which names the uncertainty on a row the owner's explicit steer watches.
 *
 * Its own module because `./handover.ts` is a declared offender on the file-size ratchet, frozen at its
 * recorded size, and the ruling family is the one group in it with a seam a reader would draw anyway: these
 * four verbs are the only ones that write or read a `ruling` journal event, and `handover gate` refuses at
 * the dispatch boundary rather than doing board work at all (owner turn 291-9x,
 * `../../../skills/handover/reference/ruling-gates.md`).
 *
 * It is NOT a second declaration. `.claude/rules/area-cli.md`'s one-declaration rule is about a second COPY
 * of a verb's `CommandMeta`; every entry below is declared here and nowhere else, and `./handover.ts`
 * spreads this object into the one `handoverManifest` the barrel folds.
 *
 * Lazy for the same reason every manifest is: `--help` is answered from `meta.usage` without loading the
 * module, so every `usage` here is a LITERAL and the help-truth ratchet keeps it honest.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The verbs that record, project or account for an owner ruling, and the one that names a steered row's risk. */
export const handoverRulingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "backfill-rulings": lazy({
    load: () => import("../commands/handover/backfillRulingsRun.js").then((m) => m.handoverBackfillRulingsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover backfill-rulings --manifest ~/.slopweaver/rulings/backfill.json --apply",
      parseRejectIsIoFree: true,
      summary:
        "Record each reviewed answer in a manifest as a ruling event on its own row — plans by default, writes with --apply",
      usage:
        "usage: slopweaver handover backfill-rulings --manifest <path> [--apply] [--json] [--dir <path>] [--home <dir>]",
    },
  }),
  "audit-rulings": lazy({
    load: () => import("../commands/handover/auditRulingsRun.js").then((m) => m.handoverAuditRulingsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover audit-rulings --manifest ~/.slopweaver/rulings/backfill.json --json",
      parseRejectIsIoFree: true,
      summary:
        "Read-only: account for every ruling on the board, archive and journals, and check a reviewed manifest of them as decided",
      usage: "usage: slopweaver handover audit-rulings [--manifest <path>] [--json] [--dir <path>] [--home <dir>]",
    },
  }),
  gate: lazy({
    load: () => import("../commands/handover/gateRun.js").then((m) => m.handoverGateCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover gate list",
      parseRejectIsIoFree: true,
      summary:
        "See, reproject and lift the standing ruling gates — the owner's own recorded word refusing the verbs it rules on",
      usage:
        "usage: slopweaver handover gate list|rebuild|check [--now <iso>] [--home <dir>]\n" +
        "       slopweaver handover gate release <gate-id> --anchor <where they said it> " +
        "--words <their words> [--home <dir>]",
    } as const,
  }),
  rule: lazy({
    load: () => import("../commands/handover/ruleRun.js").then((m) => m.handoverRuleCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover rule my-row --anchor <slack permalink> --words "yes, raise it on staging"',
      parseRejectIsIoFree: true,
      summary:
        "Record the owner's ruling on a row as a journal event every reader derives — with --gates, make it refuse the verbs it rules on; with --explicit-steer, mark it as the owner's override of the standing rules for this instance; with --standing-session, keep the row's seat open between the owner's turns",
      usage:
        "usage: slopweaver handover rule <slug> --anchor <where they said it> --words <their words> " +
        '[--decided-iso <when they said it>] [--gates "<noun> <verb>, …"] [--gate-subject <a,b>] ' +
        "[--gate-until <iso>] [--explicit-steer [--deliver-by <iso>]] [--standing-session [--standing-until <iso>]] " +
        "[--attach-upload permitted|refused] [--dir <path>] [--home <dir>]",
    } as const,
  }),
  risk: lazy({
    load: () => import("../commands/handover/riskRun.js").then((m) => m.handoverRiskCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover risk my-row --why "the Linear document verb is not on main; posting it raw"',
      parseRejectIsIoFree: true,
      summary:
        "Name the uncertainty on a row's deliverable the moment it is known — on a row the owner explicitly steered, it raises a floating note and a voice line at once; --clear says it passed",
      usage:
        'usage: slopweaver handover risk <slug> --why "<what the uncertainty is>" [--clear] [--dir <path>] [--home <dir>]',
    } as const,
  }),
};
