/**
 * `github stack push`'s render-and-gate step: the PR-format gate and the above-fold gate over the body about to be
 * created, judged with the installation's own identifiers for the target read once here and carried forward on the
 * plan, so the create is gated with exactly the value its preview was.
 */
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { reportedInstallationIdentifiers } from "../../../outbound/github/installationIdentifiersRead.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import type { AboveFoldVerdict } from "../../aboveFoldDoor.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { aboveFoldVerdictOrReported } from "./aboveFoldGate.js";
import { previewCreateBody } from "./prRenderGate.js";
import type { GithubStackPushArgs } from "./stackPushCore.js";
import type { GithubStackPushDeps } from "./stackPushDeps.js";

/** What the body gates carry forward: the above-fold verdict, and the identifiers the PR gate forgave. */
export interface StackPushBodyVerdict {
  readonly aboveFold: AboveFoldVerdict;
  readonly installationIdentifiers: InstallationIdentifiers | undefined;
}

/**
 * The two body gates, which a dry run PRINTS rather than refuses on — that is what a preview is for. The
 * live path still refuses, so a body either gate rejects can never be sent.
 *
 * @param args the parsed invocation, whose `dryRun` decides print-versus-refuse
 * @param deps the installation reader, the environment reader the above-fold override needs, and the output sink
 * @param form the linkified form about to be rendered
 * @param home the state home the operator's voice profile and the installation's identifiers live under
 * @returns the verdict to carry forward, or `EXIT_ERROR` once a refusal has been printed
 */
export async function stackPushBodyVerdict({
  args,
  deps,
  form,
  home,
}: {
  args: GithubStackPushArgs;
  deps: GithubStackPushDeps;
  form: PrFormDraft;
  home: string;
}): Promise<Result<StackPushBodyVerdict, number>> {
  const { owner, repo } = form.target;
  const installationIdentifiers = await reportedInstallationIdentifiers({
    deps,
    home,
    targetRepository: `${owner}/${repo}`,
  });
  const rendered = previewCreateBody({ draft: form, home, installationIdentifiers, now: deps.now });
  if (!args.dryRun && !rendered.ok) {
    deps.out({ line: `refused: the rendered body fails the PR gate: ${rendered.errors.join("; ")}` });
    return err(EXIT_ERROR);
  }
  const aboveFold = await aboveFoldVerdictOrReported({
    env: deps.env,
    form,
    home,
    ledger: deps.doorLedger,
    out: deps.out,
    refuseFindings: !args.dryRun,
  });
  return aboveFold === undefined ? err(EXIT_ERROR) : ok({ aboveFold, installationIdentifiers });
}
