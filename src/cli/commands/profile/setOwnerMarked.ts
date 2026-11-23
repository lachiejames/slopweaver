/**
 * `profile set`'s write, under the owner-written mark: the local evidence that their profile exists, which the
 * `profile-held` hold and the door's profile-load gate read to tell a first boot from a home that lost their profile
 * (`../../../admit/ownerProfileWritten.ts`). Its own module because it is its own seam — a lock, a mark in every
 * home a first boot is read across, and a retraction proven against the store — beside a verb shell that only parses.
 */
import { type OwnerMarkedWrite, writeUnderOwnerMark } from "../../../admit/ownerProfileWrite.js";
import { machineDefaultHomes } from "../../../admit/profileFirstBoot.js";
import { slopweaverHome } from "../../../config.js";
import { storeFingerprint } from "../../../context/cache.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { accountDefaultHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { StoreClient } from "../../../store/client.js";
import { readOwnerProfile, writeOwnerProfile } from "../../../store/profile/client.js";
import type { OwnerSelfDescription } from "../../../store/profile/types.js";

/**
 * What `profile set` says on stderr about its mark: why the owner row was not written under it, and which marks a
 * failed write left behind.
 *
 * @param marked what the marked write came to
 * @returns one line per refusal or kept mark, none for a write that left nothing to say
 */
export function ownerMarkLines({ marked }: { marked: OwnerMarkedWrite<unknown, unknown> }): readonly string[] {
  if (marked.kind === "locked") {
    return [
      `profile set: refused, because another profile write holds the owner-write lock; run it again once that one finishes (${marked.reason})`,
    ];
  }
  const failed =
    marked.kind === "refused"
      ? marked.failed.map(
          (home) =>
            `profile set: refused, because ${home} cannot take the owner-written mark or a session's first-boot mark (a plain file where ${home}/profile or one of its directories belongs, a full disk, or no write permission); a profile no mark names reads as a first boot there, so a session would act on it unloaded. Nothing is held meanwhile. Free that home and run it again`,
        )
      : [];
  const kept = marked.kept.map(
    (path) =>
      `profile set: the owner-written mark at ${path} stays although the write failed, because the store could not confirm whether their row exists or the mark could not be removed; run profile set again, or once a reload finds no row, remove it`,
  );
  return [...failed, ...kept];
}

/**
 * Write the owner row pinned to the store's current revision, marked BEFORE the write and refused without the mark, so
 * no row exists this machine does not know of. A mark this call made is retracted only when the store proves no row,
 * so no mark claims one that is not there, all under one lock in the account's own home. Every refusal is printed.
 *
 * @param client the open store
 * @param url the store's URL, fingerprinted into the mark
 * @param displayName the row's display name
 * @param personId the identity-register row they are, when the file names one
 * @param selfDescription the parsed self-description the row carries
 * @returns the revision the row now stands at, or `undefined` once the refusal has been printed
 */
export async function writeOwnerRowMarked({
  client,
  url,
  displayName,
  personId,
  selfDescription,
}: {
  client: StoreClient;
  url: string;
  displayName: string;
  personId: string | null;
  selfDescription: OwnerSelfDescription;
}): Promise<number | undefined> {
  const defaults = machineDefaultHomes();
  if (defaults.isErr()) {
    logger.error({
      msg: `profile set: refused, because the account's own home could not be named, so no mark there can say this profile exists: ${defaults.error.message}`,
    });
    return undefined;
  }
  const marked = await writeUnderOwnerMark({
    homes: [slopweaverHome(), ...defaults.value],
    lockHome: accountDefaultHome(),
    nowIso: new Date().toISOString(),
    rowState: async () => {
      const after = await readOwnerProfile({ client });
      if (after.isOk()) {
        return "present";
      }
      return after.error.code === "PROFILE_ABSENT" ? "absent" : "unknown";
    },
    sessionIds: currentSessionIds({ env: process.env }),
    store: storeFingerprint({ url }),
    write: async () => {
      const current = await readOwnerProfile({ client });
      const expectedRevision = current.isOk() ? current.value.revision : 0;
      return writeOwnerProfile({ client, displayName, expectedRevision, personId, selfDescription });
    },
  });
  for (const msg of ownerMarkLines({ marked })) {
    logger.error({ msg });
  }
  if (marked.kind === "locked" || marked.kind === "refused") {
    return undefined;
  }
  if (marked.result.isErr()) {
    logger.error({ msg: marked.result.error.message });
    return undefined;
  }
  return marked.result.value;
}
