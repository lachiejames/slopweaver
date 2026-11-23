/**
 * The store-backed fleet: the `fleet_config` row and the two journals in `fleet_journal_event` are the authority,
 * each imported ONCE from its legacy file under `$SLOPWEAVER_HOME/fleet/`, and never read from a file again.
 *
 * This module is the ORCHESTRATION and nothing else — the shape `../plans/storePort.ts` established. Every effect
 * arrives through {@link FleetStoreSeams}, so a unit test drives every branch over a plain in-memory fake
 * (`src/__tests__/fleetStoreFixture.ts`; a seam, not a mock). The Postgres half is `./storeRows.ts`; what only a
 * real database can prove — the CHECKs, the transactional import and the append counter — is the opt-in
 * `src/__tests__/integration/fleetStore.test.ts`.
 *
 * ## A store outage is a refusal, never a file
 *
 * No selection, a stale database, an unreachable one, a failed statement: every one is `STORE_UNAVAILABLE`, and NONE
 * of them falls back to the legacy files. A file that stopped being the authority is how a capacity line or a
 * recovery verdict becomes confidently wrong.
 *
 * ## The one-time imports
 *
 * The configuration follows the plan register: a read finding no row consults `config.json`, and only then. A valid
 * file is inserted at revision 1 with `ON CONFLICT DO NOTHING` and the row read back, so a concurrent importer's row
 * wins; a damaged one is refused. Unlike a plan, whose absent row stands for a picture still being derived, an absent
 * file imports the fixed default as the row, so the import is done once and a file appearing later is never read. A WRITE
 * finding no row inserts its own configuration and never consults the file — that write is what supersedes it, which
 * is also how `fleet configure` repairs a damaged one.
 *
 * A journal is imported by its HEAD row (`fleet_journal`): every read and append first makes sure the head exists,
 * and the importer whose head insert lands writes every legacy line in the same transaction. Absent and empty files
 * leave a head too, so "considered" is a committed fact rather than an inference from an empty table. A line that
 * would not decode is a placeholder with its line number and never its text.
 *
 * ## Compare-and-set, never a retry
 *
 * A configuration write reads revision N and updates `WHERE revision = N`. No row back is `CONFIG_CONFLICT`, and
 * nothing replays the write: deciding again against a configuration that moved is the caller's judgement.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxReviveEvent, CmuxReviveRead } from "../cmux/reviveJournal.js";
import { cmuxReviveJournalOfValues } from "../cmux/reviveJournal.js";
import type { FleetJournalImportSource, FleetJournalName } from "../store/schema/fleet.js";
import { type FleetConfig, parseFleetConfig } from "./config.js";
import { type FleetError, FleetErrors, type FleetStoreUnavailableError } from "./errors.js";
import { type FleetJournalEvent, type FleetJournalRead, fleetJournalOfValues } from "./journal.js";
import { FLEET_JOURNAL_KEPT_KINDS, FLEET_JOURNAL_KEPT_ROWS, FLEET_JOURNAL_TAIL_ROWS } from "./journalTail.js";
import type { FleetPort } from "./port.js";

/** The stored configuration as the store returned it, with the revision a compare-and-set pins to. */
export interface StoredFleetConfig {
  readonly capacity: number;
  readonly revision: number;
  readonly schemaVersion: number;
}

/** One legacy journal line, ready to store: its decoded event, or `null` when it would not decode. */
export interface FleetJournalImportEntry {
  readonly event: FleetJournalEvent | CmuxReviveEvent | null;
  readonly line: number;
}

/** What the one-time import of one legacy journal found. */
export interface FleetJournalImport {
  readonly entries: readonly FleetJournalImportEntry[];
  readonly source: FleetJournalImportSource;
}

/**
 * The row operations one open connection offers, and the handle that closes it. A store step's only failure is
 * `STORE_UNAVAILABLE`, typed so: no seam can make a failed statement read as anything else.
 */
