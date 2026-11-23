/**
 * The help-truth tables' rows for `ruling` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseRulingArgs, RULING_FLAG_SPECS } from "../../../../cli/commands/ruling/shared.js";
import { type FlagTailSpec } from "../../../../cli/optionParsers.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** A verb's accepted flags, spelled as a caller types them. */
function flagsOf({ spec: { value, boolean = [] } }: { spec: FlagTailSpec }): readonly string[] {
  return [...value, ...boolean].map((name) => `--${name}`);
}

/** The home every probe names — a parse is pure, so nothing under it is ever read. */
const PROBE_HOME = "/tmp/ruling-probe-home";

/** A record invocation's required flags, so each probe adds only the flag it exercises. */
const RECORD_BASE = ["--category", "landing", "--words", "no third pass", "--decided-on", "2026-01-05"];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "ruling list": flagsOf({ spec: RULING_FLAG_SPECS.list }),
  "ruling record": flagsOf({ spec: RULING_FLAG_SPECS.record }),
  "ruling seed": flagsOf({ spec: RULING_FLAG_SPECS.seed }),
  "ruling view": flagsOf({ spec: RULING_FLAG_SPECS.view }),
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "ruling list": {
    "--all": ["--all"],
    "--category": ["--category", "landing"],
    "--home": ["--home", PROBE_HOME],
    "--json": ["--json"],
  },
  "ruling record": {
    "--alongside": [...RECORD_BASE, "--alongside"],
    "--anchor": [...RECORD_BASE, "--anchor", "talk:00000000-0000-4000-8000-000000000000"],
    "--category": RECORD_BASE,
    "--context": [...RECORD_BASE, "--context", "on page acme-briefing, call one"],
    "--decided-on": RECORD_BASE,
    "--home": [...RECORD_BASE, "--home", PROBE_HOME],
    "--json": [...RECORD_BASE, "--json"],
    "--new-category": [...RECORD_BASE, "--new-category"],
    "--replaces": [...RECORD_BASE, "--replaces", "ruling-000000000000", "--replaces", "ruling-111111111111"],
    "--words": RECORD_BASE,
  },
  "ruling seed": {
    "--apply": ["--from", "/tmp/ruling-probe/state.md", "--decisions", "/tmp/ruling-probe/d.jsonl", "--apply"],
    "--decisions": ["--from", "/tmp/ruling-probe/state.md", "--decisions", "/tmp/ruling-probe/d.jsonl", "--apply"],
    "--from": ["--from", "/tmp/ruling-probe/state.md", "--from", "/tmp/ruling-probe/archive.md", "--plan"],
    "--home": ["--from", "/tmp/ruling-probe/state.md", "--plan", "--home", PROBE_HOME],
    "--plan": ["--from", "/tmp/ruling-probe/state.md", "--plan"],
  },
  "ruling view": {
    "--home": ["--home", PROBE_HOME],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "ruling list": ({ fragment }) => parseRulingArgs({ rest: fragment, verb: "list" }),
  "ruling record": ({ fragment }) => parseRulingArgs({ rest: fragment, verb: "record" }),
  "ruling seed": ({ fragment }) => parseRulingArgs({ rest: fragment, verb: "seed" }),
  "ruling view": ({ fragment }) => parseRulingArgs({ rest: fragment, verb: "view" }),
};

/** The rows for `ruling`. */
export const rulingSlice: HelpTruthSlice = { guarded, probes, parsers };
