/**
 * Recording who a person says the first conversation about a candidate is with — the effectful half of
 * `./whoFirst.ts`.
 *
 * Under the ledgers' lock (`./ledgerLock.ts`), as every candidates ledger write is, so a re-mine cannot drop the candidate between the
 * check and the append. A repeat of the standing answer appends nothing.
 */
import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { candidateById, readWhoFirstRows } from "./candidateStore.js";
import type { ReactionVia } from "./candidates.js";
import { appendLedgerRows } from "./ledgerAppend.js";
import { underLedgerLock } from "./ledgerLock.js";
import { latestWhoFirst, type WhoFirstRow, whoFirstRowSchema } from "./whoFirst.js";

/** What one `recordWhoFirst` call did. */
export interface WhoFirstReceipt {
  readonly row: WhoFirstRow;
  /** False when the same answer already stood, so nothing was appended. */
  readonly appended: boolean;
}

/** What one call asked to record. */
interface WhoFirstAsked {
  /** The instant the owner said it, which is also the lock's clock. */
  readonly nowIso: string;
  readonly candidateId: string;
  /** The people the first conversation is with, by name. */
  readonly people: readonly string[];
  /** The owning team, or `null` when none was named. */
  readonly team: string | null;
  readonly via: ReactionVia;
  readonly bySession: string;
}

/**
 * Record who the first conversation about one candidate is with, and the team that owns it, in the state home given
 * or the resolved one.
 *
 * @returns what was written, or why nothing was
 */
export async function recordWhoFirst({
  home,
  ...asked
}: WhoFirstAsked & { home?: string }): Promise<Result<WhoFirstReceipt, CandidatesError>> {
  return underLedgerLock({
    home,
    nowIso: asked.nowIso,
    run: async ({ locked }) => whoFirstUnderLock({ ...asked, home: locked }),
  });
}

/**
 * The critical section {@link recordWhoFirst} runs once it holds the lock.
 *
 * @returns what was written, or why nothing was
 */
function whoFirstUnderLock({
  home,
  nowIso,
  candidateId,
  people,
  team,
  via,
  bySession,
}: WhoFirstAsked & { home: string }): Result<WhoFirstReceipt, CandidatesError> {
  const found = candidateById({ candidateId, home, refusal: CandidatesErrors.amendmentRefused });
  if (found.isErr()) {
    return err(found.error);
  }
  const candidate = found.value;
  const parsed = whoFirstRowSchema.safeParse({
    bySession,
    candidate: candidate.id,
    iso: nowIso,
    name: candidate.name,
    people,
    team,
    via,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return err(CandidatesErrors.amendmentRefused({ problems }));
  }
  const rows = readWhoFirstRows({ home });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const standing = latestWhoFirst({ rows: rows.value }).get(candidate.id);
  const row = parsed.data;
  const repeat =
    standing !== undefined && standing.team === row.team && standing.people.join("\n") === row.people.join("\n");
  if (repeat) {
    return ok({ appended: false, row });
  }
  return appendLedgerRows({
    path: stateHomePaths({ home }).workstreamsWhoFirstJsonl,
    refusal: CandidatesErrors.amendmentRefused,
    rows: [row],
    schema: whoFirstRowSchema,
  }).map(() => ({ appended: true, row }));
}
