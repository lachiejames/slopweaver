/**
 * One small register as one authoritative store row: read it, import its retired home file ONCE, and change it
 * only by compare-and-set. The shape `src/plans/storePort.ts` proved, narrowed to what a single bounded
 * document needs — no projections, no diagnostics, no mutation language.
 *
 * Each domain keeps its own port, its own document parser and its own error union: this module is generic
 * plumbing and owns NO failure type. Every failure it reports is built by the factories the domain hands it
 * ({@link SingletonRegisterErrorFactories}), so a Gmail refusal is a Gmail error and a browser refusal a browser
 * one (`.claude/rules/error-handling.md`: no shared base type across domains).
 *
 * ## The read: the row, else the one-time import, else nothing
 *
 * A row present is decoded and returned; the retired file is never consulted again. No row consults the file:
 * a valid one is inserted at revision 1 with `ON CONFLICT DO NOTHING` and the winner read back, so a concurrent
 * importer's row wins and a file never overwrites a row; an absent one inserts nothing and answers `revision:
 * null`, because loading new code must never adopt state; a damaged one is the domain's own refusal.
 *
 * ## The write: compare-and-set, never a retry
 *
 * `expectedRevision: null` inserts iff no row exists; a number updates `WHERE revision = N`. Either missing is
 * the domain's revision conflict and nothing replays it: re-judging against a register that moved is the caller's.
 *
 * ## A store outage is a refusal, never the file
 *
 * No selection, a stale database, an unreachable one, a failed statement, a seam that rejected: every one is the
 * domain's store-unavailable error. NONE falls back to the home file — a file that stopped being the authority is
 * exactly how a register becomes confidently wrong.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "./client.js";
import { type SingletonRegisterId, singletonRegisterTable } from "./schema/singletonRegister.js";

/** One stored row as the store returned it: the raw document, undecoded, and its revision. */
export interface StoredSingletonRegister {
  /** `unknown` on purpose — `jsonb` is not validation, so every reader decodes it. */
  readonly document: unknown;
  readonly revision: number;
}

/** The register as it stands: its decoded document and revision, or neither when no row exists yet. */
interface SingletonRegisterSnapshot<Document> {
  /** Undefined when the store holds no row and there was no retired file to import. */
  readonly document: Document | undefined;
  /** The revision a writer pins to; null when no row backs the snapshot. */
  readonly revision: number | null;
}

/** A register that DOES have a row: what a successful compare-and-set answers. */
interface CommittedSingletonRegister<Document> {
  readonly document: Document;
  readonly revision: number;
}

/** The two failures this module reports, built by the domain so the error stays the domain's. */
export interface SingletonRegisterErrorFactories<Failure> {
  /** The store could not be selected, reached or queried; `doing` finishes "the store could not …". */
  readonly storeUnavailable: (request: { readonly doing: string; readonly reason: string }) => Failure;
  /** Another writer moved the row first; `expectedRevision` is 0 when the writer expected no row at all. */
  readonly revisionConflict: (request: { readonly expectedRevision: number }) => Failure;
}

/** The three row operations one open connection offers, and the handle that closes it. */
export interface SingletonRegisterRows<Failure> {
  /** The row, or undefined when the store holds none. */
  readonly read: () => Promise<Result<StoredSingletonRegister | undefined, Failure>>;
  /** Insert at revision 1 unless a row exists; undefined when one already did. */
  readonly insert: (request: {
    readonly document: unknown;
  }) => Promise<Result<StoredSingletonRegister | undefined, Failure>>;
  /** Update iff the row is still at `expectedRevision`, bumping it; undefined when it was not. */
  readonly update: (request: {
    readonly document: unknown;
    readonly expectedRevision: number;
  }) => Promise<Result<StoredSingletonRegister | undefined, Failure>>;
  readonly close: () => Promise<void>;
}

/** Every effect one register performs, injected so the orchestration is testable without a database. */
export interface SingletonRegisterSeams<Document, Failure> {
  /** Open the store for one home. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<SingletonRegisterRows<Failure>, Failure>>;
  /** The retired home file the one-time import consults: its document, undefined when absent, or the refusal. */
  readonly readImport: (request: { readonly home: string }) => Result<Document | undefined, Failure>;
  /** Decode a stored `jsonb` document. */
  readonly decodeStored: (request: { readonly value: unknown }) => Result<Document, Failure>;
  readonly errors: SingletonRegisterErrorFactories<Failure>;
}