export interface FleetRows {
  /** The singleton configuration row, or undefined when the store holds none. */
  readonly readConfig: () => Promise<Result<StoredFleetConfig | undefined, FleetStoreUnavailableError>>;
  /** Insert at revision 1 unless a row exists; undefined when one already did, which this writer then lost. */
  readonly insertConfig: (request: {
    readonly config: FleetConfig;
  }) => Promise<Result<StoredFleetConfig | undefined, FleetStoreUnavailableError>>;
  /** Update iff the row is still at `expectedRevision`, bumping it; undefined when it was not. */
  readonly updateConfig: (request: {
    readonly config: FleetConfig;
    readonly expectedRevision: number;
  }) => Promise<Result<StoredFleetConfig | undefined, FleetStoreUnavailableError>>;
  /** A journal's newest sequence, or undefined when its head does not exist yet — the journal was never imported. */
  readonly journalHead: (request: {
    readonly journal: FleetJournalName;
  }) => Promise<Result<number | undefined, FleetStoreUnavailableError>>;
  /** Insert the head and every legacy entry in ONE transaction, unless a head exists; a lost race imports nothing. */
  readonly importJournal: (request: {
    readonly imported: FleetJournalImport;
    readonly journal: FleetJournalName;
  }) => Promise<Result<undefined, FleetStoreUnavailableError>>;
  /** Bump the head and insert the event under the new sequence in ONE transaction; undefined when no head exists. */
  readonly append: (request: {
    readonly event: FleetJournalEvent | CmuxReviveEvent;
    readonly journal: FleetJournalName;
  }) => Promise<Result<number | undefined, FleetStoreUnavailableError>>;
  /**
   * The newest `limit` entries' events, preceded by, for each kind in `keptKinds`, the newest `keptLimit` OLDER
   * entries of that kind, all OLDEST first; `null` where an imported line would not decode.
   */
  readonly tail: (request: {
    readonly journal: FleetJournalName;
    readonly limit: number;
    readonly keptKinds: readonly string[];
    readonly keptLimit: number;
  }) => Promise<Result<readonly unknown[], FleetStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed fleet performs, injected so the orchestration is testable without a database. */
export interface FleetStoreSeams {
  /** Open the store for one home, refusing with `STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<FleetRows, FleetStoreUnavailableError>>;
  /** The legacy `config.json`: undefined when absent, the refusal when present and damaged. */
  readonly readConfigFile: (request: { readonly home: string }) => Result<FleetConfig | undefined, FleetError>;
  /** One legacy journal file, as the entries its import would store. */
  readonly readJournalFile: (request: {
    readonly home: string;
    readonly journal: FleetJournalName;
  }) => Result<FleetJournalImport, FleetError>;
}

/**
 * The store refusal for a seam that rejected rather than answering a Result.
 *
 * @param cause what the seam rejected with
 * @param doing what the step was for, finishing "the store could not …"
 * @returns the typed refusal
 */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): FleetStoreUnavailableError {
  return FleetErrors.storeUnavailable({ doing, reason: cause instanceof Error ? cause.message : "unknown failure" });
}

/**
 * Run one operation over a connection this function opens and always closes. A seam that rejects rather than
 * answering a Result is still a step that did not finish, so it is the same refusal.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams where the connection comes from
 * @param body what to do with it
 * @returns whatever the body answered, or the connection refusal
 */
async function withRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: FleetRows) => Promise<Result<T, FleetError>>;
  home: string;
  seams: FleetStoreSeams;
}): Promise<Result<T, FleetError>> {
  let rows: Result<FleetRows, FleetStoreUnavailableError>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, FleetError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ cause, doing: "finish the operation" }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(unavailable({ cause, doing: "close its connection" }));
  }
  return answer;
}

/**
 * Decode a stored configuration row.
 *
 * @param row the row as stored
 * @returns the configuration, or why the row is unusable
 */
function configOfRow({ row }: { row: StoredFleetConfig }): Result<FleetConfig, FleetError> {
  const parsed = parseFleetConfig({
    path: "the fleet_config row",
    value: { capacity: row.capacity, schemaVersion: row.schemaVersion },
  });
  if (parsed.isErr()) {
    return err(FleetErrors.storedInvalid({ why: parsed.error.message }));
  }
  return ok(parsed.value);
}

/**
 * The configuration as it stands: the stored row, else the one-time import of a legacy file or, with none, of the
 * default.
 *
 * @param home the Slopweaver home
 * @param rows the open connection's row operations
 * @param seams the legacy file read
 * @returns the configuration, or the refusal
 */
