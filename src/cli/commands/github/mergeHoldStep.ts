/**
 * The merge hold's step in `slopweaver github merge`: consult the hold, print what it has to say, and report
 * whether this invocation is refused. `./mergeRun.ts` runs it first, before the repository is resolved; this
 * module holds only the step and how its lines read.
 */
import { holdFor, mergeHoldGate } from "../../../outbound/github/mergeHold.js";
import { type MergeHoldDeps, noteStaleHolds } from "./holdDeps.js";
import type { GithubMergeArgs } from "./mergeArgs.js";

/**
 * Consult the merge hold, printing whatever it has to say and reporting whether this invocation is refused.
 *
 * It runs BEFORE the repository is resolved and before git is shelled at all, deliberately: a session that
 * has been told to wait should learn that in one cheap file read, not after a `git merge-tree` and a board
 * sweep. It is also the observation that publishes a stale hold's warning — see `./holdDeps.ts`'s header for
 * why nothing polls.
 *
 * An `--admin --dry-run` judges the same gate over the RAW read and refuses on nothing it says: it writes nothing,
 * so it never notes a stale hold (that publishes and rewrites the document), and a hold another pull request
 * holds is someone landing NOW — transient, so a lap asking whether its own landing could go ahead is told, not
 * stopped. The real landing judges the hold again, and refuses on it then; a lap refused there keeps its posted
 * green, which `github lap --land-only` lands once the hold clears, so the lap was not wasted. A precondition that
 * would waste the lap — a stack member, a draft, a review rule — refuses in both modes.
 *
 * @param args this invocation's parsed arguments
 * @param deps the hold's own edges and the output sink
 * @param home the state home holding the document
 * @returns whether the merge is refused by a standing hold
 */
export function refusedByHold({
  args,
  deps,
  home,
}: {
  args: Pick<GithubMergeArgs, "dryRun" | "number" | "repo">;
  deps: { readonly hold: MergeHoldDeps; readonly out: (args: { line: string }) => void };
  home: string;
}): boolean {
  const read = deps.hold.readHolds({ home });
  const holds = args.dryRun ? read : noteStaleHolds({ deps: deps.hold, holds: read, home });
  const gate = mergeHoldGate({
    hold: holdFor({ holds, repo: args.repo }),
    nowIso: deps.hold.nowIso(),
    number: args.number,
  });
  const refused = gate.refused && !args.dryRun;
  for (const line of gate.lines) {
    deps.out({ line: holdLine({ dryRun: args.dryRun, line, refused: gate.refused }) });
  }
  return refused;
}

/**
 * One line the hold gate printed, prefixed by what it means for this invocation.
 *
 * @param refused whether the gate refused, before a dry run softened it
 * @returns the line as printed
 */
function holdLine({ dryRun, line, refused }: { dryRun: boolean; line: string; refused: boolean }): string {
  if (!refused) {
    return line;
  }
  return dryRun ? `note: landing preflight only — ${line}` : `refused: ${line}`;
}
