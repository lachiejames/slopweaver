/**
 * The branch fold the review verbs read before they spend: Codex pass records, Claude fallback receipts and the
 * supersession register, folded by `ledgerForBranch` — the same fold `codex status` and the landing floor read,
 * so the verbs about to review and the verbs about to land can never disagree about one branch.
 *
 * Read by `./reviewAnnounce.ts` (the property-chase lines), which skips them on a failed read, and
 * `./reviewCapGate.ts` (the two-pass cap), which refuses on one. Each displays the error's `message`.
 */

import { fallbackLedgerEntries } from "../../../codex/fallbackPlan.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { type LedgerEntry, ledgerForBranch } from "../../../codex/ledger.js";
import { scanPassRecords } from "../../../codex/ledgerStore.js";
import { incompleteScanReason } from "../../../codex/scanReasons.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

/** Which of the three sources the fold reads could not be read, so a caller can say which. */
export interface BranchLedgerReadError {
  readonly code:
    "PASS_RECORDS_UNREADABLE" | "FALLBACK_RECEIPTS_UNREADABLE" | "SUPERSESSIONS_UNREADABLE" | "LEDGER_INCOMPLETE";
  readonly message: string;
}

/** The factories {@link readBranchLedger} builds its one failure through. */
const BranchLedgerReadErrors = {
  fallbackReceiptsUnreadable: ({ cause }: { cause: string }): BranchLedgerReadError => ({
    code: "FALLBACK_RECEIPTS_UNREADABLE",
    message: `the fallback receipts could not be read: ${cause}`,
  }),
  ledgerIncomplete: ({ cause }: { cause: string }): BranchLedgerReadError => ({
    code: "LEDGER_INCOMPLETE",
    message: cause,
  }),
  passRecordsUnreadable: ({ cause }: { cause: string }): BranchLedgerReadError => ({
    code: "PASS_RECORDS_UNREADABLE",
    message: `the pass records could not be read: ${cause}`,
  }),
  supersessionsUnreadable: ({ cause }: { cause: string }): BranchLedgerReadError => ({
    code: "SUPERSESSIONS_UNREADABLE",
    message: cause,
  }),
} as const;

/**
 * Fold one branch's ledger from every review source on disk.
 *
 * @param branch the branch the diff's tree was captured on
 * @param fallbackPort where the Claude fallback receipts are read
 * @param home the state home holding the pass records
 * @param repoRoot the checkout the diff came from, so another clone's branch of the same name stays out
 * @param supersessions the register of retired passes
 * @returns the branch's entries newest first, or the one line naming which read failed
 */
export async function readBranchLedger({
  branch,
  fallbackPort,
  home,
  repoRoot,
  supersessions,
}: {
  branch: string;
  fallbackPort: FallbackRegisterPort;
  home: string;
  repoRoot: string;
  supersessions: SupersessionPort;
}): Promise<Result<readonly LedgerEntry[], BranchLedgerReadError>> {
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (scan.isErr()) {
    return err(BranchLedgerReadErrors.passRecordsUnreadable({ cause: scan.error.message }));
  }
  const receipts = await fallbackPort.scan({ home });
  if (receipts.isErr()) {
    return err(BranchLedgerReadErrors.fallbackReceiptsUnreadable({ cause: receipts.error.message }));
  }
  // Said, never read as "nothing retired" — that would count a retired row's verdict as standing.
  const retired = await supersessions.read({ home });
  if (retired.isErr()) {
    return err(BranchLedgerReadErrors.supersessionsUnreadable({ cause: retired.error.message }));
  }
  const ledger = ledgerForBranch({
    branch,
    fallbackEntries: fallbackLedgerEntries({ branch, now: undefined, repoRoot, scan: receipts.value }),
    now: undefined,
    records: scan.value.records,
    repoRoot,
    supersessions: retired.value,
  });
  // A scan can SUCCEED and still skip a malformed record, which would fold as no pass at all. The landing floor
  // refuses on exactly this reason, so the verbs about to review read it the same way.
  const incomplete = incompleteScanReason({
    branch,
    ledger,
    receipts: receipts.value,
    repoRoots: new Set([repoRoot]),
    scan: scan.value,
  });
  if (incomplete !== undefined) {
    return err(BranchLedgerReadErrors.ledgerIncomplete({ cause: incomplete }));
  }
  return ok(ledger.entries);
}
