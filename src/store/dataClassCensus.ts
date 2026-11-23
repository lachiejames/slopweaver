/**
 * The data-class census: every store table, every home register and every classified home path, each saying whether
 * it holds a data class or is unclassified, and why. Pure; `store share` prints it beside the migration share.
 *
 * The unit of classification is one stored record (`./dataClass.ts`), so only a TABLE can be `row-classified`, and
 * only by carrying a `data_class` column. A home path or a register is never classified: its files are a place, and
 * a place lends its class to nothing in it. Each of those is `unclassified` with the reason that applies, and a
 * register whose records reach a row-classified table names that table, because the copy in the store is where a
 * class can live.
 *
 * **Unclassified fails closed.** A consumer asking this census about a table with no class column gets
 * `unclassified`, and treats every row of it as `unknown`, which is `restricted` to every reader. Nothing here decides
 * a class for anything: who classifies, and with what, is the owner's open call, so this module only states what
 * holds a class column today.
 *
 * ## Tables are declared by NAME, and the declaration must stay total
 *
 * Every table sits in exactly one closed list below, and {@link tableDataClass} answers `undefined` for a name in
 * none of them rather than a generic "unclassified", so `src/__tests__/unit/store/dataClassCensus.test.ts` fails when
 * a table is added to the drizzle barrel with no decision here. The same test binds {@link ROW_CLASSIFIED_TABLES} to
 * the schema both ways: a listed table without the column, or a column on an unlisted table, is a failure.
 *
 * Home paths are the other way round, derived from `HOME_DIRECTORY_CLASSIFICATION`'s backup class
 * (`./fleet/authoredDirectories.ts`), because every one of them is unclassified for a reason that follows from that
 * class alone. A backup class is not a data class: it says whether a path is backed up or imported, never how far a
 * record may travel. A top-level entry with no backup-class row at all is the share report's residue, unclassified
 * twice over.
 */
import { HOME_DIRECTORY_CLASSIFICATION, type HomeDirectoryClassification } from "./fleet/authoredDirectories.js";
import type { HomeRegister } from "./homeRegisters.js";

/** What the census says about one table, register or home path. */
export type DataClassCensusEntry =
  /** Each row carries its own class in a `data_class` column. */
  | { readonly kind: "row-classified"; readonly column: "data_class" }
  /** Nothing here carries a class; a consumer treats it as `unknown`. */
  | { readonly kind: "unclassified"; readonly reason: string };

/** The tables whose rows each carry a `data_class` column: the intake records classified in this wave. */
export const ROW_CLASSIFIED_TABLES: readonly string[] = ["content", "owner_capture", "owner_turn"];

/** One closed group of unclassified tables, sharing one reason. */
interface UnclassifiedTableGroup {
  readonly reason: string;
  readonly tables: readonly string[];
}

/**
 * Every declared table with no class column, grouped by why. Each table is named exactly once across these groups
 * and {@link ROW_CLASSIFIED_TABLES}; the census test holds that.
 */
const UNCLASSIFIED_TABLE_GROUPS: readonly UnclassifiedTableGroup[] = [
  {
    reason: "source-specific columns of one content record; that record's class is the data_class on its content row",
    tables: ["content_github", "content_linear", "content_notion", "content_slack"],
  },
  {
    reason: "describes a place or a party, not a record anyone wrote; the unit of classification is one record",
    tables: ["container", "organisation", "person", "person_link_candidate"],
  },
  {
    reason: "a staged export awaiting the owner's approval; the content rows it applies into are where a class lives",
    tables: [
      "store_import_application",
      "store_import_batch",
      "store_import_item",
      "store_import_part",
      "store_import_question",
      "store_import_resolution",
    ],
  },
  {
    reason: "an integration's own settings and entities as the atlas measured them, with no class column yet",
    tables: ["atlas_coverage", "atlas_entity", "atlas_entity_channel", "atlas_gap", "atlas_kind_status"],
  },
  {
    reason:
      "the owner's or the fleet's own records (rulings, memories, pages, board rows, run journals), with no class column yet",
    tables: [
      "authored_body",
      "authored_file",
      "autonomy_event",
      "board_row",
      "codex_fallback_receipt",
      "codex_fallback_request",
      "codex_pass",
      "door_event",
      "fleet_journal_event",
      "grant_row",
      "knowledge_domain",
      "measurement_blob",
      "measurement_location",
      "memories",
      "memory_recalls",
      "org_health_acknowledgement",
      "org_health_incident",
      "org_health_sighting",
      "owner_correction",
      "owner_directive",
      "owner_profile",
      "owner_voice_register",
      "published_page",
      "published_page_alias",
      "published_page_blob",
      "published_page_file",
      "published_page_version",
      "run",
      "run_event",
      "standing_ask",
      "standing_ask_coverage",
      "standing_ask_event",
      "steer_measurement",
      "workstream",
      "workstream_entry",
      "workstream_link",
      "workstream_milestone",
      "workstream_milestone_after",
    ],
  },
  {
    reason: "operational state (a cursor, counter, cap, marker or config row), not a record a person wrote",
    tables: [
      "authored_absent",
      "autonomy_register",
      "cmux_event_state",
      "codex_fleet_cap",
      "codex_sign_in_observation",
      "codex_supersession",
      "door_register",
      "fleet_config",
      "fleet_journal",
      "home_file_import",
      "landing_press",
      "landing_read_cursor",
      "owner_turn_location",
      "plan_register",
      "singleton_register",
      "spend_merchant",
      "workstream_register_meta",
    ],
  },
];

