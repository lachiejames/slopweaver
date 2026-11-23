/**
 * Keeping a card on the owner's queue because a settle said so — the effectful half of a KEPT restore
 * (`./cardLanding.ts` § "A KEPT restore is scoped to one relay, and holds").
 *
 * Unlike `talk restore`, this writes whether or not a landing is active: a relay's landing failing is not fatal to
 * the relay (`../cli/commands/talk/relayCardLand.ts`'s `landRelayCard`), and the landing may yet arrive late, which the
 * kept row is what stops. It is idempotent against the latest keep of the same relay's card, so a settle retried after the
 * row write failed appends nothing twice, and flushes what it found before the row is built on it.
 */
import { err, type Result } from "../lib/result.js";

import type { CardRestoredRow } from "./cardLanding.js";
import type { CardLandingError } from "./cardLandingErrors.js";
import { appendCardLanding, flushCardLandings, holdCardLandingLock, readCardLandings } from "./cardLandingStore.js";

/**
 * Record that a settle kept this card up, lifting only the one relay's landings on it.
 *
 * @param cardKey the card kept
 * @param relayAnchor the relay's `talk:<turnId>`, the restore's anchor
 * @param workSlug the settled row, which that relay's landings point at
 * @param why why the card stays, as the settle said it
 * @param nowIso the write clock
 * @returns `kept` when the row was written, `already-kept` when this exact keep was on file
 */
export function keepCardForRelay({
  home,
  cardKey,
  relayAnchor,
  workSlug,
  why,
  nowIso,
}: {
  home: string;
  cardKey: string;
  relayAnchor: string;
  workSlug: string;
  why: string;
  nowIso: string;
}): Result<"kept" | "already-kept", CardLandingError> {
  const lock = holdCardLandingLock({ home });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    const ledger = readCardLandings({ home });
    if (ledger.isErr()) {
      return err(ledger.error);
    }
    // The LATEST keep of this relay's card decides, so a reason changed back (A, B, A) writes its row again.
    const latest = ledger.value.rows.findLast(
      (row) =>
        row.kind === "restored" &&
        row.disposition === "kept" &&
        row.cardKey === cardKey &&
        row.anchor === relayAnchor &&
        row.workSlug === workSlug,
    );
    if (latest?.kind === "restored" && latest.why === why) {
      // Found on disk is not on the device: an append whose fsync failed is visible and losable.
      return flushCardLandings({ home }).map(() => "already-kept" as const);
    }
    const row: CardRestoredRow = {
      anchor: relayAnchor,
      atIso: nowIso,
      cardKey,
      disposition: "kept",
      kind: "restored",
      why,
      workSlug,
    };
    return appendCardLanding({ home, row }).map(() => "kept" as const);
  } finally {
    lock.value();
  }
}
