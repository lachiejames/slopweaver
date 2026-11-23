/**
 * The store rows: the nightly import that fills the store before the backup dumps it, and the monthly rehearsal
 * that proves the backup restores. Declared here and required through `./standingRows.ts`'s
 * `GENERIC_STANDING_ROWS`, like every other generic standing row.
 *
 * Both hang off the 03:00 nightly backup — one half an hour before it, one an hour after it on the 1st.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import type { StandingRow } from "./standingRow.js";
import { VERB_RUN_KIND } from "./verbRun.js";

/** The recipe id the monthly restore rehearsal carries — also the `run` its knowledge row names. */
export const REHEARSAL_RECIPE_ID = "store-restore-rehearsal-monthly";

/**
 * The monthly restore rehearsal — the newest store backup restored into a throwaway Postgres and proven
 * against the live store (`docs/store/restore-runbook.md`). A recipe on a cadence,
 * monthly by default, files its proof as a knowledge row and raises a card only when it fails.
 *
 * **A standing row, not a register verb**, because a rehearsal that quietly stopped running is exactly the
 * failure a rehearsal exists to prevent: a backup nobody has restored in months. Declared here, its absence is
 * a comparison `automation due` prints. A row that is present but stopped firing is `recipe-stopped`'s card; the
 * `store-rehearsal-failed` monitor cards only a run that happened and failed.
 *
 * **`0 4 1 * *`, `onMissed: "backfill"`.** 04:00 on the 1st, an hour after the 03:00 nightly backup it rehearses;
 * a machine that was off on the 1st rehearses when it next ticks rather than waiting a month.
 */
export const STORE_RESTORE_REHEARSAL: StandingRow = {
  definition: {
    cadence: "0 4 1 * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "backfill",
    params: { argv: ["store", "rehearse"] },
    recipeId: REHEARSAL_RECIPE_ID,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else restores a store backup to prove it works, so without this row the nightly backup is only " +
    "ever known to have uploaded — never to restore",
};

/**
 * The nightly fleet import — every file-backed register projected into the store half an hour before the 03:00
 * backup dumps it, so a restore on another machine gets back last night's board, journals and boot files rather
 * than whatever somebody last imported by hand (`docs/store/new-machine.md`). A supervisor that can launch the
 * bot and have things running just the way the owner wants is one command away on a different computer.
 *
 * **`30 2 * * *`, `onMissed: "backfill"`.** A machine asleep at 02:30 imports when it next ticks, which is still
 * before the backup that row also backfills. MEASURED: every leg's dry run took 35 s over 17,945
 * authored files and 210,635 door lines (repro: `time slopweaver store import-fleet --dry-run`). Every leg is
 * re-runnable, so a night that imports nothing new writes nothing.
 */
export const STORE_IMPORT_FLEET_NIGHTLY: StandingRow = {
  definition: {
    cadence: "30 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "backfill",
    params: { argv: ["store", "import-fleet"] },
    recipeId: "store-import-fleet-nightly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else projects the board, the run journals and the authored files into the store before the nightly " +
    "backup, so without this row a restore on another machine brings back only what was last imported by hand",
};
