/**
 * The Postgres half of the store-backed fleet, and the file reads its one-time imports consult.
 * `./storePort.ts` owns every decision; this module only speaks SQL and reads the old files.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore` — the
 * checked entrance that refuses a missing selection, a remote host and a stale database — and every failure becomes
 * `STORE_UNAVAILABLE`, never an empty answer. A message here never carries the connection string: `connectStore`'s
 * own refusals are written to be printed, and a driver error is reduced to its own message.
 *
 * What is worth proving about the statements themselves — the import transaction, the append counter, the CHECKs —
 * only a real database can prove. `src/__tests__/integration/fleetStore.test.ts` does, against a throwaway one.
 */
import { readFileSync } from "node:fs";

import { and, desc, eq, lt, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { decodeCmuxReviveEvent } from "../cmux/reviveJournal.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import {
  FLEET_CONFIG_ID,
  type FleetJournalName,
  fleetConfigTable,
  fleetJournalEventTable,
  fleetJournalTable,
} from "../store/schema/fleet.js";
import { type FleetConfig, parseFleetConfig } from "./config.js";
import { type FleetError, FleetErrors, type FleetStoreUnavailableError } from "./errors.js";
import { decodeFleetJournalEvent } from "./journal.js";
import { jsonLineValue } from "./jsonlValues.js";
import type {
  FleetJournalImport,
  FleetJournalImportEntry,
  FleetRows,
  FleetStoreSeams,
  StoredFleetConfig,
} from "./storePort.js";

/** The three columns every configuration statement returns, so a read and a write answer in one shape. */
const RETURNED_CONFIG = {
  capacity: fleetConfigTable.capacity,
  revision: fleetConfigTable.revision,
  schemaVersion: fleetConfigTable.schemaVersion,
};

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not …"
 * @param statement the statement to run
 * @returns what it answered, or the refusal
 */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, FleetStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    return err(
      FleetErrors.storeUnavailable({ doing, reason: cause instanceof Error ? cause.message : "unknown failure" }),
    );
  }
}

/** The capacity setting's three statements over one open client. */
function configRowsOver({
  client,
}: {
  client: StoreClient;
}): Pick<FleetRows, "insertConfig" | "readConfig" | "updateConfig"> {
  const isTheConfig = eq(fleetConfigTable.id, FLEET_CONFIG_ID);
  return {
    insertConfig: ({ config }) =>
      attempt({
        doing: "import the fleet configuration",
        statement: async () => {
          const rows = await client.db
            .insert(fleetConfigTable)
            .values({
              capacity: config.capacity,
              id: FLEET_CONFIG_ID,
              revision: 1,
              schemaVersion: config.schemaVersion,
            })
            .onConflictDoNothing({ target: fleetConfigTable.id })
            .returning(RETURNED_CONFIG);
          return rows[0];
        },
      }),
    readConfig: () =>
      attempt({
        doing: "read the fleet configuration",
        statement: async (): Promise<StoredFleetConfig | undefined> => {
          const rows = await client.db.select(RETURNED_CONFIG).from(fleetConfigTable).where(isTheConfig).limit(1);
          return rows[0];
        },
      }),
    updateConfig: ({ config, expectedRevision }) =>
      attempt({
        doing: "write the fleet configuration",
        statement: async () => {
          const rows = await client.db
            .update(fleetConfigTable)
            .set({
              capacity: config.capacity,
              revision: sql`${fleetConfigTable.revision} + 1`,
              schemaVersion: config.schemaVersion,
              updatedAt: sql`now()`,
            })
            .where(and(isTheConfig, eq(fleetConfigTable.revision, expectedRevision)))
            .returning(RETURNED_CONFIG);
          return rows[0];
        },
      }),
  };
}

/** A journal's one-time import: its head claimed, then its rows, in one transaction. */
function importJournalOver({ client }: { client: StoreClient }): FleetRows["importJournal"] {
  return ({ imported, journal }) =>
    attempt({
      doing: `import the ${journal} journal`,
      statement: () =>
        client.db.transaction(async (tx) => {
          const claimed = await tx
            .insert(fleetJournalTable)
            .values({
              importSource: imported.source,
              importUnreadable: imported.entries.filter((entry) => entry.event === null).length,
              journal,
              latestSequence: imported.entries.length,
            })
            .onConflictDoNothing({ target: fleetJournalTable.journal })
            .returning({ journal: fleetJournalTable.journal });
          // No row back: another importer's head is committed, and ITS rows are the journal.
          if (claimed.length === 0 || imported.entries.length === 0) {
            return undefined;
          }
          await tx.insert(fleetJournalEventTable).values(
            imported.entries.map((entry, index) => ({
              event: entry.event,
              importLine: entry.line,
              journal,
              sequence: index + 1,
            })),
          );
          return undefined;
        }),
    });
}

