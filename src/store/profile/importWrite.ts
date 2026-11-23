/**
 * Writing an imported owner profile inside the caller's transaction — the writer `store import --apply` calls.
 *
 * The import carries the three PORTABLE fields only (`../transfer/decode.ts`'s `PortableOwnerProfile` says why
 * `personId`, `revision` and `updatedAt` never travel), and all three are written: `writeOwnerProfile` in
 * `./client.ts` writes no `judgementProfile`, so an import through it would drop the mined profile on the floor.
 * A live row keeps its own `personId` and moves one revision on; a store that never held one gets it at revision 1.
 *
 * No revision pin, unlike `./client.ts`'s writers: the apply transaction has already locked the table and planned the
 * import against the row it reads here, so there is no other writer for a pin to catch.
 */
import { eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { parseJudgementProfile } from "../../live/turn/judgementProfile.js";
import type { StoreWriter } from "../client.js";
import { StoreErrors } from "../errors.js";
import { OWNER_PROFILE_ID, ownerProfileTable } from "../schema/ownerProfile.js";
import type { PortableOwnerProfile } from "../transfer/decode.js";

import { upsertVoiceCohort } from "./client.js";
import { parseOwnerSelfDescription } from "./core.js";
import { type ProfileError, ProfileErrors } from "./errors.js";
import type { VoiceCohort } from "./types.js";

/**
 * Write one imported voice cohort through the apply transaction, after the owner row it hangs off exists.
 *
 * @param writer the apply transaction
 * @param cohort the imported cohort, already decoded by the export's strict parser
 * @returns the one row written, or `PROFILE_QUERY_FAILED`
 */
export async function writeImportedVoiceCohort({
  writer,
  cohort,
}: {
  writer: StoreWriter;
  cohort: VoiceCohort;
}): Promise<Result<number, ProfileError>> {
  const written = await upsertVoiceCohort({ cohort, db: writer });
  return written.map(() => 1);
}

/**
 * Write the imported owner profile's three portable fields, creating the row or moving it one revision on.
 *
 * @param writer the apply transaction
 * @param profile the imported profile, whose two payloads are parsed again here into the types their columns hold
 * @returns the revision now stored, or `PAYLOAD_INVALID` for a payload its schema refuses, or `PROFILE_QUERY_FAILED`
 */
export async function writeImportedOwnerProfile({
  writer,
  profile,
}: {
  writer: StoreWriter;
  profile: PortableOwnerProfile;
}): Promise<Result<number, ProfileError>> {
  const selfDescription = parseOwnerSelfDescription({ value: profile.selfDescription });
  if (selfDescription.isErr()) {
    return err(selfDescription.error);
  }
  let judgementProfile = null;
  if (profile.judgementProfile !== null) {
    const judged = parseJudgementProfile({ value: profile.judgementProfile });
    if (judged.isErr()) {
      return err(ProfileErrors.payloadInvalid({ issues: judged.error }));
    }
    judgementProfile = judged.value;
  }
  const portable = { displayName: profile.displayName, judgementProfile, selfDescription: selfDescription.value };
  try {
    const [live] = await writer
      .select({ revision: ownerProfileTable.revision })
      .from(ownerProfileTable)
      .where(eq(ownerProfileTable.id, OWNER_PROFILE_ID));
    if (live === undefined) {
      await writer.insert(ownerProfileTable).values({ ...portable, id: OWNER_PROFILE_ID, personId: null, revision: 1 });
      return ok(1);
    }
    const revision = live.revision + 1;
    await writer
      .update(ownerProfileTable)
      .set({ ...portable, revision, updatedAt: new Date() })
      .where(eq(ownerProfileTable.id, OWNER_PROFILE_ID));
    return ok(revision);
  } catch (cause) {
    return err(
      ProfileErrors.queryFailed({ cause: StoreErrors.queryFailed({ cause, what: "imported owner profile write" }) }),
    );
  }
}
