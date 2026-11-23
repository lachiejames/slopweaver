/**
 * Lazy manifest for the `grant` noun — the journalled grant: one recorded decision the owner already made,
 * carried to the session that performs it in a shape that session can CHECK.
 *
 * `effect: "local-state"`: every write is one row of this home's store's `grant_row` table, nothing external; a
 * store outage is a typed refusal, never a write to a file instead (`src/grants/port.ts`).
 * A row is not authority — `.claude/rules/journalled-grants.md` and `src/grants/grant.ts` both say what it
 * does and does not buy, and neither `record` nor `perform` widens what may be decided without the owner.
 *
 * `show`, `perform` and `refuse` are `diagnostic`: a non-zero exit REPORTS a failed check on a row, which is
 * the verb working exactly as intended, not a broken tool.
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

/** The `grant` noun's verbs as lazy manifest entries. */
export const grantManifest: Readonly<Record<string, VerbManifestEntry>> = {
  list: lazy({
    load: () => import("../commands/grant/list.js").then((m) => m.grantListCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver grant list --json",
      summary: "Every recorded grant in this home and what happened to each — performed, typed-refused, or still open",
      usage: "usage: slopweaver grant list [--home <value>] [--json]",
    },
  }),
  perform: lazy({
    load: () => import("../commands/grant/perform.js").then((m) => m.grantPerformCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      example: "slopweaver grant perform g-1a2b3c4d --wrote-file /tmp/what-i-wrote.diff",
      summary:
        "Journal what the session ACTUALLY wrote against a row, byte for byte — the read-back that makes an " +
        "over-grant findable; refuses on a named check rather than accepting a mismatch",
      usage:
        "usage: slopweaver grant perform <grant-id> [--home <value>] [--json] [--wrote <value>] [--wrote-file <value>]",
    },
  }),
  record: lazy({
    load: () => import("../commands/grant/record.js").then((m) => m.grantRecordCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver grant record --target-file src/config.ts --change-kind literal --change "TIMEOUT = 30" ' +
        "--anchor transcript:<session>#<turn>",
      summary:
        "Record ONE decision the owner already made — the file or system, the EXACT change, the anchor it came " +
        "from, who wrote it down and when",
      usage:
        "usage: slopweaver grant record [--anchor <value>] [--change <value>] [--change-file <value>] " +
        "[--change-kind <value>] [--home <value>] [--json] [--target-file <value>] [--target-system <value>]",
    },
  }),
  refuse: lazy({
    load: () => import("../commands/grant/refuse.js").then((m) => m.grantRefuseCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver grant refuse g-1a2b3c4d --check RAIL_CROSSED --why "this would widen access"',
      summary:
        "Decline a row by NAMING the check that failed — the closed set has no code for disbelieving the " +
        "sender, so an untyped refusal is not an available shape",
      usage: "usage: slopweaver grant refuse <grant-id> [--check <value>] [--home <value>] [--json] [--why <value>]",
    },
  }),
  show: lazy({
    load: () => import("../commands/grant/show.js").then((m) => m.grantShowCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      example: "slopweaver grant show g-1a2b3c4d",
      summary:
        "What the executing session reads before it acts: the row, every computable check already run, and the " +
        "two checks that are still its own",
      usage: "usage: slopweaver grant show <grant-id> [--home <value>] [--json]",
    },
  }),
};
