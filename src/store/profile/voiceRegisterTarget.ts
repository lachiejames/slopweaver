/**
 * The store a voice-register measurement writes through: one connection, one transaction, and the three steps the
 * write takes inside it. The database half of `../../profile/voiceMeasureWrite.ts`, kept here beside the queries it
 * runs so that module's order, rollback and error mapping are unit-tested over a plain fake of
 * {@link VoiceRegisterTarget}; the real-store proof is `subprocess/profile/profileVoiceMeasureContract.test.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreReader, storeUrl } from "../client.js";
import type { StoreError } from "../errors.js";

import { readOwnerProfile, upsertVoiceCohort } from "./client.js";
import type { VoiceCohort } from "./types.js";

/** What the write does inside its transaction, each step bound to that transaction. */
export interface VoiceRegisterSteps {
  /** Whether the owner's row exists — the register's rows hang off it by foreign key — or why it could not be read. */
  readonly readOwnerPresent: () => Promise<Result<boolean, string>>;
  /** Replace one cohort with a measured one. */
  readonly upsertCohort: (args: { cohort: VoiceCohort }) => Promise<Result<true, string>>;
  /** Rebuild the context cache the send door reads, from this transaction's own rows. */
  readonly refreshCache: () => Promise<Result<unknown, string>>;
}

/** An open store the register is written through. */
export interface VoiceRegisterTarget {
  /** Run `body` in one transaction: it commits when `body` resolves, and a `body` that throws rolls it back. */
  readonly transact: <T>(args: { body: (steps: VoiceRegisterSteps) => Promise<T> }) => Promise<T>;
  readonly close: () => Promise<void>;
}

/** Rebuild the context cache over one transaction, given the connection string it records. */
type RefreshCacheOver = (args: { client: StoreReader; url: string }) => Promise<Result<unknown, string>>;

/**
 * Open the store this home selected as a {@link VoiceRegisterTarget}.
 *
 * @param home the Slopweaver home whose remembered store selection is read
 * @param refreshCache how the cache is rebuilt inside the transaction (the caller owns where it lives)
 * @param env the environment the selection is read from; absent for the process's own
 * @returns the open target, or the store's refusal — `STORE_URL_MISSING` when this home selected none
 */
export async function openVoiceRegisterTarget({
  home,
  refreshCache,
  env,
}: {
  home: string;
  refreshCache: RefreshCacheOver;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<Result<VoiceRegisterTarget, StoreError>> {
  const selection = env === undefined ? { home } : { env, home };
  const url = storeUrl(selection);
  if (url.isErr()) {
    return err(url.error);
  }
  const connected = await connectStore(selection);
  if (connected.isErr()) {
    return err(connected.error);
  }
  const client = connected.value;
  return ok({
    close: () => client.close(),
    transact: ({ body }) =>
      client.db.transaction((tx) =>
        body({
          readOwnerPresent: async () => {
            const owner = await readOwnerProfile({ client: { db: tx } });
            if (owner.isOk()) {
              return ok(true);
            }
            return owner.error.code === "PROFILE_ABSENT" ? ok(false) : err(owner.error.message);
          },
          refreshCache: () => refreshCache({ client: { db: tx }, url: url.value }),
          upsertCohort: async ({ cohort }) => (await upsertVoiceCohort({ cohort, db: tx })).mapErr((e) => e.message),
        }),
      ),
  });
}
