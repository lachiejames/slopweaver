/**
 * The help-truth tables' rows for `handover`'s ruling verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  HANDOVER_ALIGNMENT_BOARD_FLAG_NAMES,
  parseHandoverAlignmentBoardArgs,
} from "../../../../cli/commands/handover/alignmentBoardRun.js";
import {
  HANDOVER_AUDIT_RULINGS_FLAG_NAMES,
  parseHandoverAuditRulingsArgs,
} from "../../../../cli/commands/handover/auditRulingsRun.js";
import {
  HANDOVER_BACKFILL_RULINGS_FLAG_NAMES,
  parseHandoverBackfillRulingsArgs,
} from "../../../../cli/commands/handover/backfillRulingsRun.js";
import {
  HANDOVER_CURRENCY_FLAG_NAMES,
  parseHandoverCurrencyArgs,
} from "../../../../cli/commands/handover/currencyArgs.js";
import { parseHandoverRuleArgs } from "../../../../cli/commands/handover/ruleRun.js";
import { HANDOVER_RULE_FLAG_NAMES } from "../../../../cli/commands/handover/ruleUsage.js";
import { HANDOVER_STEERS_FLAG_NAMES, parseHandoverSteersArgs } from "../../../../cli/commands/handover/steersRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "handover steers": HANDOVER_STEERS_FLAG_NAMES,
  "handover currency": HANDOVER_CURRENCY_FLAG_NAMES,
  "handover rule": HANDOVER_RULE_FLAG_NAMES,
  "handover audit-rulings": HANDOVER_AUDIT_RULINGS_FLAG_NAMES,
  "handover backfill-rulings": HANDOVER_BACKFILL_RULINGS_FLAG_NAMES,
  "handover alignment-board": HANDOVER_ALIGNMENT_BOARD_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "handover steers": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "handover currency": {
    "--dir": ["--dir", "/tmp"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-01T00:00:00Z"],
    "--record-reading": ["--record-reading", "sync-now"],
  },
  "handover backfill-rulings": {
    "--apply": ["--apply"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--manifest": ["--manifest", "/tmp/backfill.json"],
  },
  "handover audit-rulings": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--manifest": ["--manifest", "/tmp/backfill.json"],
  },
  "handover rule": {
    "--anchor": ["--anchor", "https://example.invalid/p1"],
    "--attach-upload": ["--attach-upload", "refused"],
    "--decided-iso": ["--decided-iso", "2026-09-04T12:38:57.414Z"],
    "--deliver-by": ["--explicit-steer", "--deliver-by", "2026-10-22T05:00:00.000Z"],
    "--dir": ["--dir", "/tmp"],
    "--explicit-steer": ["--explicit-steer"],
    "--gate-subject": ["--gate-subject", "iso-policy-acceptance-daily"],
    "--gate-until": ["--gate-until", "2026-09-22T00:00:00.000Z"],
    "--gates": ["--gates", "slack post"],
    "--home": ["--home", "/tmp"],
    "--standing-session": ["--standing-session"],
    "--standing-until": ["--standing-session", "--standing-until", "2026-11-17T13:00:00.000Z"],
    "--words": ["--words", "yes, raise it"],
  },
  "handover alignment-board": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "handover steers": ({ fragment }) => parseHandoverSteersArgs({ rest: [...fragment] }),
  "handover currency": ({ fragment }) => parseHandoverCurrencyArgs({ rest: [...fragment] }),
  "handover rule": ({ fragment }) => parseHandoverRuleArgs({ rest: ["a-slug", ...fragment] }),
  "handover audit-rulings": ({ fragment }) => parseHandoverAuditRulingsArgs({ rest: [...fragment] }),
  "handover backfill-rulings": ({ fragment }) => parseHandoverBackfillRulingsArgs({ rest: [...fragment] }),
  "handover alignment-board": ({ fragment }) => parseHandoverAlignmentBoardArgs({ rest: [...fragment] }),
};

/** The rows for `handover`'s ruling verbs. */
export const handoverRulingsSlice: HelpTruthSlice = { guarded, probes, parsers };
