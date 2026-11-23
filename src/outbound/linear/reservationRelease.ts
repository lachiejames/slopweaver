/**
 * Releasing a create reservation the write never sent — the one way a Linear ledger record is ever removed.
 *
 * Every create reserves its caller-chosen id locally, with `O_EXCL`, before the mutation (`./issueLedger.ts`,
 * `./projectLedger.ts`, `./documentLedger.ts`, `./commentLedger.ts`). A mutation a guard refused before the wire
 * (`./sendFailure.ts`) definitely sent nothing, and a reservation kept for it would refuse the corrected retry as a
 * duplicate. So the invocation that took the reservation releases it, and only it: the record must still be the
 * one THIS invocation wrote — the same id, the same reservation instant, and never confirmed. A confirmed record,
 * one another run reserved, or one that cannot be read is left exactly where it is.
 *
 * ## Claim, then judge: never judge, then delete by path
 *
 * Every ledger write replaces a record by an atomic rename, so a check followed by an unlink of the PATH can remove a
 * record another process confirmed in between. The release therefore first renames the record aside to a name no
 * other process uses — an atomic move of whichever record is current at that instant — and judges the file it holds,
 * with the ledger's own parser. Its own unconfirmed reservation is deleted; anything else goes back with `link`,
 * which never overwrites: when a newer record has taken the path meanwhile, that newer record supersedes the claimed
 * one, as any atomic replace would have. A confirm landing after the claim writes the path afresh and is never
 * touched.
 *
 * The residue: while a claimed record that is NOT this invocation's own is out of place, before the link puts it
 * back, its path is empty, so a reservation of the same id in that window would succeed.
 */
import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync } from "node:fs";

import { isRecord } from "../../lib/parsers.js";

/** The fields every ledger's record carries that a release compares. */
interface ReservedRecord {
  readonly id: string;
  readonly reservedIso: string;
  readonly confirmedIso?: string | undefined;
}

/** The two points a test may place a concurrent ledger write at. */
type ReleaseStage = "before-claim" | "after-claim";

/** A test's seam, called before and after the claim, where a concurrent confirm is placed. */
export type ReleaseInterleave = (input: { readonly stage: ReleaseStage }) => void;

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
 * The claimed file read through the ledger's own parser, or undefined when it cannot be read or parsed.
 *
 * @param claimed the aside name the record was renamed to
 * @param parse the ledger's parser for one record's text
 * @returns the record, or undefined
 */
function readClaimed({
  claimed,
  parse,
}: {
  claimed: string;
  parse: (input: { raw: string }) => ReservedRecord | undefined;
}): ReservedRecord | undefined {
  try {
    return parse({ raw: readFileSync(claimed, "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Remove one ledger record when it is still this invocation's own unconfirmed reservation.
 *
 * @param path the record's file
 * @param parse the ledger's parser for one record's text, undefined for text it cannot read
 * @param id the id this invocation reserved
 * @param reservedIso the instant this invocation reserved it at; undefined when it reserved nothing (an update),
 *   which matches no record
 * @param interleave a test's seam, called before and after the claim
 * @returns true when this invocation's own reservation was removed; false when nothing of its own was
 */
export function releaseUnconfirmedRecord({
  path,
  parse,
  id,
  reservedIso,
  interleave,
}: {
  path: string;
  parse: (input: { raw: string }) => ReservedRecord | undefined;
  id: string;
  reservedIso: string | undefined;
  interleave?: ReleaseInterleave | undefined;
}): boolean {
  if (reservedIso === undefined) {
    return false;
  }
  const claimed = `${path}.releasing-${randomUUID()}`;
  interleave?.({ stage: "before-claim" });
  try {
    renameSync(path, claimed);
  } catch {
    return false;
  }
  interleave?.({ stage: "after-claim" });
  const record = readClaimed({ claimed, parse });
  const own = record?.id === id && record.reservedIso === reservedIso && record.confirmedIso === undefined;
  if (!own) {
    restoreClaimed({ claimed, path });
    return false;
  }
  rmSync(claimed, { force: true });
  return true;
}
