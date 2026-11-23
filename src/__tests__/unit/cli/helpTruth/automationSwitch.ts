/**
 * The help-truth tables' rows for `automation enable` and `automation disable` — merged by `./allTables.ts` and swept
 * by `../helpTruth.test.ts`, whose header says what each table proves. Held apart from `./automationAndSweep.ts` so
 * that file stays under its file-size ceiling.
 */

import { recipeCommandErrorLines } from "../../../../cli/commands/automation/errors.js";
import { parseSwitchArgs } from "../../../../cli/commands/automation/switchArgs.js";
import { RECIPE_SWITCH_FLAG_NAMES } from "../../../../cli/commands/automation/switchUsage.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { PROBE_HOME } from "./sharedProbes.js";

/** A whole `automation enable`/`disable` invocation: the row and all three words. */
const SWITCH_ROW = ["publication-audit-daily", "--anchor", "talk:acme", "--words", "on", "--why", "asked"] as const;

/** Every probe of one switch direction carries the whole invocation, so each tests its own flag. */
const switchProbes = {
  "--anchor": [...SWITCH_ROW],
  "--dry-run": [...SWITCH_ROW, "--dry-run"],
  "--home": [...SWITCH_ROW, "--home", "/tmp"],
  "--why": [...SWITCH_ROW],
  "--words": [...SWITCH_ROW],
};

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "automation disable": RECIPE_SWITCH_FLAG_NAMES,
  "automation enable": RECIPE_SWITCH_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "automation disable": switchProbes,
  "automation enable": switchProbes,
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "automation disable": ({ fragment }) =>
    parseSwitchArgs({ defaultHome: PROBE_HOME, direction: "disable", rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation enable": ({ fragment }) =>
    parseSwitchArgs({ defaultHome: PROBE_HOME, direction: "enable", rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
};

/** The rows for `automation enable` and `automation disable`. */
export const automationSwitchSlice: HelpTruthSlice = { guarded, probes, parsers };