/**
 * What the census says about one declared table.
 *
 * @param table the Postgres table name, as `declaredTableNames()` gives it
 * @returns its entry, or `undefined` when no list here names it, which the census test refuses
 */
export function tableDataClass({ table }: { table: string }): DataClassCensusEntry | undefined {
  if (ROW_CLASSIFIED_TABLES.includes(table)) {
    return { column: "data_class", kind: "row-classified" };
  }
  const group = UNCLASSIFIED_TABLE_GROUPS.find((one) => one.tables.includes(table));
  if (group === undefined) {
    return undefined;
  }
  return { kind: "unclassified", reason: group.reason };
}

/**
 * Every table some list here names, for the census test's both-ways check.
 *
 * @returns each named table once, row-classified first
 */
export function censusTableNames(): readonly string[] {
  return [...ROW_CLASSIFIED_TABLES, ...UNCLASSIFIED_TABLE_GROUPS.flatMap((group) => group.tables)];
}

/**
 * What the census says about one home register: always unclassified, since a register is a place.
 *
 * @param register the register, as `HOME_REGISTERS` declares it
 * @returns its entry, naming the row-classified table its records reach when there is one
 */
export function registerDataClass({ register }: { register: Pick<HomeRegister, "table"> }): DataClassCensusEntry {
  if (register.table !== undefined && ROW_CLASSIFIED_TABLES.includes(register.table)) {
    return {
      kind: "unclassified",
      reason: `its files carry no class; their copies in ${register.table} are classified one row at a time`,
    };
  }
  return { kind: "unclassified", reason: "a register is a place, never a record, and no table it reaches has a class" };
}

/**
 * What the census says about one classified home path, from its backup class.
 *
 * @param row the path's row in `HOME_DIRECTORY_CLASSIFICATION`
 * @returns its entry: unclassified, for the reason its backup class gives
 */
export function homePathDataClass({ row }: { row: HomeDirectoryClassification }): DataClassCensusEntry {
  switch (row.directoryClass) {
    case "authored":
      return {
        kind: "unclassified",
        reason: "the fleet's authored files; a path is a place and its files carry no class",
      };
    case "scratch":
      return { kind: "unclassified", reason: "scratch working files, never imported, so never given a class" };
    case "credential":
      return { kind: "unclassified", reason: "token material: never imported and never read as data" };
    case "other-class":
      return {
        kind: "unclassified",
        reason: "another import owns it; its records take a class only in a row-classified table",
      };
    case "split":
      return { kind: "unclassified", reason: "no class of its own; each entry below it has its own row" };
    default: {
      const unreachable: never = row.directoryClass;
      return unreachable;
    }
  }
}

/**
 * One named thing and what the census says about it.
 *
 * @internal — the row shape of {@link DataClassCensus}; a reader takes the census whole.
 */
export interface DataClassCensusRow {
  readonly name: string;
  readonly entry: DataClassCensusEntry | undefined;
}

/** The whole census, as `store share --json` prints it. */
export interface DataClassCensus {
  readonly tables: readonly DataClassCensusRow[];
  readonly registers: readonly DataClassCensusRow[];
  readonly homePaths: readonly DataClassCensusRow[];
  /** Declared tables no list here names — empty when the declaration is total. */
  readonly undeclaredTables: readonly string[];
}

/**
 * Take the census over the declared tables, the home registers and every classified home path.
 *
 * @param declaredTables every table name the drizzle barrel declares
 * @param registers every home register
 * @returns one row per table, register and home path, and the tables no list names
 */
export function dataClassCensus({
  declaredTables,
  registers,
}: {
  declaredTables: readonly string[];
  registers: readonly Pick<HomeRegister, "kind" | "table">[];
}): DataClassCensus {
  const tables = declaredTables.map((table) => ({ entry: tableDataClass({ table }), name: table }));
  return {
    homePaths: HOME_DIRECTORY_CLASSIFICATION.map((row) => ({
      entry: homePathDataClass({ row }),
      name: row.prefix ? `${row.name}*` : row.name,
    })),
    registers: registers.map((register) => ({ entry: registerDataClass({ register }), name: register.kind })),
    tables,
    undeclaredTables: tables.filter((row) => row.entry === undefined).map((row) => row.name),
  };
}
