/**
 * The production edges of `github press-reseal`: the `landing_press` statements it runs, the one transaction
 * they run in, and the append of its receipt to `$home/ledgers/landing-press-reseals.jsonl`. `./pressReseal.ts`
 * owns every decision; this module speaks SQL and appends one line.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database — exactly as `./pressJournalStoreRows.ts`'s does. The transaction takes a SHARE ROW
 * EXCLUSIVE lock on the table before its first read, so no press can be appended between the digest check and the
 * read-back: a concurrent `github landing --press` waits for the commit rather than racing the repair.
 *
 * The receipt is written `0600` inside a `0700` directory and fsynced: it is the only record that the old keys
 * ever existed, because the table keeps no history of a key it rewrote.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { asc, eq, sql } from "drizzle-orm";

import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient, type StoreReader, type StoreWriter } from "../store/client.js";
import { overConnection, type StoreStepFailure, storeStep } from "../store/registerImport.js";
import { landingPressTable } from "../store/schema/landingPress.js";

import type { StoredPress } from "./pressJournalPort.js";
import type { PressResealPlan, PressResealReceipt, PressResealSeams, PressResealTx } from "./pressReseal.js";
import { type PressResealError, PressResealErrors } from "./pressResealErrors.js";

/** Owner-only permissions for the receipt journal. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The columns every read returns. */
const RETURNED = {
  atIso: landingPressTable.atIso,
  entryState: landingPressTable.entryState,
  headOid: landingPressTable.headOid,
  number: landingPressTable.number,
  pressKey: landingPressTable.pressKey,
  repoSlug: landingPressTable.repoSlug,
};

/**
 * Every stored press through one reader, in insertion order.
 *
 * @param reader the connection or transaction to read through
 * @returns the rows
 */
async function readAllThrough({ reader }: { reader: StoreReader }): Promise<readonly StoredPress[]> {
  const rows = await reader.db.select(RETURNED).from(landingPressTable).orderBy(asc(landingPressTable.ordinal));
  return rows;
}

/**
 * The statements the apply runs, over one open transaction.
 *
 * @param tx the transaction
 * @returns the reseal's transaction statements
 */
function resealTxOver({ tx }: { tx: StoreWriter }): PressResealTx {
  return {
    readAll: () =>
      storeStep({ doing: "read the press register", statement: () => readAllThrough({ reader: { db: tx } }) }),
    rekey: ({ oldKey, newKey }) =>
      storeStep({
        doing: "re-key a stored press",
        statement: async () => {
          const moved = await tx
            .update(landingPressTable)
            .set({ pressKey: newKey })
            .where(eq(landingPressTable.pressKey, oldKey))
            .returning({ pressKey: landingPressTable.pressKey });
          return moved.length === 1;
        },
      }),
  };
}

/**
 * Open the store a home selects, refusing in the reseal's own terms.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the open client, or the store's refusal
 */
async function connectReseal({ home }: { home: string }): Promise<Result<StoreClient, PressResealError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(PressResealErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(client.value);
}

/**
 * Run the apply's body in one transaction: commit on ok, roll back on err, carrying the body's own refusal out.
 *
 * @param client the open store connection
 * @param body the transaction body
 * @returns the body's answer, or its refusal, or the store's
 */
async function inOneTransaction({
  client,
  body,
}: {
  client: StoreClient;
  body: (tx: PressResealTx) => Promise<Result<PressResealPlan, PressResealError>>;
}): Promise<Result<PressResealPlan, PressResealError>> {
  let refusal: PressResealError | undefined;
  try {
    const plan = await client.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE ${landingPressTable} IN SHARE ROW EXCLUSIVE MODE`);
      const answer = await body(resealTxOver({ tx }));
      if (answer.isErr()) {
        refusal = answer.error;
        // Throws drizzle's own rollback error, so nothing the body wrote survives a refusal.
        tx.rollback();
      }
      return answer;
    });
    return plan;
  } catch (cause) {
    if (refusal !== undefined) {
      return err(refusal);
    }
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    return err(PressResealErrors.storeUnavailable({ doing: "commit the re-key", reason }));
  }
}

/**
 * Append one receipt to the owner-only journal, creating its directory when needed.
 *
 * @param home the Slopweaver home the journal lives under
 * @param receipt what the apply did
 * @returns the journal's path, or why it could not be written
 */
export function appendPressResealReceipt({
  home,
  receipt,
}: {
  home: string;
  receipt: PressResealReceipt;
}): Result<string, PressResealError> {
  const path = stateHomePaths({ home }).landingPressResealsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    const line = safeJsonStringify({ label: "a press-reseal receipt", value: receipt });
    appendLines({ durable: true, mode: FILE_MODE, path, text: `${line}\n` });
  } catch (cause: unknown) {
    return err(PressResealErrors.receiptUnwritable({ cause, path }));
  }
  return ok(path);
}

/**
 * The production seams: the real store and the real journal. Composition roots only — `SLOPWEAVER_STORE_URL`
 * overrides the home's own selection, so a test that forgot to inject seams could otherwise reach a real store.
 *
 * @returns the seams `./pressReseal.ts` runs over
 */
export function productionPressResealSeams(): PressResealSeams {
  const unavailable = (failure: StoreStepFailure): PressResealError => PressResealErrors.storeUnavailable(failure);
  return {
    appendReceipt: appendPressResealReceipt,
    inTransaction: ({ home, body }) =>
      overConnection({
        body: (client) => inOneTransaction({ body, client }),
        connect: () => connectReseal({ home }),
        unavailable,
      }),
    readStored: ({ home }) =>
      overConnection({
        body: (client) =>
          storeStep({ doing: "read the press register", statement: () => readAllThrough({ reader: client }) }).then(
            (read): Result<readonly StoredPress[], PressResealError> => read.mapErr(unavailable),
          ),
        connect: () => connectReseal({ home }),
        unavailable,
      }),
  };
}
