/**
 * Reading the messages the owner sent interactive Codex threads out of Codex's own SQLite files — the effectful half of
 * `./codexMessageCapture.ts`.
 *
 * Two files under the Codex home, both opened READ-ONLY: `state_5.sqlite`'s `threads` names each thread's
 * `source`, and `thread_history_1.sqlite`'s `thread_items` holds its items. Only a thread whose `source` is `cli` or
 * `vscode` is the owner's; `exec` threads are the fleet's own Codex passes (MEASURED: 8,192 exec user items
 * against 713 interactive ones — repro `sqlite3 -readonly ~/.codex/state_5.sqlite "select source, count(*) from
 * threads group by source"`). So the interactive thread ids are read first and the history is asked for only
 * their `userMessage` items: an exec item's text never enters this process.
 *
 * A Codex home without either file is an absent source, not a failure — an install that has never run Codex.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { importSqliteQuietly } from "#lib/sqlite.js";

import {
  CODEX_INTERACTIVE_SURFACES,
  type CodexInteractiveSurface,
  type CodexMessageInput,
  type CodexThreadInput,
} from "./codexMessageCapture.js";
import { type FleetImportError, FleetImportErrors } from "./errors.js";

/** The file naming each thread's source. */
export const CODEX_STATE_FILE = "state_5.sqlite";

/** The file holding each thread's items. */
export const CODEX_HISTORY_FILE = "thread_history_1.sqlite";

/** What reading a Codex home found. */
export type CodexMessagesRead =
  /** A file the read needs is not there: the path that is missing. */
  | { readonly kind: "absent"; readonly path: string }
  | {
      readonly kind: "read";
      /** The history file, named with each message's identity in a refusal. */
      readonly historyPath: string;
      readonly threads: ReadonlyMap<string, CodexThreadInput>;
      readonly messages: readonly CodexMessageInput[];
      /** Rows that exist and are not the measured shape, each named. */
      readonly refused: readonly FleetImportError[];
    };

/** Whether a `threads.source` value is one of the interactive surfaces. */
function isInteractiveSurface(value: unknown): value is CodexInteractiveSurface {
  return CODEX_INTERACTIVE_SURFACES.some((surface) => surface === value);
}

/**
 * A SQL value as a string, or null for SQL null — anything else is a shape this reader does not know.
 *
 * @param value one column of one row
 * @returns the string, null, or `undefined` when it is neither
 */
function textOrNull({ value }: { value: unknown }): string | null | undefined {
  if (typeof value === "string" || value === null) {
    return value;
  }
  return undefined;
}

/**
 * Whether a TEXT column read back as a string re-encodes to exactly the bytes SQLite's `hex()` reported for it.
 *
 * @param value the column as the binding returned it
 * @param hex the same column through `hex()`, upper-case
 * @returns true only for a string whose UTF-8 bytes are the stored ones
 */
function isExactText({ value, hex }: { value: unknown; hex: unknown }): boolean {
  return typeof value === "string" && Buffer.from(value, "utf8").toString("hex").toUpperCase() === hex;
}

/**
 * Every interactive thread in the state file.
 *
 * @param rows the `threads` rows selected
 * @param path the state file, named in a refusal
 * @param refused where a row whose columns are not the measured shape is named — never skipped quietly
 * @returns each thread by id
 */
function threadsOf({
  rows,
  path,
  refused,
}: {
  rows: readonly Record<string, unknown>[];
  path: string;
  refused: FleetImportError[];
}): Map<string, CodexThreadInput> {
  const threads = new Map<string, CodexThreadInput>();
  const duplicated = new Set<string>();
  for (const row of rows) {
    const id = row["id"];
    const cwd = row["cwd"];
    const threadSource = textOrNull({ value: row["thread_source"] });
    const surface = row["source"];
    // The id must re-encode to exactly the bytes stored: a lossy decode (invalid UTF-8 read as U+FFFD) could equal
    // a different, valid id an exec thread holds in the history file.
    const exactId = isExactText({ hex: row["id_hex"], value: id });
    // `cwd` and `thread_source` are stored on every capture of the thread, so they are held to the same bytes.
    const exactCwd = isExactText({ hex: row["cwd_hex"], value: cwd });
    const exactThreadSource =
      threadSource === null || isExactText({ hex: row["thread_source_hex"], value: threadSource });
    if (
      exactId &&
      exactCwd &&
      exactThreadSource &&
      typeof id === "string" &&
      typeof cwd === "string" &&
      threadSource !== undefined &&
      isInteractiveSurface(surface)
    ) {
      // Codex's own table keys on `id`; a second row under one is a damaged file. The id is refused and dropped whole,
      // so none of its messages is read under either row's surface, cwd and thread source.
      if (threads.has(id) || duplicated.has(id)) {
        if (!duplicated.has(id)) {
          refused.push(
            FleetImportErrors.unstorableOwnerCapture({
              path: `${path}#${id}`,
              reason: "its threads table holds this id more than once",
            }),
          );
        }
        duplicated.add(id);
        threads.delete(id);
        continue;
      }
      threads.set(id, { cwd, id, surface, threadSource });
    } else {
      refused.push(
        FleetImportErrors.unstorableOwnerCapture({
          path: `${path}#${String(id)}`,
          reason: "its threads row is not the measured shape (exact UTF-8 text id, cwd and thread_source)",
        }),
      );
    }
  }
  return threads;
}

