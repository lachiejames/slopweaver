/**
 * The two content gates `linear comment` runs over a comment before anything is recorded — the above-the-fold
 * gate on its summary and the bare-reference gate on what linkifying could not resolve. Split out of
 * `./commentRun.ts`, which runs them on both the dry-run and the live path, so the verb file holds the phases.
 */
import { linearCommentAboveFoldCells } from "../../../outbound/linear/aboveFold.js";
import type { LinearCommentForm } from "../../../outbound/linear/commentTypes.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import type { LinearCommentArgs } from "./commentCore.js";
import type { LinearCommentWriteDeps } from "./commentDeps.js";
import { summaryAboveFoldRefused } from "./summaryAboveFold.js";

/**
 * The above-the-fold gate on the comment's summary, which is its whole message above the fold.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param artifact the validated comment
 * @param deps the injected door ledger, environment reader and output sink
 * @returns true when the write must refuse
 */
export async function commentAboveFoldRefused({
  args,
  artifact,
  deps,
}: {
  args: LinearCommentArgs;
  artifact: LinearCommentForm["artifact"];
  deps: Pick<LinearCommentWriteDeps, "doorLedger" | "env" | "out">;
}): Promise<boolean> {
  return summaryAboveFoldRefused({ args, cells: linearCommentAboveFoldCells({ artifact }), deps });
}

/**
 * Refuse whatever `#N`/`owner/repo#N`/`SUP-123` in the comment linkifying could not resolve into a real
 * link — see `../../bareRefDoor.ts`.
 *
 * @param dryRun whether this invocation stops before every effect, so the gate reports rather than refuses
 * @param issues the residue `linkifyCommentArtifact` already computed
 * @param deps the injected environment reader and output sink
 * @param home the state home this invocation resolved, whose grant journal decides the hatch
 * @returns true when the write must refuse
 */
export function commentBareRefRefused({
  dryRun,
  issues,
  deps,
  home,
}: {
  dryRun: boolean;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: Pick<LinearCommentWriteDeps, "env" | "out">;
  home: string;
}): boolean {
  return bareRefGateRefused({
    dryRun,
    env: deps.env,
    home,
    issues: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    out: ({ line }) => {
      deps.out(line);
    },
  });
}
