/**
 * The help-truth tables' rows for `store`'s projection imports — the atlas, the fleet's own registers and
 * captures, the keep's owner-turn dump and the published pages — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseImportAtlasArgs } from "../../../../cli/commands/store/importAtlasCore.js";
import { parseImportFleetArgs } from "../../../../cli/commands/store/importFleetArgs.js";
import { parseImportOwnerTurnDumpArgs } from "../../../../cli/commands/store/importOwnerTurnDumpArgs.js";
import { parsePagesImportArgs } from "../../../../cli/commands/store/pagesImportCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  // The fleet projection. A closed flag set off one pure parser in
  // `src/cli/commands/store/importFleetArgs.ts`; `--only` repeats, which the parser validates against the
  // leg list rather than accepting any word.
  "store import-fleet": [
    "--only",
    "--dry-run",
    "--home",
    "--json",
    "--adopt-unmatched-door-lines",
    "--dictations",
    "--codex-home",
  ],
  // The atlas projection. A closed flag set off one pure parser in
  // `src/cli/commands/store/importAtlasCore.ts`; `--platform` is validated against the registry by the
  // PLAN rather than by the parser, so an unknown one is an empty plan and a named refusal, not a throw.
  "store import-atlas": ["--platform", "--force", "--dry-run", "--home", "--json"],
  // The keep restore. A closed flag set off `src/cli/commands/store/importOwnerTurnDumpArgs.ts`.
  "store import-owner-turn-dump": ["--from", "--dry-run", "--home", "--json"],
  // The published-pages import. A closed flag set off `src/cli/commands/store/pagesImportCore.ts`.
  "store pages-import": ["--dry-run", "--home", "--json"],
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "store import-atlas": {
    "--dry-run": ["--dry-run"],
    "--force": ["--force"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--platform": ["--platform", "vanta"],
  },
  "store import-fleet": {
    "--adopt-unmatched-door-lines": ["--adopt-unmatched-door-lines", "--only", "door"],
    "--codex-home": ["--codex-home", "/tmp"],
    "--dictations": ["--dictations", "/tmp"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--only": ["--only", "board"],
  },
  "store import-owner-turn-dump": {
    "--dry-run": ["--from", "/tmp/owner-tables.sql", "--dry-run"],
    "--from": ["--from", "/tmp/owner-tables.sql"],
    "--home": ["--from", "/tmp/owner-tables.sql", "--home", "/tmp"],
    "--json": ["--from", "/tmp/owner-tables.sql", "--json"],
  },
  "store pages-import": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "store import-atlas": ({ fragment }) => parseImportAtlasArgs({ argv: [...fragment] }),
  "store import-fleet": ({ fragment }) => parseImportFleetArgs({ argv: [...fragment] }),
  "store import-owner-turn-dump": ({ fragment }) => parseImportOwnerTurnDumpArgs({ argv: [...fragment] }),
  "store pages-import": ({ fragment }) => parsePagesImportArgs({ argv: [...fragment] }),
};

/** The rows for `store`'s projection imports. */
export const storeProjectionsSlice: HelpTruthSlice = { guarded, probes, parsers };