/**
 * Each history row as a message.
 *
 * @param rows the `thread_items` rows selected
 * @param path the history file, named in a refusal
 * @param refused where a row whose columns are not the measured shape is named — never skipped quietly
 * @returns the messages
 */
function messagesOf({
  rows,
  path,
  refused,
}: {
  rows: readonly Record<string, unknown>[];
  path: string;
  refused: FleetImportError[];
}): CodexMessageInput[] {
  const messages: CodexMessageInput[] = [];
  for (const row of rows) {
    const {
      thread_id: threadId,
      turn_id: turnId,
      item_id: itemId,
      created_at_ms: createdAtMs,
      item_json: itemJson,
    } = row;
    // The thread, turn and item ids build the row's `source_id` and the JSON is its body, so every one must re-encode
    // to exactly the bytes stored: node's SQLite binding reads invalid UTF-8 as U+FFFD, which would store an id or
    // words that were never there.
    if (
      typeof threadId === "string" &&
      isExactText({ hex: row["thread_id_hex"], value: threadId }) &&
      typeof turnId === "string" &&
      isExactText({ hex: row["turn_id_hex"], value: turnId }) &&
      typeof itemId === "string" &&
      isExactText({ hex: row["item_id_hex"], value: itemId }) &&
      typeof createdAtMs === "number" &&
      typeof itemJson === "string" &&
      isExactText({ hex: row["item_json_hex"], value: itemJson })
    ) {
      messages.push({ createdAtMs, itemId, itemJson, threadId, turnId });
    } else {
      refused.push(
        FleetImportErrors.unstorableOwnerCapture({
          path: `${path}#${String(threadId)}/${String(turnId)}/${String(itemId)}`,
          reason: "its thread_items row is not the measured shape (exact UTF-8 text ids and item_json)",
        }),
      );
    }
  }
  return messages;
}

const SURFACE_PLACEHOLDERS = CODEX_INTERACTIVE_SURFACES.map(() => "?").join(", ");

/**
 * Every interactive thread, bound to the interactive surfaces twice. An id some non-interactive row also carries is
 * not the owner's, whichever row the history means: Codex keys `threads` on `id`, so this only bites a damaged file, and then
 * it reads nothing rather than guessing.
 */
const INTERACTIVE_THREADS_SQL =
  "select id, hex(id) as id_hex, source, thread_source, hex(thread_source) as thread_source_hex, cwd, " +
  "hex(cwd) as cwd_hex from threads " +
  `where source collate binary in (${SURFACE_PLACEHOLDERS}) ` +
  "and not exists (select 1 from threads other where other.id collate binary = threads.id " +
  `and (other.source is null or other.source collate binary not in (${SURFACE_PLACEHOLDERS})))`;

/**
 * Every message the owner sent those threads, bound to their ids as one JSON array. A thread id matches only as the exact
 * same TEXT: `typeof` refuses a value a numeric column coerced (an exec `1` equal to the interactive `01`)
 * and `collate binary` one a NOCASE column would fold (an exec `ABC` equal to `abc`). Either would read an exec thread's text.
 */
const USER_MESSAGES_SQL =
  "select thread_id, hex(thread_id) as thread_id_hex, turn_id, hex(turn_id) as turn_id_hex, " +
  "item_id, hex(item_id) as item_id_hex, created_at_ms, item_json, " +
  "hex(item_json) as item_json_hex from thread_items " +
  "where item_type collate binary = 'userMessage' " +
  "and typeof(thread_id) = 'text' and thread_id collate binary in (select value from json_each(?)) " +
  "order by created_at_ms, thread_id, rollout_ordinal";

