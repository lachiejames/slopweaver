/**
 * What still lives only under `$SLOPWEAVER_HOME`, and what has made it into the store. Pure — the shell
 * measures the files and asks the database for its row counts.
 *
 * The question it answers: how much is not yet in the store and still sits in the home.
 *
 * ## Three things this module refuses to do, each because it would produce a confident wrong number
 *
 * **It never walks the home.** MEASURED: `du -sk ~/.slopweaver` did not finish inside 120
 * seconds and reports 83,469,916 KB. Reproduce with `time du -sk ~/.slopweaver`. A verb behind a page tile
 * has a 90-second budget, so a recursive answer is one that times out; every register below names ONE path
 * and is measured at that path only.
 *
 * **It never reports a total-home share, and it never sizes what it cannot size.** Two separate axes, and
 * keeping them separate is the whole point of the declaration below. {@link HomeRegister.tier} splits the
 * DENOMINATOR: `supervisor-scratch` is a scratch tier, and a percentage counting it would report this migration as permanently a third done when the
 * durable share is nearly the opposite. It has ONE durable carve-out, its `owner-turn-*.txt` files — the owner's
 * words verbatim, which no backup held — declared as their own `owner turns`
 * register and imported into `owner_turn` by `store import-fleet --only owner-turns`. {@link HomeRegister.measure} is about COST, not importance. MEASURED
 * (repro: `time du -sk ~/.slopweaver/orchestration ~/.slopweaver/supervisor-scratch`):
 * `orchestration` holds 875,802 files over 19.3 GB and takes **157.7 seconds** to walk, `supervisor-scratch`
 * holds 577,319 files over 37.4 GB and takes **57.7 seconds** — against about 1.1 seconds for the walked
 * registers below put together (count them: `grep -rh '^    measure: "walk"' src/store/homeRegisters/ | wc -l`, anchored so it does not count this sentence). So their
 * sizes are reported ABSENT rather than as a zero a reader would take for a measurement — while
 * `orchestration` stays durable and stays mirrored, because the `codex` import leg really does read it.
 *
 * **It never implies the register list is complete.** It is a declaration, so it cannot be; the shell
 * counts the home's top-level entries that no register claims and the report carries that residue as a
 * field. A bounded list that does not say it is bounded reads as a total, which is the failure this whole
 * page is written against.
 *
 * ## The mapping is declared BECAUSE it cannot be derived, and made total where it can be
 *
 * No walk of either side can say that `ledgers/door.jsonl` is what becomes `door_event`; only the projection
 * in `src/store/fleet/doorEvent.ts` knows. What CAN be made structural is the other direction:
 * {@link tableOrigin} is total over `declaredTableNames()`, and
 * `src/__tests__/unit/store/homeShare.test.ts` fails when a table is added to the drizzle barrel with no
 * origin declared here. A new table therefore cannot drift into existence unclassified.
 */

import { type DataClassCensus, dataClassCensus } from "./dataClassCensus.js";
import { HOME_REGISTERS, type HomeTier } from "./homeRegisters.js";

/** Where a declared store table's rows come from. */
export type TableOrigin =
  /** Projected from a home register by an import leg — `store import-fleet` or `store import-atlas`. */
  | "home-register"
  /** Written by corpus ingest from a provider. */
  | "corpus-ingest"
  /** Derived inside the store from other tables. */
  | "derived";

/**
 * Tables written by corpus ingest rather than by an import leg.
 *
 * Named here rather than inferred from a prefix, because `content_slack` and `container` share no naming
 * convention and a prefix rule would misfile the next table somebody adds.
 */
const CORPUS_INGEST_TABLES: ReadonlySet<string> = new Set([
  "container",
  "content",
  "content_github",
  "content_linear",
  "content_notion",
  "content_slack",
  "person",
]);