/** One register's two operations, as one value a caller threads. */
export interface SingletonRegisterOperations<Document, Failure> {
  readonly read: (request: { readonly home: string }) => Promise<Result<SingletonRegisterSnapshot<Document>, Failure>>;
  /**
   * The row as it stands, decoded, WITHOUT the one-time import: a diagnostic that must create nothing (`doctor`)
   * reads this, and a missing row answers `revision: null` whether or not a retired file waits to be imported.
   */
  readonly peek: (request: { readonly home: string }) => Promise<Result<SingletonRegisterSnapshot<Document>, Failure>>;
  readonly compareAndSet: (request: {
    readonly document: Document;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<CommittedSingletonRegister<Document>, Failure>>;
}

/**
 * What a caught value says about itself, without letting a thrown request object into a message.
 *
 * @param cause whatever was thrown
 * @returns its message, or a constant when it is not an Error
 */
function describeStoreCause({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}

/** Decode one stored row into the domain's document, keeping its revision. */
function committedOf<Document, Failure>({
  row,
  seams,
}: {
  row: StoredSingletonRegister;
  seams: SingletonRegisterSeams<Document, Failure>;
}): Result<CommittedSingletonRegister<Document>, Failure> {
  const decoded = seams.decodeStored({ value: row.document });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  return ok({ document: decoded.value, revision: row.revision });
}

/** The register as it stands: the row, else the one-time import, else nothing. */
async function currentRegister<Document, Failure>({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: SingletonRegisterRows<Failure>;
  seams: SingletonRegisterSeams<Document, Failure>;
}): Promise<Result<SingletonRegisterSnapshot<Document>, Failure>> {
  const stored = await rows.read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return committedOf({ row: stored.value, seams });
  }
  const fromFile = seams.readImport({ home });
  if (fromFile.isErr()) {
    return err(fromFile.error);
  }
  if (fromFile.value === undefined) {
    return ok({ document: undefined, revision: null });
  }
  const inserted = await rows.insert({ document: fromFile.value });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  // A lost insert means another importer got there first: ITS row is the register, so read that back.
  const winner = inserted.value === undefined ? await rows.read() : ok(inserted.value);
  if (winner.isErr()) {
    return err(winner.error);
  }
  if (winner.value === undefined) {
    return err(
      seams.errors.storeUnavailable({
        doing: "import the register",
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return committedOf({ row: winner.value, seams });
}

/** The row as it stands, decoded, never importing anything. */
async function storedRegister<Document, Failure>({
  rows,
  seams,
}: {
  rows: SingletonRegisterRows<Failure>;
  seams: SingletonRegisterSeams<Document, Failure>;
}): Promise<Result<SingletonRegisterSnapshot<Document>, Failure>> {
  const stored = await rows.read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value === undefined) {
    return ok({ document: undefined, revision: null });
  }
  return committedOf({ row: stored.value, seams });
}

/** Insert when the writer expected no row, compare-and-set otherwise. */
async function commit<Document, Failure>({
  document,
  expectedRevision,
  rows,
  seams,
}: {
  document: Document;
  expectedRevision: number | null;
  rows: SingletonRegisterRows<Failure>;
  seams: SingletonRegisterSeams<Document, Failure>;
}): Promise<Result<CommittedSingletonRegister<Document>, Failure>> {
  const written =
    expectedRevision === null ? await rows.insert({ document }) : await rows.update({ document, expectedRevision });
  if (written.isErr()) {
    return err(written.error);
  }
  if (written.value === undefined && expectedRevision === null) {
    // `0` names "expected no row at all" — a real revision starts at 1.
    return err(seams.errors.revisionConflict({ expectedRevision: 0 }));
  }
  if (written.value === undefined) {
    return err(seams.errors.revisionConflict({ expectedRevision: expectedRevision! }));
  }
  return committedOf({ row: written.value, seams });
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * A seam that rejects rather than answering a Result is still a step that did not finish, so it is the same
 * store refusal; a close that fails after a write committed refuses too — the caller retrying meets a revision
 * conflict, which is visible, never a lost change.
 */
async function withRows<Document, Failure, Answer>({
  body,
  home,
  seams,
}: {
  body: (rows: SingletonRegisterRows<Failure>) => Promise<Result<Answer, Failure>>;
  home: string;
  seams: SingletonRegisterSeams<Document, Failure>;
}): Promise<Result<Answer, Failure>> {
  const unavailable = ({ cause, doing }: { cause: unknown; doing: string }): Failure =>
    seams.errors.storeUnavailable({ doing, reason: describeStoreCause({ cause }) });
  let rows: Result<SingletonRegisterRows<Failure>, Failure>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<Answer, Failure>;
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
 * One register whose authority is its store row, over whichever seams it is handed.
 *
 * @param seams the effects — production's come from {@link productionSingletonRegisterSeams}
 * @returns the register's read and compare-and-set
 */
export function singletonRegister<Document, Failure>({
  seams,
}: {
  seams: SingletonRegisterSeams<Document, Failure>;
}): SingletonRegisterOperations<Document, Failure> {
  return {
    compareAndSet: ({ document, expectedRevision, home }) =>
      withRows({ body: (rows) => commit({ document, expectedRevision, rows, seams }), home, seams }),
    peek: ({ home }) => withRows({ body: (rows) => storedRegister({ rows, seams }), home, seams }),
    read: ({ home }) => withRows({ body: (rows) => currentRegister({ home, rows, seams }), home, seams }),
  };
}

/** The two columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = { document: singletonRegisterTable.document, revision: singletonRegisterTable.revision };

/**
 * The three row operations over one open client, addressing one register's row.
 *
 * Every statement goes through Drizzle's parameterised builders and every throw becomes the domain's
 * store-unavailable error, never an empty answer. A driver message never carries the connection string.
 *
 * @param client the open store connection
 * @param id which register's row
 * @param storeUnavailable the domain's factory for a failed statement
 * @returns the operations, and the close the caller owns
 */
function singletonRegisterRowsOver<Failure>({
  client,
  id,
  storeUnavailable,
}: {
  client: StoreClient;
  id: SingletonRegisterId;
  storeUnavailable: SingletonRegisterErrorFactories<Failure>["storeUnavailable"];
}): SingletonRegisterRows<Failure> {
  const isTheRow = eq(singletonRegisterTable.id, id);
  const firstRow = async ({
    doing,
    statement,
  }: {
    doing: string;
    statement: () => Promise<readonly StoredSingletonRegister[]>;
  }): Promise<Result<StoredSingletonRegister | undefined, Failure>> => {
    try {
      const found = await statement();
      return ok(found[0]);
    } catch (cause) {
      return err(storeUnavailable({ doing, reason: describeStoreCause({ cause }) }));
    }
  };
  return {
    close: () => client.close(),
    insert: ({ document }) =>
      firstRow({
        doing: `import the ${id} register`,
        statement: () =>
          client.db
            .insert(singletonRegisterTable)
            .values({ document, id, revision: 1 })
            .onConflictDoNothing({ target: singletonRegisterTable.id })
            .returning(RETURNED),
      }),
    read: () =>
      firstRow({
        doing: `read the ${id} register`,
        statement: () => client.db.select(RETURNED).from(singletonRegisterTable).where(isTheRow).limit(1),
      }),
    update: ({ document, expectedRevision }) =>
      firstRow({
        doing: `write the ${id} register`,
        statement: () =>
          client.db
            .update(singletonRegisterTable)
            .set({ document, revision: sql`${singletonRegisterTable.revision} + 1`, updatedAt: sql`now()` })
            .where(and(isTheRow, eq(singletonRegisterTable.revision, expectedRevision)))
            .returning(RETURNED),
      }),
  };
}

/**
 * The production seams for one register: the real store a home selects, the domain's own file read and decoder.
 *
 * @param id which register's row
 * @param readImport the domain's read of its retired home file
 * @param decodeStored the domain's decoder for the stored document
 * @param errors the domain's two failure factories
 * @returns the seams `singletonRegister` runs over
 */
export function productionSingletonRegisterSeams<Document, Failure>({
  decodeStored,
  errors,
  id,
  readImport,
}: {
  decodeStored: SingletonRegisterSeams<Document, Failure>["decodeStored"];
  errors: SingletonRegisterErrorFactories<Failure>;
  id: SingletonRegisterId;
  readImport: SingletonRegisterSeams<Document, Failure>["readImport"];
}): SingletonRegisterSeams<Document, Failure> {
  return {
    connect: async ({ home }) => {
      const client = await connectStore({ home });
      if (client.isErr()) {
        return err(errors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
      }
      return ok(singletonRegisterRowsOver({ client: client.value, id, storeUnavailable: errors.storeUnavailable }));
    },
    decodeStored,
    errors,
    readImport,
  };
}
