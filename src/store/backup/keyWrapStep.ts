/**
 * The key-wrap step every write to a destination opens with: the backup key's wrap under the master password lands
 * at the destination BEFORE any object, so no backup reaches a destination without the copy of its key a lost Mac
 * opens it with (`./keyWrapStore.ts`). With a list of destinations it runs once per destination, each on its own.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";
import { backupKeyWrapObjectName } from "./keyWrap.js";
import { KeyWrapErrors } from "./keyWrapErrors.js";
import { ensureBackupKeyWrap } from "./keyWrapStore.js";
import { keyFingerprint } from "./objectCrypto.js";
import { SUPABASE_PROJECT_ID } from "./plan.js";
import type { BackupTransport } from "./transport.js";

/**
 * What became of the backup key's wrap at one destination on one run: written (and where), or not written because
 * no master password is set — the state a lost Mac could not open this destination from, so the verb says it loudly.
 */
export type KeyWrapStatus =
  { readonly state: "written" | "present"; readonly objectName: string } | { readonly state: "no-master-password" };

/**
 * Make sure the plain destination holds the backup key's wrap, when a master password is set: written when absent,
 * opened and left untouched when present, and the write refused when a present wrap does not open with the password.
 *
 * @param destination the PLAIN destination — the wrap opens the key, so it cannot sit under it
 * @param key the backup key
 * @param masterPassword the password the verb read once, or `null` when none is set
 * @returns where the wrap is and whether this run wrote it, or that no password is set, or why the write must stop
 */
export async function keyWrapFor({
  destination,
  key,
  masterPassword,
}: {
  destination: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
}): Promise<Result<KeyWrapStatus, BackupError>> {
  if (masterPassword === null) {
    return ok({ state: "no-master-password" });
  }
  // The one boundary every wrap operation runs under: a destination that THROWS rather than returning its failure
  // breaks its own contract, and still reaches the caller as a reason line rather than a rejected run.
  // Named before the destination is touched, so a failure names the wrap this call checked.
  const objectName = backupKeyWrapObjectName({ fingerprint: keyFingerprint({ key }), project: SUPABASE_PROJECT_ID });
  let ensured: Awaited<ReturnType<typeof ensureBackupKeyWrap>>;
  try {
    ensured = await ensureBackupKeyWrap({
      key,
      password: masterPassword,
      project: SUPABASE_PROJECT_ID,
      transport: destination,
    });
  } catch (cause: unknown) {
    ensured = err(
      KeyWrapErrors.transportFailed({
        detail: `the destination threw: ${errorMessage({ error: cause })}`,
        objectName,
      }),
    );
  }
  if (ensured.isErr()) {
    return err(
      BackupErrors.stepFailed({
        // A wrap this call wrote before its read-back failed stays where it landed: removing it could delete the
        // equivalent wrap a racing run wrote, and the next run reads it back again.
        reasons: [
          `the backup key's wrap ${objectName} is not proven to open, so no backup object was sent: ${ensured.error.message}`,
        ],
      }),
    );
  }
  return ok(ensured.value);
}