/**
 * Whether both databases are there. Only a genuinely absent file is absence (`isAbsentError`: ENOENT, no dangling link
 * on the way): `existsSync` answers false for a file it cannot reach too, which would report a Codex home this
 * account cannot search as one with no history. A file removed after this check fails the
 * database open below, a named refusal.
 *
 * @param paths the two database files
 * @returns `undefined` when both are there; otherwise `absent` naming the first missing one, or the refusal for one
 *   that cannot be reached
 */
function bothPresent({ paths }: { paths: readonly string[] }): Result<CodexMessagesRead, FleetImportError> | undefined {
  for (const path of paths) {
    try {
      statSync(path);
    } catch (cause) {
      if (isAbsentError({ error: cause, path })) {
        return ok({ kind: "absent", path });
      }
      const reason = `the Codex database would not read: ${errorMessage({ error: cause })}`;
      return err(FleetImportErrors.unstorableOwnerCapture({ path, reason }));
    }
  }
  return undefined;
}

/**
 * Why a relation this reader selects from is not a stored table, or `undefined` when it is one. A view or a virtual
 * table of the same name answers the same `select` with values computed at read time — a `created_at_ms` of
 * `strftime('%s','now')` would stamp a message with the import's own clock — so only a
 * stored table is a record of what Codex wrote. `pragma_table_list` is asked rather than `sqlite_schema`, whose `type`
 * reads `table` for a virtual table too — an FTS5 table over a view of `unixepoch()` passed that check — while the pragma answers `virtual`, `shadow` or `view` for each. The name is matched `nocase`
 * because SQLite resolves `from thread_items` that way, and two relations can never share one name in one schema.
 *
 * @param database the open, read-only database
 * @param table the relation the reader is about to select from
 * @param path the file, named in a refusal
 * @returns the refusal, or `undefined` for a stored table
 */
function notStoredTable({
  database,
  table,
  path,
}: {
  database: DatabaseSync;
  table: string;
  path: string;
}): FleetImportError | undefined {
  const rows = database
    .prepare("select type from pragma_table_list where schema = 'main' and name = ? collate nocase")
    .all(table);
  if (rows.length === 1 && rows[0]?.["type"] === "table") {
    return undefined;
  }
  return FleetImportErrors.unstorableOwnerCapture({
    path,
    reason: `its ${table} is not a stored table, so what it answers may not be what Codex wrote`,
  });
}

/**
 * Read every interactive thread and each one's messages from a Codex home.
 *
 * @param codexHome the directory holding both SQLite files, opened read-only
 * @returns the threads and messages, `absent` when a file is missing, or the refusal when a file will not read
 */
export async function readCodexMessages({
  codexHome,
}: {
  codexHome: string;
}): Promise<Result<CodexMessagesRead, FleetImportError>> {
  const statePath = join(codexHome, CODEX_STATE_FILE);
  const historyPath = join(codexHome, CODEX_HISTORY_FILE);
  const presence = bothPresent({ paths: [statePath, historyPath] });
  if (presence !== undefined) {
    return presence;
  }
  const refused: FleetImportError[] = [];
  let opened = statePath;
  try {
    // Inside the `try`, so a `node:sqlite` that will not load is this Result's refusal, never a rejection.
    const sqlite = await importSqliteQuietly();
    const state = new sqlite.DatabaseSync(statePath, { readOnly: true });
    let threads: Map<string, CodexThreadInput>;
    try {
      const notTable = notStoredTable({ database: state, path: statePath, table: "threads" });
      if (notTable !== undefined) {
        return err(notTable);
      }
      const rows = state
        .prepare(INTERACTIVE_THREADS_SQL)
        .all(...CODEX_INTERACTIVE_SURFACES, ...CODEX_INTERACTIVE_SURFACES);
      threads = threadsOf({ path: statePath, refused, rows });
    } finally {
      state.close();
    }
    opened = historyPath;
    const history = new sqlite.DatabaseSync(historyPath, { readOnly: true });
    try {
      const notTable = notStoredTable({ database: history, path: historyPath, table: "thread_items" });
      if (notTable !== undefined) {
        return err(notTable);
      }
      const rows = history.prepare(USER_MESSAGES_SQL).all(JSON.stringify([...threads.keys()]));
      const messages = messagesOf({ path: historyPath, refused, rows });
      return ok({ historyPath, kind: "read", messages, refused, threads });
    } finally {
      history.close();
    }
  } catch (cause) {
    return err(
      FleetImportErrors.unstorableOwnerCapture({
        path: opened,
        reason: `the Codex database would not read: ${errorMessage({ error: cause })}`,
      }),
    );
  }
}
