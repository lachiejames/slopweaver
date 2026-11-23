/**
 * `automation enable` and `automation disable`, spread into `automationManifest` in `./automation.ts` and held apart so
 * that file stays under its file-size ceiling. Each writes ONE definition's `enabled` under the definition hold lock and
 * journals who asked, all under the home, so `local-state` with no door.
 */
import { RECIPE_DISABLE_USAGE, RECIPE_ENABLE_USAGE } from "../commands/automation/switchUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const automationSwitchManifest: Readonly<Record<string, VerbManifestEntry>> = {
  disable: lazy({
    load: () => import("../commands/automation/switch.js").then((m) => m.recipeDisableCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver automation disable publication-audit-daily --anchor talk:<id> --words "<their words>" --why "<why>"',
      parseRejectIsIoFree: true,
      summary:
        "Turn ONE automation off on the owner's anchored words: writes only the row's `enabled` under the definition " +
        "hold lock, prints the change first, and journals who asked in `live/recipe/switches.jsonl`, so `automation " +
        "due` reads it OFF · disabled. `--dry-run` prints the change and writes nothing",
      usage: RECIPE_DISABLE_USAGE,
    },
  }),
  enable: lazy({
    load: () => import("../commands/automation/switch.js").then((m) => m.recipeEnableCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver automation enable publication-audit-daily --anchor talk:<id> --words "<their words>" --why "<why>"',
      parseRejectIsIoFree: true,
      summary:
        "Turn ONE automation on on the owner's anchored words: writes only the row's `enabled` under the definition " +
        "hold lock, prints the change first, and journals who asked in `live/recipe/switches.jsonl`, so `automation " +
        "due` reads it on its cadence. Refused on a held row, whose hold outranks `enabled`. `--dry-run` writes nothing",
      usage: RECIPE_ENABLE_USAGE,
    },
  }),
};
