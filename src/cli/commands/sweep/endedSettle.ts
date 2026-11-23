/**
 * `sweep board --settle-ended` — the one verdict the board sweep ACTS on by itself: a live Queue ask whose question
 * names only pull requests that have ended (`PR_ENDED`, `../../../sweep/endedPullRequest.ts`).
 *
 * ## Why this verdict, and no other, is automatic
 *
 * The owner must be able to look at the Queue at any moment and see exactly their ranked priorities, so
 * a card asking them to close a pull request GitHub had already closed is dropped by the sweep. Every other act the
 * sweep routes stays one row at a time on a session's word (`sweep apply`), because its witness is a judgement — a
 * probe that may pass for the wrong reason, or a decline that is the owner's alone. This one's witness is GitHub's own
 * record of the merge commit or the close instant, so settling it is obvious to anyone who knows them: rule 10's
 * "do it, recorded".
 *
 * ## What bounds it
 *
 * - **`answered`, never `declined`** — `landingClosure.ts`'s reasoning: the pull request ending answers the ask.
 * - **Capped per pass** at {@link ENDED_SETTLE_CAP}, so a scheduled pass can never become a wave; the rest are
 *   printed and the next pass takes them.
 * - **Re-judged at the write**: the settle runs with `endedQuestionPrecondition` over the row as it reads when the
 *   bytes are spliced, so a row whose question changed, or a seat picked up, or one paused, after the board was read
 *   is left. Residue, shared with the landing closure: a lifecycle verb journals a run's start without the row lock,
 *   so a start landing between that read and the atomic write is not seen. The window is the one synchronous
 *   read-then-write with nothing awaited in it (`../handover/settleRowWrite.ts`), and closing it would mean every
 *   run-journal writer taking the row lock.
 * - **Journalled twice**: the sweep ledger row (`sweep list`, the rail that makes what the sweep took findable),
 *   then the autonomy ledger row the Fleet Briefing's "done for you, without asking" section reads.
 */
import { createHash } from "node:crypto";

import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { logger } from "../../../lib/logger.js";
import { type Result } from "../../../lib/result.js";
import { endedQuestionPrecondition } from "../../../review/closureRowState.js";
import { closureSettleArgv } from "../../../review/landingClosure.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import { actId, type SweepJournalRow } from "../../../sweep/journalRow.js";
import { appendSweepRow, sweepLedgerPath } from "../../../sweep/journalStore.js";
import { settleAskRow } from "../handover/settleRowRun.js";

/** The most rows one pass settles. A pass that finds more prints the rest for the next one. */
export const ENDED_SETTLE_CAP = 25;

/** The session name every automatic act is recorded under. */
const ENDED_SETTLE_SESSION = "sweep board --settle-ended";

/** The autonomy kind an automatic settle is recorded as. */
const AUTONOMY_KIND = "settle-ended-pull-request-ask";

