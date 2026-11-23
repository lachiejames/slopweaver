/**
 * Where one alias's Codex sign-in observation STANDS before a read answers or a write judges: its stored row,
 * else the one-time import from `$SLOPWEAVER_HOME/codex-signin/<alias>.json`, else nothing filed. The seams every
 * store effect arrives through are declared here too, since this is the half that both reads and imports.
 *
 * `./signInRecordStore.ts` is the other half: it answers reads from what this settles and files writes by
 * compare-and-set against it.
 *
 * ## The one-time import, per alias
 *
 * A read finding no row for an alias consults that alias's file, and only then. A valid one is inserted at
 * revision 1 with `ON CONFLICT DO NOTHING` and read back, so a concurrent importer's row wins and a file never
 * overwrites a row. An absent one inserts nothing. A file present but unreadable may hold a refusal nobody can see,
 * so it is refused and nothing is written past it — as the per-alias file store refused before. A file that READ
 * but does not decode holds no refusal anyone could order against, so a reader is refused over it while a writer
 * may replace it with the store's own answer, which is what the file store did with one. Once a row exists the
 * file is never read again, whatever later happens to it.
 */
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { isPlanAlias } from "../plans/register.js";
import { stateHomePaths } from "../stateHome.js";

import {
  type CodexSignInAliasRefusal,
  CodexSignInErrors,
  type CodexSignInRevisionConflictError,
  type CodexSignInStoreUnavailableError,
} from "./signInErrors.js";
import { type CodexSignInRecord, decodeCodexSignInRecord } from "./signInRecord.js";

/** One stored row as the store returned it: the raw record, undecoded, and its revision. */
export interface StoredCodexSignIn {
  readonly alias: string;
  /** `unknown` on purpose — `jsonb` is not validation, so every reader decodes it. */
  readonly record: unknown;
  readonly revision: number;
}

/**
 * The row operations one open connection offers, and the handle that closes it. A store step's only failure is
 * `CODEX_SIGN_IN_STORE_UNAVAILABLE`, typed so: no seam can make a failed statement read as anything else.
 */
