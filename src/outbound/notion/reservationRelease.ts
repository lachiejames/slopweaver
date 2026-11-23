/**
 * Releasing a create reservation the write never sent — the one way a Notion intent record is ever removed.
 *
 * `notion page create` reserves its intent locally, with `O_EXCL`, before `pages.create` (`./pageLedger.ts`'s
 * `reserveIntent`). A create the transport refused before the wire (`./sendFailure.ts`) definitely sent nothing, and
 * a reservation kept for it would refuse the reworded retry the refusal asks for as a duplicate. So the invocation
 * that took the reservation releases it, and only it: the record must still be the one THIS invocation wrote — the
 * same intent, the same reservation instant, never confirmed and naming no page. A confirmed record, one another run
 * reserved, or one that cannot be read is left exactly where it is.
 *
 * ## Claim, then judge: never judge, then delete by path
 *
 * Every ledger write replaces the record by an atomic rename, so a check followed by an unlink of the PATH can
 * remove a record another process confirmed in between. The release therefore first renames the record aside to a
 * name no other process uses — an atomic move of whichever record is current at that instant — and judges the file
 * it holds. Its own unconfirmed reservation is deleted; anything else goes back with `link`, which never overwrites:
 * when a newer record has taken the path meanwhile, that newer record supersedes the claimed one, as any atomic
 * replace would have. A confirm landing after the claim writes the path afresh and is never touched.
 *
 * The residue: while a claimed record that is NOT this invocation's own is out of place, before the link puts it
 * back, its path is empty, so a reservation of the same intent in that window would succeed.
 */
import { randomUUID } from "node:crypto";
import { linkSync, renameSync, rmSync } from "node:fs";

import { isRecord } from "../../lib/parsers.js";
import { intentRecordPath, readClaimedRecord } from "./pageLedger.js";

/** The two points a test may place a concurrent ledger write at. */
export type ReleaseStage = "before-claim" | "after-claim";

/**
 * Put a claimed record back at its path unless a newer one has taken it, then drop the claimed copy. A link that
 * fails for any other reason leaves the claimed copy on disk rather than losing a record.
 *
 * @param claimed the aside name the record was renamed to
 * @param path the ledger path it came from
 */
function restoreClaimed({ claimed, path }: { claimed: string; path: string }): void {
  try {
    linkSync(claimed, path);
  } catch (error: unknown) {
    if (!(isRecord(error) && error["code"] === "EEXIST")) {
      return;
    }
  }
  rmSync(claimed, { force: true });
}

/**
 * Remove one intent record when it is still this invocation's own unconfirmed reservation.
 *
 * @param home the state home the ledger lives under
 * @param intent the intent digest this invocation reserved
 * @param reservedIso the instant this invocation's fresh reservation was taken at
 * @param interleave a test's seam, called before and after the claim, where a concurrent confirm is placed
 * @returns true when this invocation's own reservation was removed; false when nothing of its own was
 */
export function releaseIntentReservation({
  home,
  intent,
  reservedIso,
  interleave,
}: {
  home: string;
  intent: string;
  reservedIso: string;
  interleave?: ((input: { readonly stage: ReleaseStage }) => void) | undefined;
}): boolean {
  const path = intentRecordPath({ home, intent });
  const claimed = `${path}.releasing-${randomUUID()}`;
  interleave?.({ stage: "before-claim" });
  try {
    renameSync(path, claimed);
  } catch {
    return false;
  }
  interleave?.({ stage: "after-claim" });
  const record = readClaimedRecord({ path: claimed });
  const own =
    record?.intent === intent &&
    record.reservedIso === reservedIso &&
    record.confirmedIso === undefined &&
    record.pageId === undefined;
  if (!own) {
    restoreClaimed({ claimed, path });
    return false;
  }
  rmSync(claimed, { force: true });
  return true;
}