/** The seams the automatic settle writes through. */
export interface EndedSettleDeps {
  /** Settle one row through `handover settle`, re-judged at the write against the question it was judged on. */
  readonly settleRow: (args: { argv: readonly string[]; question: string }) => Promise<number>;
  /** Append one sweep ledger row. */
  readonly appendLedger: (args: { row: SweepJournalRow }) => Result<void, { readonly message: string }>;
  /** Append one autonomy row, answering the failure's message, or undefined when it was written. */
  readonly recordAutonomy: (args: { row: AutonomyActionRow }) => Promise<string | undefined>;
  readonly nowIso: () => string;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The autonomy action id for one row — derived from its slug, so a retried record of the same settle is the same id.
 *
 * @param slug the row settled
 * @returns a register-valid id
 */
function autonomyActionId({ slug }: { slug: string }): string {
  return `sweep-pr-ended-${createHash("sha256").update(slug).digest("hex").slice(0, 16)}`;
}

/**
 * Settle one `PR_ENDED` row, then journal it on both ledgers.
 *
 * @param candidate the row
 * @param home the state home the board lives under
 * @param deps the writes
 * @returns `journalled` when settled and recorded on both ledgers, `settled` when a ledger write failed after the
 *   settle, `left` when the settle itself refused
 */
async function settleOne({
  candidate,
  home,
  deps,
}: {
  candidate: SweepCandidate;
  home: string;
  deps: EndedSettleDeps;
}): Promise<"journalled" | "settled" | "left"> {
  if (candidate.question === undefined) {
    deps.writeDiagnostic(`sweep board: --settle-ended left ${candidate.slug}: its verdict carries no judged question`);
    return "left";
  }
  const argv = closureSettleArgv({ home, slug: candidate.slug, witness: candidate.witness });
  const verbLine = `slopweaver handover settle ${candidate.slug} --as answered --witness <the witness below>`;
  const code = await deps.settleRow({ argv, question: candidate.question });
  if (code !== 0) {
    deps.writeDiagnostic(
      `sweep board: --settle-ended left ${candidate.slug}: \`handover settle\` exited ${String(code)}, its own lines above name why`,
    );
    return "left";
  }
  const atIso = deps.nowIso();
  const row: SweepJournalRow = {
    act: "settle",
    atIso,
    id: actId({ atIso, slug: candidate.slug }),
    path: candidate.path,
    session: ENDED_SETTLE_SESSION,
    slug: candidate.slug,
    verbLine,
    verdict: candidate.verdict,
    witness: candidate.witness,
  };
  const journalled = deps.appendLedger({ row });
  if (journalled.isErr()) {
    // The settle already landed, so this row is the only surviving record of what was taken and why.
    deps.writeDiagnostic(`sweep board: settled ${candidate.slug}, but ${journalled.error.message} — the act was:`);
    deps.writeDiagnostic(`  ${row.id} ${row.verdict}/${row.act} ${row.slug} — ${row.witness}`);
    return "settled";
  }
  return (await recordAutonomy({ atIso, candidate, deps })) ? "journalled" : "settled";
}

/**
 * Record one automatic settle on the autonomy ledger, printing — never throwing — a row that would not write.
 *
 * @param candidate the row settled
 * @param atIso when it was settled
 * @param deps the autonomy write and the diagnostic channel
 * @returns true when the autonomy row was written
 */
async function recordAutonomy({
  candidate,
  atIso,
  deps,
}: {
  candidate: SweepCandidate;
  atIso: string;
  deps: EndedSettleDeps;
}): Promise<boolean> {
  const built = buildAutonomyAction({
    actionId: autonomyActionId({ slug: candidate.slug }),
    bySession: ENDED_SETTLE_SESSION,
    doneIso: atIso,
    kind: AUTONOMY_KIND,
    run: candidate.slug,
    said: "I took a stale card off your Queue: every pull request it asked you about had already been merged or closed on GitHub.",
    steer: undefined,
    subject: candidate.slug,
    why: "GitHub records every pull request the card's question names as merged or closed, so nothing it asked is still open; superseded cards leave the Queue by themselves",
    witness: `slopweaver handover settle ${candidate.slug} --as answered — ${candidate.witness}`,
  });
  if (built.isErr()) {
    deps.writeDiagnostic(
      `sweep board: settled ${candidate.slug}, but its autonomy row would not build: ${built.error.message}`,
    );
    return false;
  }
  const failure = await deps.recordAutonomy({ row: built.value });
  if (failure !== undefined) {
    deps.writeDiagnostic(`sweep board: settled ${candidate.slug}, but its autonomy row did not write: ${failure}`);
    return false;
  }
  return true;
}

/**
 * Settle every `PR_ENDED` candidate, one row at a time, up to {@link ENDED_SETTLE_CAP}.
 *
 * @param candidates every row the pass classified
 * @param home the state home the board lives under
 * @param deps the writes
 * @returns the slugs settled, in order, and how many settles were attempted — a settle that exited non-zero may still
 *   have written its row (a mirror failing after the write), so the caller re-reads the board after ANY attempt
 */
export async function settleEndedRows({
  candidates,
  home,
  deps,
}: {
  candidates: readonly SweepCandidate[];
  home: string;
  deps: EndedSettleDeps;
}): Promise<{ readonly settled: readonly string[]; readonly attempted: number }> {
  const ended = candidates.filter((candidate) => candidate.verdict === "PR_ENDED");
  const settled: string[] = [];
  let attempted = 0;
  for (const [index, candidate] of ended.entries()) {
    if (index >= ENDED_SETTLE_CAP) {
      deps.writeDiagnostic(
        `sweep board: --settle-ended reached its cap of ${String(ENDED_SETTLE_CAP)} — ${candidate.slug} is the next pass's`,
      );
      continue;
    }
    attempted += 1;
    const outcome = await settleOne({ candidate, deps, home });
    if (outcome !== "left") {
      settled.push(candidate.slug);
    }
    if (outcome !== "journalled") {
      // A refused settle or an unwritten ledger is a fault the next row would meet too, so the pass stops on it.
      deps.writeDiagnostic("sweep board: --settle-ended stopped at the first failure — the next pass resumes");
      break;
    }
  }
  deps.writeDiagnostic(
    `sweep board: --settle-ended settled ${String(settled.length)} of ${String(ended.length)} PR_ENDED row(s) — slopweaver sweep list names each`,
  );
  return { attempted, settled };
}

/**
 * The real writes over one home: `handover settle` re-judged at the write, the sweep ledger and the autonomy ledger.
 * Every line goes to stderr, so `--json` keeps stdout to the findings.
 *
 * @param home the state home both ledgers live under
 * @returns the production dependencies for {@link settleEndedRows}
 */
export function productionEndedSettleDeps({ home }: { home: string }): EndedSettleDeps {
  const toStderr = ({ line }: { line: string }): void => {
    logger.error({ msg: line });
  };
  return {
    appendLedger: ({ row }) => appendSweepRow({ path: sweepLedgerPath({ home }), row }).map(() => undefined),
    nowIso: () => new Date().toISOString(),
    recordAutonomy: async ({ row }) => {
      const written = await autonomyLedgerPort().appendRecord({ home, record: row });
      return written.isErr() ? written.error.message : undefined;
    },
    settleRow: ({ argv, question }) =>
      settleAskRow({ argv, out: toStderr, precondition: endedQuestionPrecondition({ question }) }),
    writeDiagnostic: (line) => {
      toStderr({ line });
    },
  };
}
