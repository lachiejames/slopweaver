/**
 * `session spend --finding`'s one write: the board finding row a pass with something to show earns, registered
 * through `handover register`, and nothing at all for a steady pass — a finding posts only when it
 * has a win to show, never a status.
 */
import { slopweaverHome } from "../../../config.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { workspaceRegisterArgv } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { spendFindingAsk } from "../../../sessions/spendRender.js";
import type { SpendReport } from "../../../sessions/spendReport.js";
import { hasSomethingToShow, type SpendSignal } from "../../../sessions/spendSignal.js";
import { EXIT_OK } from "../../exitCodes.js";
import { registerAskRow } from "../handover/askRowRun.js";

/** The state home the finding's checkout is resolved under: what `--home` named, else this install's. */
function stateHomeOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * Who observed the finding. A scheduled row runs with no session in its environment, so the verb names itself
 * rather than a session that did not exist.
 */
function observerOf(): string {
  const session = currentSessionId({ env: process.env });
  if (session === undefined) {
    return "slopweaver session spend";
  }
  return session;
}

/** Register the one board finding row, returning `handover register`'s exit code. */
async function postFinding({
  report,
  signal,
  evidence,
  home,
}: {
  report: SpendReport;
  signal: SpendSignal;
  evidence: string;
  home: string | undefined;
}): Promise<number> {
  const checkout = checkoutForRunningRepo({ home: stateHomeOf({ home }), verb: "session spend" });
  return registerAskRow({
    origin: "automation",
    argv: [
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      spendFindingAsk({ report, signal }),
      "--finding",
      "--evidence",
      evidence,
      "--observed-by",
      observerOf(),
      ...workspaceRegisterArgv({
        stated: { because: "the spend of this installation's own Claude and Codex plans", workspace: "self" },
      }),
      ...(checkout.isOk() ? ["--repo", checkout.value] : []),
      ...(home === undefined ? [] : ["--home", home]),
    ],
    out: logger.out,
  });
}

/**
 * What `--finding` did: nothing asked, nothing to show, a row written, or a registration that failed.
 *
 * @param asked whether the caller passed `--finding`
 * @param report the pass's document
 * @param signal its verdict, which decides whether there is anything to show
 * @param evidence the row's evidence pointer, naming the reading this pass records
 * @param home the state home `--home` named, if any
 * @returns the outcome, which the reading records as posted keys only when `registered`
 */
export async function findingOutcome({
  asked,
  report,
  signal,
  evidence,
  home,
}: {
  asked: boolean;
  report: SpendReport;
  signal: SpendSignal;
  evidence: string;
  home: string | undefined;
}): Promise<"not-asked" | "nothing-to-show" | "registered" | "failed"> {
  if (!asked) {
    return "not-asked";
  }
  if (!hasSomethingToShow({ signal })) {
    logger.error({ msg: "session spend: nothing to show — steady trend and no new drain, so no finding" });
    return "nothing-to-show";
  }
  const code = await postFinding({ evidence, home, report, signal });
  if (code !== EXIT_OK) {
    logger.error({ msg: `session spend: the finding was NOT registered (handover register exited ${String(code)})` });
    return "failed";
  }
  return "registered";
}
