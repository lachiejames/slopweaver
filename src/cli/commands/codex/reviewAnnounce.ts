/**
 * What `codex review` says on stderr before its first model call: the scope it is about to judge, and any
 * property among those about to run that this branch has been chasing (`src/codex/propertyChase.ts`).
 *
 * The chase belongs HERE, before the spend, because this is the one moment the session deciding whether a
 * run is worth buying is guaranteed to be reading. It is best-effort by design: the reading refuses nothing,
 * so a record scan that fails says so in one line and the review goes ahead exactly as it would have.
 */

import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { chaseLines, propertyChases } from "../../../codex/propertyChase.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { readBranchLedger } from "./branchLedgerRead.js";

/**
 * The lines naming the diff about to be reviewed, then any chase among the properties about to run.
 *
 * @param count how many properties the fan-out will run
 * @param diff the frozen diff every property reads
 * @param concurrency how many run at once
 * @param branch the branch the diff's tree was captured on — `null` on a detached HEAD, `undefined` when the
 *   checkout moved mid-capture; either way there is no branch history to read
 * @param propertyIds the property ids about to run, so a chase on some other property stays out of the way
 * @param fallbackPort where the Claude fallback receipts are read; an outage skips the chase, never the review
 * @param supersessions the register of retired passes, which ends a chase a retirement replaced
 * @returns the lines to print on stderr, in order — never empty, the scope line always first
 */
export async function reviewAnnounceLines({
  branch,
  concurrency,
  count,
  diff,
  fallbackPort,
  home,
  propertyIds,
  supersessions,
}: {
  branch: string | null | undefined;
  concurrency: number;
  count: number;
  diff: { readonly bytes: number; readonly repoRoot: string; readonly sha256: string };
  fallbackPort: FallbackRegisterPort;
  home: string;
  propertyIds: readonly string[];
  supersessions: SupersessionPort;
}): Promise<readonly string[]> {
  const scope =
    `reviewing ${String(count)} propert${count === 1 ? "y" : "ies"} over ${String(diff.bytes)} bytes of diff ` +
    `(sha256 ${diff.sha256.slice(0, 12)}…), ${String(concurrency)} at a time`;
  if (branch == null) {
    return [scope];
  }
  // The same fold `codex status` and the landing floor read, so a Claude fallback receipt that ended a chase
  // ends it here too and the two verbs can never disagree about one branch (found by the review of this code).
  const ledger = await readBranchLedger({ branch, fallbackPort, home, repoRoot: diff.repoRoot, supersessions });
  if (ledger.isErr()) {
    return [scope, `property-chase reading skipped — ${ledger.error.message}`];
  }
  const running = new Set(propertyIds);
  const chases = propertyChases({ entries: ledger.value }).filter((chase) => running.has(chase.propertyId));
  return [scope, ...chaseLines({ chases })];
}
