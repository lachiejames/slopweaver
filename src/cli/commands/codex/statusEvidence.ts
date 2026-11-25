/**
 * What `codex status` reads before it judges anything: the pass records, the Claude fallback receipts and the
 * register of retired passes. Split out of `./statusRun.ts` along the seam between READING the evidence and
 * rendering or enforcing it, so each source's failure is one place.
 */

import { readBranchEvidence } from "../../../codex/branchContinuityGit.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { type LedgerScan, scanPassRecords } from "../../../codex/ledgerStore.js";
import type { Supersession } from "../../../codex/supersession.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * Both scans a status read needs and the register of retired passes, or the exit code to stop on.
 *
 * The register is read BEFORE the report and before `--check`, so `SLOPWEAVER_ALLOW_UNREVIEWED` cannot wave
 * it through: a register that cannot be read leaves which passes are retired UNKNOWN, and both answers would
 * be guesses. Both scans come back as `branch` should see them: a pass a proven predecessor of it recorded is
 * shown under its name (`../../../codex/branchContinuityView.ts`), so the table and `--check` read a renamed
 * branch's passes exactly as the landing verbs do.
 *
 * @param branch the branch being reported
 * @param fallbackPort where the Claude fallback receipts are read; an outage stops the verb
 * @param home the state home whose `orchestration` directory holds the pass records
 * @param repoRoot the checkout whose reflogs say which branches `branch` continues
 * @param supersessions the register of retired passes; an outage stops the verb
 * @returns the three readings, or `EXIT_ERROR` once the failing source has been logged
 */
export async function readStatusEvidence({
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
}): Promise<
  | {
      readonly scan: LedgerScan;
      readonly receipts: FallbackReceiptScan;
      readonly retired: ReadonlyMap<string, Supersession>;
    }
  | number
> {
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (scan.isErr()) {
    logger.error({ msg: `codex status: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const receipts = await fallbackPort.scan({ home });
  if (receipts.isErr()) {
    logger.error({ msg: `codex status: ${receipts.error.message}` });
    return EXIT_ERROR;
  }
  const retired = await supersessions.read({ home });
  if (retired.isErr()) {
    logger.error({ msg: `codex status: ${retired.error.message}` });
    return EXIT_ERROR;
  }
  const evidence = readBranchEvidence({ branch, cwd: repoRoot, receipts: receipts.value, scan: scan.value });
  if (evidence.isErr()) {
    logger.error({ msg: `codex status: ${evidence.error.message}` });
    return EXIT_ERROR;
  }
  return { ...evidence.value, retired: retired.value };
}
