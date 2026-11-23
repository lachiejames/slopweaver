/**
 * The real journal and the real spawn behind `claude watch`'s drawdown pass.
 *
 * Its own module because it is the one place the pass meets the filesystem and cmux, and the tick itself
 * (`claude/drawdownTick.ts`) takes these as injected dependencies so it stays testable. The tick's contract is
 * `readonly string[]` for a failure — it only ever prints them — so each typed `ClaudeError` is mapped to its
 * lines exactly once, here.
 */
import { claudeErrorLines } from "../../../claude/claudeErrors.js";
import { spawnDrawdownInvestigation } from "../../../claude/drawdownInvestigation.js";
import { appendDrawdownJournal, readDrawdownJournal } from "../../../claude/drawdownJournalStore.js";
import type { DrawdownTickDeps } from "../../../claude/drawdownTick.js";
import { currentBranch } from "../../../codex/gitDiff.js";

/**
 * This checkout's branch, or a placeholder — the plan records it and nothing branches on it, so a repository
 * that cannot answer must not stop an investigation opening.
 *
 * @returns the branch name, or `unknown`
 */
function currentBranchOrUnknown(): string {
  const resolved = currentBranch({ cwd: process.cwd() });
  if (resolved.isErr() || resolved.value === null) {
    return "unknown";
  }
  return resolved.value;
}

/**
 * The real journal and the real spawn.
 *
 * The spawn goes through `cmux spawn`, which opens a VISIBLE interactive workspace — rule 2's requirement,
 * and the shape the owner asked for when they described the supervisor noticing a spike and opening a session
 * to look into it.
 */
export const PRODUCTION_DRAWDOWN_DEPS: DrawdownTickDeps = {
  appendJournal: (input) => appendDrawdownJournal(input).mapErr((error) => claudeErrorLines({ error })),
  openInvestigation: async ({ incident, nowIso }) =>
    (
      await spawnDrawdownInvestigation({
        branch: currentBranchOrUnknown(),
        incident,
        nowIso,
        repoRoot: process.cwd(),
      })
    ).mapErr((error) => claudeErrorLines({ error })),
  readJournal: (input) => readDrawdownJournal(input).mapErr((error) => claudeErrorLines({ error })),
};
