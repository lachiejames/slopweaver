/**
 * The help-truth tables' rows for `supervisor`'s state, intake and owner-turn verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseReorientedArgs, REORIENTED_FLAG_NAMES } from "../../../../cli/commands/fleet/reorientedRun.js";
import { CHAIN_FLAG_SPEC, parseChainOptions } from "../../../../cli/commands/supervisor/chainRun.js";
import { supervisorErrorLines } from "../../../../cli/commands/supervisor/errors.js";
import { INTAKE_MARK_FLAG_SPEC, parseIntakeMarkOptions } from "../../../../cli/commands/supervisor/intakeMarkRun.js";
import { INTAKE_FLAG_SPEC, parseIntakeOptions } from "../../../../cli/commands/supervisor/intakeRun.js";
import {
  OWNER_TURN_RECORD_FLAG_SPEC,
  OWNER_TURN_SHOW_FLAG_SPEC,
  parseOwnerTurnRecordArgs,
  parseOwnerTurnShowArgs,
} from "../../../../cli/commands/supervisor/ownerTurnCore.js";
import {
  OWNER_TURNS_FLAG_SPEC,
  SUPERVISOR_OWNER_TURNS_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/ownerTurnsRun.js";
import { parseStateCheckOptions, STATE_CHECK_FLAG_SPEC } from "../../../../cli/commands/supervisor/run.js";
import {
  parseScratchCarryArgs,
  SUPERVISOR_SCRATCH_CARRY_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/scratchCore.js";
import {
  parseStateAmendArgs,
  parseStateArchiveArgs,
  parseStateFoldArgs,
  STATE_AMEND_FLAG_SPEC,
  STATE_ARCHIVE_FLAG_SPEC,
  STATE_FOLD_FLAG_SPEC,
} from "../../../../cli/commands/supervisor/stateDocEditCore.js";
import {
  SUCCESSOR_SUMMARY_FLAG_SPEC,
  SUPERVISOR_SUCCESSOR_SUMMARY_FLAG_NAMES,
} from "../../../../cli/commands/supervisor/successorSummaryRun.js";
import { parseFlagTail } from "../../../../cli/optionParsers.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** `supervisor state-check`'s advertised flags, derived from the spec the verb parses with. */
const STATE_CHECK_FLAG_NAMES: readonly string[] = [
  ...STATE_CHECK_FLAG_SPEC.value.map((name) => `--${name}`),
  ...STATE_CHECK_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor state-amend`'s advertised flags, derived from the spec the verb parses with. */
const STATE_AMEND_FLAG_NAMES: readonly string[] = [
  ...STATE_AMEND_FLAG_SPEC.value.map((name) => `--${name}`),
  ...STATE_AMEND_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor state-archive`'s advertised flags, derived from the spec the verb parses with. */
const STATE_ARCHIVE_FLAG_NAMES: readonly string[] = [
  ...STATE_ARCHIVE_FLAG_SPEC.value.map((name) => `--${name}`),
  ...STATE_ARCHIVE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor state-fold`'s advertised flags, derived from the spec the verb parses with. */
const STATE_FOLD_FLAG_NAMES: readonly string[] = [
  ...STATE_FOLD_FLAG_SPEC.value.map((name) => `--${name}`),
  ...STATE_FOLD_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor chain`'s advertised flags, derived from the spec the verb parses with. */
const CHAIN_FLAG_NAMES: readonly string[] = [
  ...CHAIN_FLAG_SPEC.value.map((name) => `--${name}`),
  ...CHAIN_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor intake`'s advertised flags, derived from the spec the verb parses with. */
const INTAKE_FLAG_NAMES: readonly string[] = [
  ...INTAKE_FLAG_SPEC.value.map((name) => `--${name}`),
  ...INTAKE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor intake-mark`'s advertised flags, derived from the spec the verb parses with. */
const INTAKE_MARK_FLAG_NAMES: readonly string[] = [
  ...INTAKE_MARK_FLAG_SPEC.value.map((name) => `--${name}`),
  ...INTAKE_MARK_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor owner-turn-record`'s advertised flags, derived from the spec the verb parses with. */
const OWNER_TURN_RECORD_FLAG_NAMES: readonly string[] = [
  ...OWNER_TURN_RECORD_FLAG_SPEC.value.map((name) => `--${name}`),
  ...OWNER_TURN_RECORD_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `supervisor owner-turn-show`'s advertised flags, derived from the spec the verb parses with. */
const OWNER_TURN_SHOW_FLAG_NAMES: readonly string[] = [
  ...OWNER_TURN_SHOW_FLAG_SPEC.value.map((name) => `--${name}`),
  ...OWNER_TURN_SHOW_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "supervisor chain": CHAIN_FLAG_NAMES,
  "supervisor intake": INTAKE_FLAG_NAMES,
  "supervisor reoriented": REORIENTED_FLAG_NAMES,
  "supervisor intake-mark": INTAKE_MARK_FLAG_NAMES,
  "supervisor owner-turns": SUPERVISOR_OWNER_TURNS_FLAG_NAMES,
  "supervisor owner-turn-record": OWNER_TURN_RECORD_FLAG_NAMES,
  "supervisor owner-turn-show": OWNER_TURN_SHOW_FLAG_NAMES,
  "supervisor state-amend": STATE_AMEND_FLAG_NAMES,
  "supervisor successor-summary": SUPERVISOR_SUCCESSOR_SUMMARY_FLAG_NAMES,
  "supervisor state-archive": STATE_ARCHIVE_FLAG_NAMES,
  "supervisor state-check": STATE_CHECK_FLAG_NAMES,
  "supervisor state-fold": STATE_FOLD_FLAG_NAMES,
  "supervisor scratch-carry": SUPERVISOR_SCRATCH_CARRY_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "supervisor chain": {
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--rescan": ["--rescan"],
  },
  "supervisor intake": {
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-02T17:00:00Z"],
    "--session": ["--session", "a0000013-0000-4000-8000-000000000014"],
    "--since": ["--since", "2026-09-02T14:00:00Z"],
  },
  "supervisor reoriented": {
    "--attempt": ["--attempt", "0b7c2a7e-0d8f-4a4e-9a43-7d6a1c0b2e11"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
  },
  "supervisor intake-mark": {
    "--as": ["--as", "no-ask"],
    "--home": ["--home", "/tmp/home"],
    "--now": ["--now", "2026-09-02T17:00:00Z"],
    "--turn": ["--turn", "transcript:a0000013-0000-4000-8000-000000000014#0a335102-005d-4f3d-a2e3-cbbf3fd794c0"],
    "--witness": ["--witness", "brief me"],
  },
  "supervisor state-amend": {
    "--after-rulings": ["--after-rulings"],
    "--doc": ["--doc", "/s.md"],
    "--handoff": ["--handoff", "9249"],
    "--json": ["--json"],
    "--row": ["--row", "- 07:5x TICK ZERO."],
  },
  "supervisor state-archive": {
    "--archive": ["--archive", "state-9248.md"],
    "--successor-summary": ["--successor-summary", "/tmp/summary.md"],
    "--block-file": ["--block-file", "/tmp/block.md"],
    "--description": ["--description", "the 9248 seat"],
    "--doc": ["--doc", "/s.md"],
    "--json": ["--json"],
    "--predecessor": ["--predecessor", "9248"],
    "--successor": ["--successor", "9249"],
    "--when": ["--when", "13 Sep 05:4x local"],
  },
  "supervisor state-check": {
    "--json": ["--json"],
    "--path": ["--path", "/s.md"],
  },
  "supervisor state-fold": {
    "--archive": ["--archive", "state-9249-fold-1.md"],
    "--description": ["--description", "ticks to 14:00"],
    "--doc": ["--doc", "/s.md"],
    "--handoff": ["--handoff", "9249"],
    "--json": ["--json"],
    "--keep": ["--keep", "10"],
    "--when": ["--when", "13 Sep 14:0x local"],
  },
  "supervisor owner-turns": {
    "--bytes": ["--bytes", "61440"],
    "--check": ["--check"],
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-15T00:00:00.000Z"],
    "--session": ["--session", "a0000075-0000-4000-8000-000000000082"],
  },
  "supervisor owner-turn-record": {
    "--file": ["--file", "/tmp/home/handovers/archive/owner-turn-1-1.txt"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
  },
  "supervisor owner-turn-show": {
    "--all": ["--all"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--ref": ["--ref", "257-1"],
  },
  "supervisor successor-summary": {
    "--json": ["--json"],
    "--now": ["--now", "2026-09-15T00:00:00.000Z"],
    "--out": ["--out", "/tmp/summary.md"],
    "--reconcile": ["--reconcile", "/tmp/reconcile.json"],
  },
  "supervisor scratch-carry": {
    "--dry-run": ["--dry-run"],
    "--from": ["--from", "/tmp/a"],
    "--json": ["--json"],
    "--to": ["--to", "/tmp/b"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "supervisor chain": ({ fragment }) => parseChainOptions({ rest: [...fragment] }),
  "supervisor intake": ({ fragment }) => parseIntakeOptions({ rest: [...fragment] }),
  "supervisor reoriented": ({ fragment }) => parseReorientedArgs({ rest: [...fragment] }),
  "supervisor intake-mark": ({ fragment }) =>
    parseIntakeMarkOptions({
      rest: dedupeFlags({
        base: [
          "--turn",
          "transcript:a0000013-0000-4000-8000-000000000014#0a335102-005d-4f3d-a2e3-cbbf3fd794c0",
          "--as",
          "card",
          "--witness",
          "x",
        ],
        fragment,
      }),
    }),
  // `--path` is required, so a fragment probing any OTHER flag has to carry it or every probe reports the
  // same missing-flag error instead of the one it was testing.
  "supervisor state-check": ({ fragment }) =>
    parseStateCheckOptions({ rest: dedupeFlags({ base: ["--path", "/s.md"], fragment }) }).mapErr((error) =>
      supervisorErrorLines({ error }),
    ),
  // Nothing is required, so every probe is the fragment alone.
  "supervisor owner-turns": ({ fragment }) => parseFlagTail({ rest: [...fragment], spec: OWNER_TURNS_FLAG_SPEC }),
  // --file and --ref are required by the shell, not the parser, so every probe is the fragment alone.
  "supervisor owner-turn-record": ({ fragment }) => parseOwnerTurnRecordArgs({ rest: [...fragment] }),
  "supervisor owner-turn-show": ({ fragment }) => parseOwnerTurnShowArgs({ rest: [...fragment] }),
  // --reconcile is required, so a fragment probing any OTHER flag carries it.
  "supervisor successor-summary": ({ fragment }) =>
    parseFlagTail({
      rest: dedupeFlags({ base: ["--reconcile", "/tmp/reconcile.json"], fragment }),
      spec: SUCCESSOR_SUMMARY_FLAG_SPEC,
    }),
  // Doc, seat and one row are required, so a fragment probing any OTHER flag carries them.
  "supervisor state-amend": ({ fragment }) =>
    parseStateAmendArgs({
      rest: dedupeFlags({ base: ["--doc", "/s.md", "--handoff", "9249", "--row", "x"], fragment }),
    }),
  // Every flag but --when and --json is required, so a probing fragment carries the rest.
  "supervisor state-archive": ({ fragment }) =>
    parseStateArchiveArgs({
      rest: dedupeFlags({
        base: [
          "--doc",
          "/s.md",
          "--predecessor",
          "9248",
          "--successor",
          "9249",
          "--archive",
          "state-9248.md",
          "--description",
          "the 9248 seat",
          "--block-file",
          "/tmp/block.md",
          "--successor-summary",
          "/tmp/summary.md",
        ],
        fragment,
      }),
    }),
  // Every flag but --when and --json is required, so a probing fragment carries the rest.
  "supervisor state-fold": ({ fragment }) =>
    parseStateFoldArgs({
      rest: dedupeFlags({
        base: [
          "--doc",
          "/s.md",
          "--handoff",
          "9249",
          "--keep",
          "10",
          "--archive",
          "state-9249-fold-1.md",
          "--description",
          "ticks to 14:00",
        ],
        fragment,
      }),
    }),
  "supervisor scratch-carry": ({ fragment }) =>
    parseScratchCarryArgs({ rest: dedupeFlags({ base: ["--from", "/tmp/a", "--to", "/tmp/b"], fragment }) }).mapErr(
      (error) => [error.message],
    ),
};

/** The rows for `supervisor`'s state, intake and owner-turn verbs. */
export const supervisorStateSlice: HelpTruthSlice = { guarded, probes, parsers };
