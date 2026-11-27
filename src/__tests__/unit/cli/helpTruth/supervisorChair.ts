/**
 * The help-truth tables' rows for `supervisor`'s chair verbs, `chair-watch` and `hand-off` — merged by `./allTables.ts`
 * and swept by `../helpTruth.test.ts`, whose header says what each table proves.
 */

import {
  CHAIR_HAND_OFF_FLAG_NAMES,
  parseChairHandOffArgs,
} from "../../../../cli/commands/supervisor/chairHandOffArgs.js";
import { CHAIR_WATCH_FLAG_SPEC, parseChairWatchOptions } from "../../../../cli/commands/supervisor/chairWatchRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** `supervisor chair-watch`'s advertised flags, derived from the spec the verb parses with. */
const CHAIR_WATCH_FLAG_NAMES: readonly string[] = [
  ...CHAIR_WATCH_FLAG_SPEC.value.map((name) => `--${name}`),
  ...CHAIR_WATCH_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** The two flags only `hand-off note` takes, which route a probe to that form. */
const NOTE_ONLY_FLAGS: ReadonlySet<string> = new Set(["--episode", "--file"]);

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "supervisor chair-watch": CHAIR_WATCH_FLAG_NAMES,
  "supervisor hand-off": CHAIR_HAND_OFF_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "supervisor chair-watch": {
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
  },
  // `--now` and `--reason` are only valid together or beside `--plan`, so each probe carries its partner.
  "supervisor hand-off": {
    "--episode": ["--episode", "ep-1"],
    "--file": ["--file", "/tmp/note.md"],
    "--home": ["--home", "/tmp/home"],
    "--note-wait": ["--note-wait", "30"],
    "--now": ["--now", "--reason", "the chair is stuck"],
    "--plan": ["--plan", "plan-four"],
    "--reason": ["--plan", "plan-four", "--reason", "plan-one is drifting"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "supervisor chair-watch": ({ fragment }) => parseChairWatchOptions({ rest: [...fragment] }),
  // A probe of a `note` flag goes through the `note` form, which needs both its flags; any other probe is the run.
  "supervisor hand-off": ({ fragment }) => {
    const probesNote = fragment.some((part) => NOTE_ONLY_FLAGS.has(part));
    if (probesNote) {
      return parseChairHandOffArgs({
        rest: ["note", ...dedupeFlags({ base: ["--episode", "ep-1", "--file", "/tmp/note.md"], fragment })],
      });
    }
    return parseChairHandOffArgs({ rest: [...fragment] });
  },
};

/** The rows for `supervisor`'s chair verbs. */
export const supervisorChairSlice: HelpTruthSlice = { guarded, parsers, probes };
