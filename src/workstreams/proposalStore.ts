/**
 * Recording a workstream a person proposes in their own words — the effectful half of `./proposals.ts`.
 *
 * Under the ledgers' lock (`./ledgerLock.ts`), so two proposals cannot take one id. A proposal said beside a candidate must name one the
 * catalog carries — a stated one or a mined one; one proposed outright needs no candidate at all, so a person can
 * say what they want before any mining has run.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { readCandidateCatalog, readProposalRows } from "./candidateStore.js";
import { appendLedgerRows } from "./ledgerAppend.js";
import { underLedgerLock } from "./ledgerLock.js";
import { nextProposalId, type ProposalRow, proposalRowSchema } from "./proposals.js";

const DIR_MODE = 0o700;

/**
 * Record one proposal.
 *
 * @param home the state home, the resolved one when absent
 * @param nowIso the instant it was proposed, which is also the lock's clock
 * @param asked the proposal as said: its title, the candidate it was said beside (`null` for one outright), how it
 *   relates, why, and where the owner said it
 * @returns the row written, or why nothing was
 */
export async function recordProposal({
  home,
  nowIso,
  asked,
}: {
  home?: string;
  nowIso: string;
  asked: Omit<ProposalRow, "id" | "iso">;
}): Promise<Result<ProposalRow, CandidatesError>> {
  return underLedgerLock({
    home,
    nowIso,
    run: async ({ locked }) => proposeUnderLock({ asked, home: locked, nowIso }),
  });
}

/**
 * The critical section {@link recordProposal} runs once it holds the lock.
 *
 * @returns the row written, or why nothing was
 */
function proposeUnderLock({
  asked,
  home,
  nowIso,
}: {
  asked: Omit<ProposalRow, "id" | "iso">;
  home: string;
  nowIso: string;
}): Result<ProposalRow, CandidatesError> {
  if (asked.from !== null) {
    const from = asked.from;
    const catalog = readCandidateCatalog({ home });
    if (catalog.isErr()) {
      return err(catalog.error);
    }
    if (!catalog.value.candidates.some((one) => one.id === from)) {
      return err(CandidatesErrors.amendmentRefused({ problems: [`no candidate has the id ${from}`] }));
    }
  }
  const rows = readProposalRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const path = stateHomePaths({ home }).workstreamsProposalsJsonl;
  try {
    // A proposal may come before any candidate was mined, so the directory may not exist yet.
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
  } catch (error: unknown) {
    return err(CandidatesErrors.writeFailed({ cause: errorMessage({ error }), path }));
  }
  return appendLedgerRows({
    path,
    refusal: CandidatesErrors.amendmentRefused,
    rows: [{ ...asked, id: nextProposalId({ rows: rows.value }), iso: nowIso }],
    schema: proposalRowSchema,
  }).map((written) => written[0]!);
}