/** The journals' statements over one open client: append, import, head and tail. */
function journalRowsOver({
  client,
}: {
  client: StoreClient;
}): Pick<FleetRows, "append" | "importJournal" | "journalHead" | "tail"> {
  return {
    append: ({ event, journal }) =>
      attempt({
        doing: `append to the ${journal} journal`,
        statement: () =>
          client.db.transaction(async (tx) => {
            // The head's row lock serialises appends: the bumped sequence is this transaction's alone, and it is
            // never visible without its event because both commit together.
            const bumped = await tx
              .update(fleetJournalTable)
              .set({ latestSequence: sql`${fleetJournalTable.latestSequence} + 1` })
              .where(eq(fleetJournalTable.journal, journal))
              .returning({ sequence: fleetJournalTable.latestSequence });
            const sequence = bumped[0]?.sequence;
            if (sequence === undefined) {
              return undefined;
            }
            await tx.insert(fleetJournalEventTable).values({ event, journal, sequence });
            return sequence;
          }),
      }),
    importJournal: importJournalOver({ client }),
    journalHead: ({ journal }) =>
      attempt({
        doing: `read the ${journal} journal`,
        statement: async () => {
          const rows = await client.db
            .select({ latestSequence: fleetJournalTable.latestSequence })
            .from(fleetJournalTable)
            .where(eq(fleetJournalTable.journal, journal))
            .limit(1);
          return rows[0]?.latestSequence;
        },
      }),
    tail: tailOver({ client }),
  };
}

/** A journal's tail over one open client: the newest rows, then each kept kind's newest before them. */
function tailOver({ client }: { client: StoreClient }): FleetRows["tail"] {
  return ({ journal, keptKinds, keptLimit, limit }) =>
    attempt({
      doing: `read the ${journal} journal`,
      statement: async () => {
        const rows = await client.db
          .select({ event: fleetJournalEventTable.event, sequence: fleetJournalEventTable.sequence })
          .from(fleetJournalEventTable)
          .where(eq(fleetJournalEventTable.journal, journal))
          .orderBy(desc(fleetJournalEventTable.sequence))
          .limit(limit);
        const tail = rows.map((row) => row.event).toReversed();
        const oldest = rows.at(-1)?.sequence;
        if (oldest === undefined || rows.length < limit || keptKinds.length === 0) {
          return tail;
        }
        // One query per kind, so a flood of one kind never crowds another out of what is kept.
        const perKind = keptKinds.map((kind) =>
          client.db
            .select({ event: fleetJournalEventTable.event, sequence: fleetJournalEventTable.sequence })
            .from(fleetJournalEventTable)
            .where(
              and(
                eq(fleetJournalEventTable.journal, journal),
                lt(fleetJournalEventTable.sequence, oldest),
                eq(sql`${fleetJournalEventTable.event}->>'kind'`, kind),
              ),
            )
            .orderBy(desc(fleetJournalEventTable.sequence))
            .limit(keptLimit),
        );
        const kept = (await Promise.all(perKind)).flat().toSorted((a, b) => a.sequence - b.sequence);
        return [...kept.map((row) => row.event), ...tail];
      },
    });
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function fleetRowsOver({ client }: { client: StoreClient }): FleetRows {
  return { ...configRowsOver({ client }), ...journalRowsOver({ client }), close: () => client.close() };
}

/** Whether a read failed only because the file is not there. */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * The `config.json` a checkout before the store wrote, read for its one-time import.
 *
 * @param home the Slopweaver home
 * @returns the configuration, undefined when no file is there, or the refusal for a damaged one
 */
export function readFleetConfigFile({ home }: { home: string }): Result<FleetConfig | undefined, FleetError> {
  const path = stateHomePaths({ home }).fleetConfigJson;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    if (isMissing({ cause })) {
      return ok(undefined);
    }
    return err(FleetErrors.io({ cause, path }));
  }
  const value = jsonLineValue({ line: text });
  if (value === undefined) {
    return err(FleetErrors.configInvalid({ path, why: "not JSON" }));
  }
  return parseFleetConfig({ path, value });
}

/**
 * One journal file a checkout before the store appended, read line by line for its one-time import: each decoded
 * event kept, each line that would not decode kept as a placeholder carrying only its line number — never its text,
 * which cannot be shown free of a secret.
 *
 * @param home the Slopweaver home
 * @param journal names the file read and the decoder its lines go through
 * @returns what the import would store, or why the file could not be read
 */
export function readFleetJournalFile({
  home,
  journal,
}: {
  home: string;
  journal: FleetJournalName;
}): Result<FleetJournalImport, FleetError> {
  const paths = stateHomePaths({ home });
  const path = journal === "resume" ? paths.fleetResumeJsonl : paths.cmuxReviveJsonl;
  const decode = journal === "resume" ? decodeFleetJournalEvent : decodeCmuxReviveEvent;
  const entries: FleetJournalImportEntry[] = [];
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ index, line }) => {
        if (line.trim() !== "") {
          const event = decode({ value: jsonLineValue({ line }) });
          let stored: FleetJournalImportEntry["event"] = null;
          if (event !== undefined) {
            stored = event;
          }
          entries.push({ event: stored, line: index + 1 });
        }
      },
      path,
    });
  } catch (cause: unknown) {
    if (isMissing({ cause })) {
      return ok({ entries: [], source: "absent" });
    }
    return err(FleetErrors.io({ cause, path }));
  }
  return ok({ entries, source: entries.length === 0 ? "empty" : "present" });
}

/**
 * Open the store a home selects, as the fleet's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectFleetRows({ home }: { home: string }): Promise<Result<FleetRows, FleetStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(FleetErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(fleetRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store and the real files.
 *
 * @returns the seams `fleetPort()` runs over
 */
export function productionFleetStoreSeams(): FleetStoreSeams {
  return {
    connect: connectFleetRows,
    readConfigFile: readFleetConfigFile,
    readJournalFile: readFleetJournalFile,
  };
}