/**
 * Tables an import leg writes as CHILDREN of a register's own table rather than as the register itself.
 *
 * `store import-fleet`'s `runs` leg projects one journal into one `run` row and its `run_event` children
 * (`src/store/fleet/runJournal.ts`), so no register names `run_event` and it is still imported. Without this
 * set it reported as unclassified, which is exactly the signal {@link tableOrigin}'s totality is for — the
 * verb found this itself on its first run, and found the four atlas rows the same way when they landed.
 *
 * `store import-atlas` writes all five `atlas_*` tables from one pass over `~/.slopweaver/atlas`
 * (`src/store/atlas/store.ts`): the register names `atlas_entity`, and every other table carries the same
 * `(platform, kind)`. Three are replaced by that key directly and `atlas_entity_channel` cascades off its
 * entity row (`onDelete("cascade")`, `src/store/schema/atlas.ts`). See the writes: `grep -n 'insert(atlas'
 * src/store/atlas/store.ts`.
 *
 * The `owner-turns` leg writes one `owner_turn` body per distinct content and one `owner_turn_location` row
 * per file it was found at (`src/store/fleet/ownerTurnStore.ts`); the register names the body table.
 *
 * The `authored` leg is the same pair the other way round: one `authored_file` row per (path, content) and one
 * `authored_body` per distinct content (`src/store/fleet/authoredStore.ts`), and `authored_absent` for the stored
 * paths its last whole-home walk did not find. The register names the location table, because a path is what a
 * reader looks one up by.
 *
 * The `measurements` leg is the same shape the other way round: its four registers each name
 * `measurement_location`, filtered to their class, and `measurement_blob` holds the bodies they share
 * (`src/store/fleet/measurementStore.ts`).
 *
 * The fleet's two journal registers each name `fleet_journal_event`, filtered to their journal, and `fleet_journal`
 * holds each journal's head — the import marker and the append counter (`src/store/schema/fleet.ts`).
 *
 * The owner-judgement import writes one `judgement/owner-directives.json` into two tables
 * (`src/judgement/ownerDirectiveRows.ts`): the register names `owner_directive`, and `owner_correction` holds the
 * same file's corrections. Neither is derived — both start from that file, then take the memory hook's writes.
 *
 * The standing-ask import writes one `judgement/standing-asks.jsonl` into three tables
 * (`src/profile/standingAskRows.ts`): the register names `standing_ask`, and `standing_ask_coverage` and
 * `standing_ask_event` hold the same journal's covers and its exact lines. All three start from that file, then
 * take `profile standing`'s writes.
 */
const REGISTER_CHILD_TABLES: ReadonlySet<string> = new Set([
  "atlas_coverage",
  "atlas_entity_channel",
  "atlas_gap",
  "atlas_kind_status",
  "authored_absent",
  "authored_body",
  "fleet_journal",
  "measurement_blob",
  "owner_correction",
  "owner_turn_location",
  "run_event",
  "standing_ask_coverage",
  "standing_ask_event",
]);

/**
 * Tables the store derives from its own rows, or a verb writes straight into, rather than importing: no home file
 * stands behind any of them. `organisation` is the second kind, written only by `slopweaver org set`, and so is
 * `spend_merchant`, written only by `slopweaver spend merchants set`; `codex_fleet_cap` is filed by every Codex
 * fleet read (`src/codex/fleetCapPort.ts`) and never imported from a file. `codex_fallback_request` and
 * `codex_fallback_receipt` are written by `codex plan-fallback` and `codex review-fallback`
 * (`src/codex/fallbackPort.ts`) — a legacy `codex-fallback/` directory is imported once and then removable, so it
 * is no register this page measures. `grant_row` is the same: `grant record`, `perform` and `refuse` write it
 * (`src/grants/port.ts`), and a legacy `grants/journal.jsonl` is imported once. `autonomy_event` too: every
 * autonomy act and steer is written through `src/autonomy/port.ts`, and a legacy `ledgers/autonomy.jsonl` is
 * imported once, `autonomy_register` recording that it was. `door_event` and `door_register` are the same shape:
 * `throughDoor` writes every decision through `src/admit/doorLedgerPort.ts`, and a legacy `ledgers/door.jsonl` is
 * imported once. `home_file_import` is derived too: the one-time
 * import's own markers (`./registerImport.ts`), recording that a register's file was read, never a record of it.
 * The six `store_import_*` tables are written only by `store import --approve`, `store import-resolve` and an
 * apply: a staged export, the owner's answers to it and the receipt of its application, never a file under the home.
 * The six `workstream*` tables are written only through `src/workstreams/store/port.ts` (workstreams are rows,
 * not files), with no file imported at all — the retired `register.json` held nothing.
 * `owner_capture` is imported, but from OUTSIDE the home — a speech-to-text folder and `~/.codex`, read by the
 * `dictations` and `codex-messages` legs (`src/store/fleet/captureSources.ts`) — so no home register stands behind
 * it either. The five `published_page*` tables are written by a publish and by `store pages-import` carrying the old
 * folders in once (`docs/store/published-pages.md`): a page's home is the store, so no home register stands behind them.
 */
const DERIVED_TABLES: ReadonlySet<string> = new Set([
  "autonomy_event",
  "autonomy_register",
  "codex_fallback_receipt",
  "codex_fallback_request",
  "codex_fleet_cap",
  "door_event",
  "door_register",
  "grant_row",
  "home_file_import",
  "memories",
  "memory_recalls",
  "organisation",
  "owner_capture",
  "owner_profile",
  "owner_voice_register",
  "person_link_candidate",
  "published_page",
  "published_page_alias",
  "published_page_blob",
  "published_page_file",
  "published_page_version",
  "spend_merchant",
  "store_import_application",
  "store_import_batch",
  "store_import_item",
  "store_import_part",
  "store_import_question",
  "store_import_resolution",
  "workstream",
  "workstream_entry",
  "workstream_link",
  "workstream_milestone",
  "workstream_milestone_after",
  "workstream_register_meta",
]);

