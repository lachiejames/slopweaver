/**
 * The help-truth tables' rows for `fresh-cut` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  FRESH_CUT_FLAG_NAMES,
  parseAcceptOptions,
  parseProduceOptions,
  parseVerifyOptions,
} from "../../../../cli/commands/freshCut/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** The flags every produce probe needs: a parse is pure, so nothing at these paths is ever read. */
const PRODUCE_BASE = ["--commit", "7adba73", "--out", "/tmp/fresh-cut-probe/cut"];

/** The flag every verify probe needs: a UUID, as `fresh-cut produce` prints one. */
const VERIFY_BASE = ["--record", "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f"];

/** The flags an owner-address accept probe needs: the class and a judgement, at a synthetic path and line. */
const ACCEPT_BASE = [
  ...VERIFY_BASE,
  "--path",
  "docs/example.md",
  "--line",
  "3",
  "--class",
  "owner-address",
  "--as",
  "placeholder",
];

/** An anchored accept probe: another class on a synthetic owner anchor, since `--anchor` refuses owner-address. */
const ANCHORED_BASE = [
  ...VERIFY_BASE,
  "--path",
  "docs/example.md",
  "--line",
  "3",
  "--class",
  "topic",
  "--anchor",
  "transcript:11111111-0000-4333-8444-555555555555#66666666-0000-4888-9999-aaaaaaaaaaaa",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "fresh-cut produce": FRESH_CUT_FLAG_NAMES.produce,
  "fresh-cut verify": FRESH_CUT_FLAG_NAMES.verify,
  "fresh-cut accept": FRESH_CUT_FLAG_NAMES.accept,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "fresh-cut accept": {
    "--anchor": ANCHORED_BASE,
    "--as": ACCEPT_BASE,
    "--class": ACCEPT_BASE,
    "--home": [...ACCEPT_BASE, "--home", "/tmp/fresh-cut-probe-home"],
    "--json": [...ACCEPT_BASE, "--json"],
    "--line": ACCEPT_BASE,
    "--path": ACCEPT_BASE,
    "--record": ACCEPT_BASE,
    "--source": [...ACCEPT_BASE, "--source", "/tmp/fresh-cut-probe/source"],
  },
  "fresh-cut produce": {
    "--commit": PRODUCE_BASE,
    "--home": [...PRODUCE_BASE, "--home", "/tmp/fresh-cut-probe-home"],
    "--json": [...PRODUCE_BASE, "--json"],
    "--out": PRODUCE_BASE,
    "--source": [...PRODUCE_BASE, "--source", "/tmp/fresh-cut-probe/source"],
  },
  "fresh-cut verify": {
    "--home": [...VERIFY_BASE, "--home", "/tmp/fresh-cut-probe-home"],
    "--json": [...VERIFY_BASE, "--json"],
    "--record": VERIFY_BASE,
    "--source": [...VERIFY_BASE, "--source", "/tmp/fresh-cut-probe/source"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "fresh-cut accept": ({ fragment }) => parseAcceptOptions({ rest: fragment }),
  "fresh-cut produce": ({ fragment }) => parseProduceOptions({ rest: fragment }),
  "fresh-cut verify": ({ fragment }) => parseVerifyOptions({ rest: fragment }),
};

/** The rows for `fresh-cut`. */
export const freshCutSlice: HelpTruthSlice = { guarded, probes, parsers };
