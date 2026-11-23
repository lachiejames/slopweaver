/**
 * The store-backed grant journal: every entry read from, and written once into, `grant_row`. This module is the
 * ORCHESTRATION; every effect arrives through {@link GrantStoreSeams}, so a unit test drives every branch over a
 * plain in-memory fake (a seam, not a mock: `.claude/rules/testing.md`). The Postgres half is `./storeRows.ts`;
 * what only a real database can prove — the partial unique indexes, the sequence — is the opt-in
 * `src/__tests__/integration/grantJournalStore.test.ts`.
 *
 * Every operation opens one connection and always closes it. A seam that rejects rather than answering a Result
 * is still a step that did not finish, so it is the same refusal, `GRANT_STORE_UNAVAILABLE` — never an empty
 * journal standing in for "the rows are unknown", which would turn every check into `ROW_MISSING`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { grantEntryRow } from "../store/fleet/grantRow.js";
import type { NewGrantRowRecord } from "../store/schema/ledgers.js";
import { withStoreConnection } from "../store/withConnection.js";
import { type GrantEntry, parseGrantEnvelope } from "./grant.js";
import type { GrantJournalPort } from "./port.js";
import { type GrantStoreError, GrantStoreErrors, type GrantStoreUnavailableError } from "./storeErrors.js";

/** One stored row as a read returns it: its key, for a refusal to name, and the envelope it decodes from. */
export interface StoredGrantRow {
  readonly importKey: string;
  readonly entry: unknown;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface GrantRows {
  /** Every row, in insert (`seq`) order — the order the journal's lines had. */
  readonly readAll: () => Promise<Result<readonly StoredGrantRow[], GrantStoreUnavailableError>>;
  /** Insert unless ANY unique index already holds it; false when one did, which this writer then lost. */
  readonly insert: (request: {
    readonly row: NewGrantRowRecord;
  }) => Promise<Result<boolean, GrantStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed journal performs, injected so the orchestration is testable without one. */
export interface GrantStoreSeams {
  /** Open the store for one home, refusing with `GRANT_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<GrantRows, GrantStoreUnavailableError>>;
  /** A fresh token for a refusal's key — refusals are many, so theirs is the one key that is not derived. */
  readonly refusalNonce: () => string;
}

/** The store refusal for a seam that rejected rather than answering a Result. */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): GrantStoreUnavailableError {
  const reason = cause instanceof Error ? cause.message : "unknown failure";
  return GrantStoreErrors.storeUnavailable({ doing, reason });
}

/** Run one operation over a connection this function opens and always closes. */
async function withRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: GrantRows) => Promise<Result<T, GrantStoreError>>;
  home: string;
  seams: GrantStoreSeams;
}): Promise<Result<T, GrantStoreError>> {
  return withStoreConnection<GrantRows, T, GrantStoreError>({
    body,
    connect: () => seams.connect({ home }),
    unavailable,
  });
}

/** The grant id an entry is about, whichever of the three shapes it is. */
function grantIdOf({ entry }: { entry: GrantEntry }): string {
  switch (entry.kind) {
    case "grant":
      return entry.grant.id;
    case "performance":
      return entry.performance.grantId;
    case "refusal":
      return entry.refusal.grantId;
  }
}

/**
 * The derived idempotence key for a row written through the port. A grant and a performance are one per grant id,
 * so theirs name the id; the partial unique indexes are what actually hold that, the key only makes a replayed
 * write collide on the same row. A refusal carries a nonce, because a grant may be refused many times.
 */
function writtenKey({ entry, nonce }: { entry: GrantEntry; nonce: () => string }): string {
  const grantId = grantIdOf({ entry });
  if (entry.kind === "refusal") {
    return `written:refusal:${grantId}:${nonce()}`;
  }
  return `written:${entry.kind}:${grantId}`;
}

/** The collision a lost insert of this entry means. */
function lostInsert({ entry }: { entry: GrantEntry }): GrantStoreError {
  const grantId = grantIdOf({ entry });
  switch (entry.kind) {
    case "grant":
      return GrantStoreErrors.idTaken({ grantId });
    case "performance":
      return GrantStoreErrors.alreadyPerformed({ grantId });
    case "refusal":
      return GrantStoreErrors.refusalKeyTaken({ grantId });
  }
}

/**
 * The row an entry becomes, or why the store cannot hold it verbatim. Postgres `text` and `jsonb` both refuse a
 * NUL byte, and stripping one would change the exact change a performance is compared against byte for byte.
 */
function rowOf({
  entry,
  nonce,
}: {
  entry: GrantEntry;
  nonce: () => string;
}): Result<NewGrantRowRecord, GrantStoreError> {
  const grantId = grantIdOf({ entry });
  if (JSON.stringify(entry).includes("\\u0000")) {
    return err(GrantStoreErrors.entryUnstorable({ grantId, reason: "it holds a NUL byte" }));
  }
  return grantEntryRow({ entry, importKey: writtenKey({ entry, nonce }), verbatim: entry }).mapErr((atIso) =>
    GrantStoreErrors.entryUnstorable({ grantId, reason: `${atIso} is not an instant` }),
  );
}

/** Decode every stored row, refusing the whole read on the first one that is not an entry. */
function decodeAll({ rows }: { rows: readonly StoredGrantRow[] }): Result<readonly GrantEntry[], GrantStoreError> {
  const entries: GrantEntry[] = [];
  for (const row of rows) {
    const entry = parseGrantEnvelope({ value: row.entry });
    if (entry === undefined) {
      return err(GrantStoreErrors.rowUnreadable({ importKey: row.importKey }));
    }
    entries.push(entry);
  }
  return ok(entries);
}

/**
 * A grant journal port whose authority is the `grant_row` rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionGrantStoreSeams`
 * @returns the port
 */
export function storeGrantJournalPort({ seams }: { seams: GrantStoreSeams }): GrantJournalPort {
  return {
    appendEntry: async ({ entry, home }) => {
      const row = rowOf({ entry, nonce: seams.refusalNonce });
      if (row.isErr()) {
        return err(row.error);
      }
      return withRows({
        body: async (rows) => {
          const inserted = await rows.insert({ row: row.value });
          if (inserted.isErr()) {
            return err(inserted.error);
          }
          return inserted.value ? ok(undefined) : err(lostInsert({ entry }));
        },
        home,
        seams,
      });
    },
    readEntries: ({ home }) =>
      withRows({
        body: async (rows) => {
          const stored = await rows.readAll();
          if (stored.isErr()) {
            return err(stored.error);
          }
          return decodeAll({ rows: stored.value });
        },
        home,
        seams,
      }),
  };
}
