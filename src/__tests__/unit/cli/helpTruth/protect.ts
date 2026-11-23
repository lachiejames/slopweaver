/**
 * The help-truth tables' rows for `protect` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { PROTECT_FLAG_NAMES, parseProtectArgs } from "../../../../cli/commands/protect/run.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** The path every probe names — a parse is pure, so nothing at it is ever read. */
const PROBE_PATH = "/tmp/protect-probe/notes";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "protect add": PROTECT_FLAG_NAMES.add,
  "protect check": PROTECT_FLAG_NAMES.check,
  "protect list": PROTECT_FLAG_NAMES.list,
  "protect remove": PROTECT_FLAG_NAMES.remove,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "protect add": {
    "--home": [PROBE_PATH, "--mode", "read-only", "--why", "drafts", "--home", "/tmp/protect-probe-home"],
    "--mode": [PROBE_PATH, "--mode", "no-access", "--why", "drafts"],
    "--why": [PROBE_PATH, "--mode", "read-only", "--why", "drafts"],
  },
  "protect check": {
    "--home": [PROBE_PATH, "--home", "/tmp/protect-probe-home"],
    "--write": [PROBE_PATH, "--write"],
  },
  "protect list": {
    "--home": ["--home", "/tmp/protect-probe-home"],
    "--json": ["--json"],
  },
  "protect remove": {
    "--home": [PROBE_PATH, "--home", "/tmp/protect-probe-home"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "protect add": ({ fragment }) => parseProtectArgs({ rest: fragment }),
  "protect check": ({ fragment }) => parseProtectArgs({ rest: fragment }),
  "protect list": ({ fragment }) => parseProtectArgs({ rest: fragment }),
  "protect remove": ({ fragment }) => parseProtectArgs({ rest: fragment }),
};

/** The rows for `protect`. */
export const protectSlice: HelpTruthSlice = { guarded, probes, parsers };
