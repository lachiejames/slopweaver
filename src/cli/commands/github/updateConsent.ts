/**
 * The two consent steps `github pr update` takes between the rendered body and the door, in order: the
 * settled-evidence check (`./settledEvidenceGate.ts`), then a wholesale replacement's preview and its key.
 *
 * The order is the point. `SLOPWEAVER_ALLOW_PR_REPLACE=1` consents to discarding whatever a form cannot carry,
 * and it is exactly what a rollout sets when a pull request's screenshots become links — so the
 * evidence a settled ask of the owner's named is judged first, on every mode, and that key never reaches it.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import { unifiedPatch } from "../../../lib/textDiff.js";
import type { PrForm } from "../../../outbound/github/types.js";
import { ownerRepoOf } from "./addressRun.js";
import type { GithubPrArgs } from "./core.js";
import type { GithubPrDeps } from "./prDeps.js";
import { judgeSettledEvidence, type SettledEvidenceDecision } from "./settledEvidenceGate.js";
import { ALLOW_PR_REPLACE, replaceDecisionFor } from "./updateCore.js";

/**
 * Run both consent steps and say whether the update stops here, having printed why.
 *
 * @param args the parsed CLI arguments, read for `--dry-run`
 * @param body the exact bytes the write would send
 * @param form the form as previewed, whose title a replacement may change
 * @param home the state home whose board and grant journal are read
 * @param live the pull request as read before the door
 * @param wholesale whether the write replaces the description whole, which alone takes the replacement key
 * @returns true when the run must stop with a refusal
 */
export function consentStops({
  args,
  body,
  deps,
  form,
  home,
  live,
  wholesale,
}: {
  args: GithubPrArgs;
  body: string;
  deps: GithubPrDeps;
  form: PrForm;
  home: string;
  live: WrittenPr;
  wholesale: boolean;
}): boolean {
  // The door's re-read refuses a body that moved since `live` was read, so judging against `live` holds at the PATCH.
  const evidence = judgeSettledEvidence({
    env: deps.env,
    home,
    liveBody: live.body,
    newBody: body,
    nowIso: deps.now().toISOString(),
    pull: { ...ownerRepoOf({ fullName: live.baseRepoFullName }), number: live.number },
  });
  if (evidenceStops({ decision: evidence, dryRun: args.dryRun, out: deps.out })) {
    return true;
  }
  if (!wholesale) {
    return false;
  }
  // The diff prints on BOTH paths; the KEY is demanded only when a write would follow.
  const stopped = previewReplacement({ body, deps, enforce: !args.dryRun, form, live });
  if (stopped === undefined) {
    return false;
  }
  deps.out({ line: `refused: ${stopped}` });
  return true;
}

/**
 * Print the settled-evidence decision and say whether the write stops on it.
 *
 * A dry run prints a refusal as the finding a real write would meet and carries on to its preview, exactly as
 * {@link previewReplacement} treats its consent: a preview that exits non-zero on a command that sends nothing
 * reads to a bot turn as a failure. An unreadable board stops a dry run too, because it is a fact about the
 * home rather than a policy a real write would meet.
 *
 * @returns true when the run must stop here
 */
function evidenceStops({
  decision,
  dryRun,
  out,
}: {
  decision: SettledEvidenceDecision;
  dryRun: boolean;
  out: GithubPrDeps["out"];
}): boolean {
  if (decision.kind === "clear") {
    return false;
  }
  if (decision.kind === "overridden") {
    out({ line: decision.notice });
    return false;
  }
  if (decision.kind === "unreadable") {
    out({ line: `refused: ${decision.reason}` });
    return true;
  }
  if (dryRun) {
    out({ line: "dry run finding: a real update would refuse:" });
    for (const line of decision.refusal.split("\n")) {
      out({ line });
    }
    return false;
  }
  out({ line: `refused: ${decision.refusal}` });
  return true;
}

/**
 * Show what a wholesale replacement would discard, then decide whether it may proceed.
 *
 * The patch goes to STDERR, before the door and before any write. Keeping it off stdout is what lets a caller
 * pipe the outcome while a human watching the terminal still sees the bytes about to be lost — GitHub keeps no
 * history of a description, so this is the only place they exist.
 *
 * It takes its KEY only when a write would follow: under `--dry-run` the diff prints and the run stops cleanly,
 * because nothing is being consented to. The earlier shape demanded the key on a dry run too, which meant the
 * only safe way to inspect a replacement was to first set the variable that authorises the unsafe one — and it
 * exited non-zero on a command that provably sends nothing, so a bot turn read its own preview as a failure.
 *
 * @returns a refusal reason, or undefined when the replacement may go ahead
 */
function previewReplacement({
  live,
  form,
  body,
  deps,
  enforce,
}: {
  live: WrittenPr;
  form: PrForm;
  body: string;
  deps: GithubPrDeps;
  enforce: boolean;
}): string | undefined {
  const bodyPatch = unifiedPatch({
    after: body,
    before: live.body,
    what: `github://${live.baseRepoFullName}/pull/${String(live.number)}/body`,
  });
  const titlePatch =
    live.title === form.title ? undefined : `title: ${JSON.stringify(live.title)} -> ${JSON.stringify(form.title)}`;
  for (const line of [titlePatch, bodyPatch].filter((part): part is string => part !== undefined)) {
    deps.err({ line });
  }
  const decided = replaceDecisionFor({
    allowReplace: !enforce || deps.env({ name: ALLOW_PR_REPLACE }) === "1",
    unchanged: bodyPatch === undefined && titlePatch === undefined,
  });
  if (!enforce) {
    return undefined;
  }
  if (decided.kind === "refused") {
    return decided.reason;
  }
  deps.out({ line: decided.notice });
  return undefined;
}