async function currentConfig({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: FleetRows;
  seams: FleetStoreSeams;
}): Promise<Result<FleetConfig, FleetError>> {
  const stored = await rows.readConfig();
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return configOfRow({ row: stored.value });
  }
  const file = seams.readConfigFile({ home });
  if (file.isErr()) {
    return err(file.error);
  }
  // An absent file imports the default, so the import is recorded as done and a file appearing later is never read.
  let imported = file.value;
  if (imported === undefined) {
    const defaulted = parseFleetConfig({ path: "the fleet_config row", value: undefined });
    if (defaulted.isErr()) {
      return err(defaulted.error);
    }
    imported = defaulted.value;
  }
  const inserted = await rows.insertConfig({ config: imported });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  // Re-read whether or not this insert won: a lost one means another importer's row is the configuration, and a won
  // one may already have been overtaken by a write, so the committed row answers either way.
  const winner = await rows.readConfig();
  if (winner.isErr()) {
    return err(winner.error);
  }
  if (winner.value === undefined) {
    return err(
      FleetErrors.storeUnavailable({
        doing: "import the fleet configuration",
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return configOfRow({ row: winner.value });
}

/**
 * Write one configuration: insert it when no row exists — superseding any legacy file unread — else compare-and-set
 * it against the revision just read.
 *
 * @param config the configuration to write
 * @param rows the open connection's row operations
 * @returns the committed configuration, or the conflict that stopped it
 */
async function writeConfigWith({
  config,
  rows,
}: {
  config: FleetConfig;
  rows: FleetRows;
}): Promise<Result<FleetConfig, FleetError>> {
  const stored = await rows.readConfig();
  if (stored.isErr()) {
    return err(stored.error);
  }
  // `0` names "expected no row at all" — the revision an inserting write pins to, since a real one starts at 1.
  let pinned = 0;
  let committed: Result<StoredFleetConfig | undefined, FleetStoreUnavailableError>;
  if (stored.value === undefined) {
    committed = await rows.insertConfig({ config });
  } else {
    pinned = stored.value.revision;
    committed = await rows.updateConfig({ config, expectedRevision: pinned });
  }
  if (committed.isErr()) {
    return err(committed.error);
  }
  if (committed.value === undefined) {
    return err(FleetErrors.configConflict({ expectedRevision: pinned }));
  }
  return configOfRow({ row: committed.value });
}

/**
 * Make sure a journal's head exists, importing its legacy file when it does not.
 *
 * @param home the Slopweaver home
 * @param journal which journal
 * @param rows the open connection's row operations
 * @param seams the legacy file read
 * @returns the journal's newest sequence once imported, or the refusal
 */
async function importedHead({
  home,
  journal,
  rows,
  seams,
}: {
  home: string;
  journal: FleetJournalName;
  rows: FleetRows;
  seams: FleetStoreSeams;
}): Promise<Result<number, FleetError>> {
  const head = await rows.journalHead({ journal });
  if (head.isErr()) {
    return err(head.error);
  }
  if (head.value !== undefined) {
    return ok(head.value);
  }
  const file = seams.readJournalFile({ home, journal });
  if (file.isErr()) {
    return err(file.error);
  }
  const imported = await rows.importJournal({ imported: file.value, journal });
  if (imported.isErr()) {
    return err(imported.error);
  }
  // Whoever won the import, its head is committed now: read the sequence it left.
  const after = await rows.journalHead({ journal });
  if (after.isErr()) {
    return err(after.error);
  }
  if (after.value === undefined) {
    return err(
      FleetErrors.storeUnavailable({
        doing: `import the ${journal} journal`,
        reason: "the import committed no head to read back",
      }),
    );
  }
  return ok(after.value);
}

/**
 * Append one event to a journal, importing it first when it never was.
 *
 * @param event the event
 * @param home the Slopweaver home
 * @param journal which journal
 * @param seams the effects
 * @returns the sequence the event was stored under, or the refusal
 */
async function appendTo({
  event,
  home,
  journal,
  seams,
}: {
  event: FleetJournalEvent | CmuxReviveEvent;
  home: string;
  journal: FleetJournalName;
  seams: FleetStoreSeams;
}): Promise<Result<number, FleetError>> {
  return withRows({
    body: async (rows) => {
      const head = await importedHead({ home, journal, rows, seams });
      if (head.isErr()) {
        return err(head.error);
      }
      const appended = await rows.append({ event, journal });
      if (appended.isErr()) {
        return err(appended.error);
      }
      if (appended.value === undefined) {
        return err(
          FleetErrors.storeUnavailable({ doing: `append to the ${journal} journal`, reason: "its head row is gone" }),
        );
      }
      return ok(appended.value);
    },
    home,
    seams,
  });
}

/**
 * A journal's newest entries' stored values, oldest first, importing it first when it never was.
 *
 * @param home the Slopweaver home
 * @param journal which journal
 * @param seams the effects
 * @returns the values, or the refusal
 */
async function tailOf({
  home,
  journal,
  seams,
}: {
  home: string;
  journal: FleetJournalName;
  seams: FleetStoreSeams;
}): Promise<Result<readonly unknown[], FleetError>> {
  return withRows({
    body: async (rows) => {
      const head = await importedHead({ home, journal, rows, seams });
      if (head.isErr()) {
        return err(head.error);
      }
      return rows.tail({
        journal,
        keptKinds: FLEET_JOURNAL_KEPT_KINDS[journal],
        keptLimit: FLEET_JOURNAL_KEPT_ROWS,
        limit: FLEET_JOURNAL_TAIL_ROWS,
      });
    },
    home,
    seams,
  });
}

/**
 * A fleet port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionFleetStoreSeams`
 * @returns the port
 */
export function storeFleetPort({ seams }: { seams: FleetStoreSeams }): FleetPort {
  return {
    appendCmuxReviveEvent: ({ event, home }) => appendTo({ event, home, journal: "cmux-revive", seams }),
    appendResumeEvent: ({ event, home }) => appendTo({ event, home, journal: "resume", seams }),
    newestCmuxReviveSequence: ({ home }) =>
      withRows({ body: (rows) => importedHead({ home, journal: "cmux-revive", rows, seams }), home, seams }),
    readCmuxReviveJournal: async ({ home }): Promise<Result<CmuxReviveRead, FleetError>> =>
      (await tailOf({ home, journal: "cmux-revive", seams })).map((values) => cmuxReviveJournalOfValues({ values })),
    readConfig: ({ home }) => withRows({ body: (rows) => currentConfig({ home, rows, seams }), home, seams }),
    readResumeJournal: async ({ home }): Promise<Result<FleetJournalRead, FleetError>> =>
      (await tailOf({ home, journal: "resume", seams })).map((values) => fleetJournalOfValues({ values })),
    writeConfig: ({ config, home }) => withRows({ body: (rows) => writeConfigWith({ config, rows }), home, seams }),
  };
}