/**
 * Where one declared table's rows come from.
 *
 * TOTAL over `declaredTableNames()`, and `src/__tests__/unit/store/homeShare.test.ts` is what holds that
 * true: a table added to the drizzle barrel with no classification here fails that test rather than
 * appearing on the page as an unexplained row. A table this function cannot place is reported as
 * `undefined` rather than guessed into a bucket.
 *
 * @param table the Postgres table name, as `declaredTableNames()` gives it
 * @returns which family it belongs to, or `undefined` when nothing here classifies it
 */
export function tableOrigin({ table }: { table: string }): TableOrigin | undefined {
  if (CORPUS_INGEST_TABLES.has(table)) {
    return "corpus-ingest";
  }
  if (DERIVED_TABLES.has(table)) {
    return "derived";
  }
  const mirrored = HOME_REGISTERS.some((register) => register.table === table);
  if (mirrored || REGISTER_CHILD_TABLES.has(table)) {
    return "home-register";
  }
  return undefined;
}

/** One register, measured on both sides. */
export interface RegisterShare {
  readonly kind: string;
  readonly relativePath: string;
  /** The absolute path measured, so the figure names the thing a reader can `ls`. */
  readonly path: string;
  readonly tier: HomeTier;
  /** Bytes on disk, measured at its own path only; absent on a `declared-only` register. */
  readonly homeBytes: number | undefined;
  /** Records on disk: lines for a `jsonl`, files beneath a directory, one for a file; absent when unmeasured. */
  readonly homeRecords: number | undefined;
  /** Why no size was taken, when none was. */
  readonly unmeasuredBecause: string | undefined;
  /** Whether the path is there at all. A register a home has never written is a fact, not a failure. */
  readonly present: boolean;
  /** The store table it mirrors into, absent when nothing does. */
  readonly table: string | undefined;
  /**
   * That table's live row count, absent when the register is unmirrored, the store holds no such table, or the store
   * could not be read.
   */
  readonly storeRows: number | undefined;
  /** Why the store could not be read for that count, when it could not; a table the store does not hold is no failure. */
  readonly storeUnreadBecause: string | undefined;
  /** Why it is unmirrored, when it is. */
  readonly unmirroredBecause: string | undefined;
}

/** The home's top-level entries that no register claims — the stated boundary of this report. */
export interface HomeResidue {
  /** How many top-level entries exist under the home. */
  readonly topLevelEntries: number;
  /** How many of them no register names. */
  readonly unclassified: number;
  /** A sample of the unclassified names, so the residue is inspectable rather than just counted. */
  readonly sample: readonly string[];
}

/** The whole answer. */
export interface HomeShareReport {
  readonly registers: readonly RegisterShare[];
  /** Durable registers only: how many are mirrored into a table, and how many are not. */
  readonly durableMirrored: number;
  readonly durableUnmirrored: number;
  /** Bytes held by durable registers that nothing mirrors — the migration's actual remainder. */
  readonly durableUnmirroredBytes: number;
  /** The scratch tier's registers by kind, named rather than sized — see this module's second refusal. */
  readonly scratchRegisters: readonly string[];
  /** Declared tables this module could not classify — empty when the declaration is total. */
  readonly unclassifiedTables: readonly string[];
  /** Which tables, registers and home paths hold a data class, and why the rest do not (`./dataClassCensus.ts`). */
  readonly dataClassCensus: DataClassCensus;
  readonly residue: HomeResidue;
  readonly observedAtIso: string;
}

/**
 * Fold the measured registers into the report.
 *
 * @param registers every register, already measured on both sides
 * @param declaredTables every table name the drizzle barrel declares
 * @param residue the home's unclassified top-level entries
 * @param observedAtIso when the measurement was taken
 * @returns the report
 */
export function homeShare({
  registers,
  declaredTables,
  residue,
  observedAtIso,
}: {
  registers: readonly RegisterShare[];
  declaredTables: readonly string[];
  residue: HomeResidue;
  observedAtIso: string;
}): HomeShareReport {
  let durableMirrored = 0;
  let durableUnmirrored = 0;
  let durableUnmirroredBytes = 0;
  const scratchRegisters: string[] = [];
  for (const register of registers) {
    if (register.tier === "scratch") {
      scratchRegisters.push(register.kind);
      continue;
    }
    if (register.table === undefined) {
      durableUnmirrored += 1;
      if (register.homeBytes !== undefined) {
        durableUnmirroredBytes += register.homeBytes;
      }
      continue;
    }
    durableMirrored += 1;
  }
  return {
    dataClassCensus: dataClassCensus({ declaredTables, registers }),
    durableMirrored,
    durableUnmirrored,
    durableUnmirroredBytes,
    observedAtIso,
    registers,
    residue,
    scratchRegisters,
    unclassifiedTables: declaredTables.filter((table) => tableOrigin({ table }) === undefined).toSorted(),
  };
}