export interface CodexSignInRows {
  /** The stored rows among the aliases asked for, in no particular order. */
  readonly read: (request: {
    readonly aliases: readonly string[];
  }) => Promise<Result<readonly StoredCodexSignIn[], CodexSignInStoreUnavailableError>>;
  /** Insert at revision 1 unless the alias has a row; undefined when one already did, which this writer lost. */
  readonly insert: (request: {
    readonly alias: string;
    readonly record: CodexSignInRecord;
  }) => Promise<Result<StoredCodexSignIn | undefined, CodexSignInStoreUnavailableError>>;
  /** Update iff the alias's row is still at `expectedRevision`, bumping it; undefined when it was not. */
  readonly update: (request: {
    readonly alias: string;
    readonly expectedRevision: number;
    readonly record: CodexSignInRecord;
  }) => Promise<Result<StoredCodexSignIn | undefined, CodexSignInStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** What the import file for one alias holds: nothing, parsed JSON, text that does not parse, or no readable file. */
export type CodexSignInImportRead =
  | { readonly kind: "absent" }
  | { readonly kind: "parsed"; readonly path: string; readonly value: unknown }
  | { readonly kind: "unparseable"; readonly path: string; readonly why: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/** Every effect the store-backed observations perform, injected so the orchestration is testable without one. */
export interface CodexSignInStoreSeams {
  /** Open the store for one home, refusing with `CODEX_SIGN_IN_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<CodexSignInRows, CodexSignInStoreUnavailableError>>;
  /** The file the one-time import consults for an alias with no row. */
  readonly readImportFile: (request: { readonly alias: string; readonly home: string }) => CodexSignInImportRead;
}

/**
 * Read the import file filed under one alias, strictly: only a genuine ENOENT is absence.
 *
 * An `existsSync` check answers false for a directory that cannot be searched too, which would read a refusal still
 * on disk as absent and clear its card. The strict read also refuses a FIFO rather than blocking the routing read.
 *
 * @param alias a register alias, already validated, so it can never name a path outside the directory
 * @param home the Slopweaver home whose `codex-signin/` directory is read
 * @returns what the file holds
 */
export function readCodexSignInImportFile({ alias, home }: { alias: string; home: string }): CodexSignInImportRead {
  const path = join(stateHomePaths({ home }).codexSignInDir, `${alias}.json`);
  const read = readStrictFileIfPresent({ operation: "codex-signin-import", path });
  if (read.isErr()) {
    return { kind: "unreadable", path, why: read.error.message };
  }
  if (read.value === null) {
    return { kind: "absent" };
  }
  try {
    return { kind: "parsed", path, value: JSON.parse(read.value) };
  } catch (cause) {
    return { kind: "unparseable", path, why: errorMessage({ error: cause }) };
  }
}

/**
 * Where one alias stands before a read answers or a write judges: nothing filed, a record at its revision, or a
 * refusal — `writable` when the refusal is only an undecodable import file, which a writer may replace.
 */
export type CurrentObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "record"; readonly record: CodexSignInRecord; readonly revision: number }
  | { readonly kind: "refused"; readonly error: CodexSignInAliasRefusal; readonly writable: boolean };

/**
 * Where an alias stands after THIS operation's compare-and-set missed: unknown to it, so nothing later in the same
 * operation writes the alias again. Only a write can reach it; a read never settles one.
 */
export interface ConflictedObservation {
  readonly kind: "conflicted";
  readonly error: CodexSignInRevisionConflictError;
}

/**
 * Decode one stored row, refusing one that does not decode.
 *
 * @returns the record at its revision, or the refusal
 */
export function currentOfRow({ alias, row }: { alias: string; row: StoredCodexSignIn }): CurrentObservation {
  const decoded = decodeCodexSignInRecord({ alias, value: row.record });
  if ("why" in decoded) {
    return {
      error: CodexSignInErrors.storedObservationInvalid({ alias, why: decoded.why }),
      kind: "refused",
      writable: false,
    };
  }
  return { kind: "record", record: decoded.record, revision: row.revision };
}

/**
 * Import one alias's file, when it holds a valid record: insert it, and read back whichever row won.
 *
 * @param record the decoded record the file holds
 * @param rows the open connection's row operations
 * @returns the current observation once imported, or the store refusal
 */
async function importRecord({
  alias,
  record,
  rows,
}: {
  alias: string;
  record: CodexSignInRecord;
  rows: CodexSignInRows;
}): Promise<Result<CurrentObservation, CodexSignInStoreUnavailableError>> {
  const inserted = await rows.insert({ alias, record });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  if (inserted.value !== undefined) {
    return ok(currentOfRow({ alias, row: inserted.value }));
  }
  // A lost insert means another importer or writer got there first: ITS row is the observation, so read that back.
  const winner = await rows.read({ aliases: [alias] });
  if (winner.isErr()) {
    return err(winner.error);
  }
  const row = winner.value.find((stored) => stored.alias === alias);
  if (row === undefined) {
    return err(
      CodexSignInErrors.storeUnavailable({
        doing: `import ${alias}'s sign-in observation`,
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return ok(currentOfRow({ alias, row }));
}

/**
 * Where one alias stands: its stored row, else the one-time import, else nothing filed.
 *
 * @param stored the alias's row from this operation's one read, or undefined when the store holds none
 * @param rows the open connection's row operations
 * @param seams where the import file comes from
 * @returns the current observation, or the store refusal
 */
async function currentObservation({
  alias,
  home,
  rows,
  seams,
  stored,
}: {
  alias: string;
  home: string;
  rows: CodexSignInRows;
  seams: CodexSignInStoreSeams;
  stored: StoredCodexSignIn | undefined;
}): Promise<Result<CurrentObservation, CodexSignInStoreUnavailableError>> {
  if (!isPlanAlias({ alias })) {
    return ok({ error: CodexSignInErrors.aliasInvalid({ alias }), kind: "refused", writable: false });
  }
  if (stored !== undefined) {
    return ok(currentOfRow({ alias, row: stored }));
  }
  const imported = seams.readImportFile({ alias, home });
  if (imported.kind === "absent") {
    return ok({ kind: "absent" });
  }
  if (imported.kind === "unreadable") {
    const error = CodexSignInErrors.importUnreadable({ alias, path: imported.path, why: imported.why });
    return ok({ error, kind: "refused", writable: false });
  }
  if (imported.kind === "unparseable") {
    const error = CodexSignInErrors.importObservationInvalid({ alias, path: imported.path, why: imported.why });
    return ok({ error, kind: "refused", writable: true });
  }
  const decoded = decodeCodexSignInRecord({ alias, value: imported.value });
  if ("why" in decoded) {
    const error = CodexSignInErrors.importObservationInvalid({ alias, path: imported.path, why: decoded.why });
    return ok({ error, kind: "refused", writable: true });
  }
  return importRecord({ alias, record: decoded.record, rows });
}

/**
 * Read every stored row among some aliases in ONE statement, indexed by alias.
 *
 * @param aliases the aliases asked for; only valid ones reach the store
 * @returns each stored row by its alias, or the store refusal
 */
export async function storedByAlias({
  aliases,
  rows,
}: {
  aliases: readonly string[];
  rows: CodexSignInRows;
}): Promise<Result<ReadonlyMap<string, StoredCodexSignIn>, CodexSignInStoreUnavailableError>> {
  const stored = await rows.read({ aliases: aliases.filter((alias) => isPlanAlias({ alias })) });
  if (stored.isErr()) {
    return err(stored.error);
  }
  return ok(new Map(stored.value.map((row) => [row.alias, row])));
}

/**
 * Where each alias stands, worked out at most ONCE per operation: an alias asked for twice in one request meets the
 * observation the first ask settled, never the empty snapshot again, so its import file is consulted once.
 *
 * `Settled` is what this operation may record for an alias after acting on it: a read records nothing beyond the
 * lookup (`never`), a write may record a {@link ConflictedObservation}, so only a write's lookups can answer one.
 *
 * @param home the Slopweaver home whose import files are consulted
 * @param stored this operation's one read of the rows, by alias
 * @returns a lookup that settles an alias on first ask, and a setter for what a write committed
 */
export function observationsOnce<Settled = never>({
  home,
  rows,
  seams,
  stored,
}: {
  home: string;
  rows: CodexSignInRows;
  seams: CodexSignInStoreSeams;
  stored: ReadonlyMap<string, StoredCodexSignIn>;
}): {
  readonly of: (request: {
    alias: string;
  }) => Promise<Result<CurrentObservation | Settled, CodexSignInStoreUnavailableError>>;
  readonly settle: (request: { alias: string; now: CurrentObservation | Settled }) => void;
} {
  const settled = new Map<string, CurrentObservation | Settled>();
  return {
    of: async ({ alias }) => {
      if (settled.has(alias)) {
        return ok(settled.get(alias)!);
      }
      const current = await currentObservation({ alias, home, rows, seams, stored: stored.get(alias) });
      if (current.isOk()) {
        settled.set(alias, current.value);
      }
      return current;
    },
    settle: ({ alias, now }) => {
      settled.set(alias, now);
    },
  };
}
