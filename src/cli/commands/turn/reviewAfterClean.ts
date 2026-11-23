/**
 * NO SECOND REVIEWER ROUND AFTER A CLEAN ONE — `turn review` refuses to boot a reviewer onto an answer whose
 * previous round already came back `clean`, and prints the code diff of the two answer files instead.
 *
 * ## The measured cost
 *
 * Ask `C0SYN000005-1789443736.519609`: round 1 came back `clean` carrying two LOW-impact nits, the
 * worker edited the answer, the edit voided the verdict (it binds the answer's digest), and round 2 booted
 * to return `clean` again — 5.7 to 23.2 minutes a round, median 12, over a day's public turns.
 * Reproduce: `for v in "$SLOPWEAVER_HOME"/live/slack/reviews/C0SYN000005-1789443736.519609/verdict*.json; do
 * jq -c '{outcome,unsupported:[.claims[]|select(.support!="supported")|.impact]}' "$v"; done`. `skills/loop-bot/reference/posting.md` already said a clean verdict means POST and the
 * low-impact residue is advisory; nothing enforced it, and this is the enforcement.
 *
 * ## Why it refuses rather than carrying the verdict across
 *
 * The alternative reading of "settle it by a code diff" is to rebind the clean verdict onto the edited bytes.
 * That writes a reviewer's approval onto an answer no reviewer read — a two-word edit can turn 7 into 30 — which
 * is the laundering `live/turn/answerChange.ts`'s header forbids. So the diff is printed as EVIDENCE for the
 * worker: every path it moved since the clean round, computed from the two files, beside the reviewed file and
 * the verdict that already clears it. Posting that file costs nothing; the round it replaces cost twelve minutes.
 *
 * The hatch exists for posting.md's own exception: a low-impact claim that is materially WRONG is not polish,
 * and fixing it is worth the round.
 */
import { join } from "node:path";

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { answerChangeLines } from "../../../live/turn/answerChange.js";
import type { CarriedForward } from "../../../live/turn/reviewRounds.js";
import { previousAnswerChanges, reviewedAnswerFileName, reviewPaths } from "../../../live/turn/reviewStore.js";

/**
 * The refusal lines when the outgoing round was `clean`, or nothing when a further round is warranted.
 *
 * @param answer the answer the caller wants reviewed again
 * @param askIdentity the ask being reviewed
 * @param env the environment the hatch is read from
 * @param home the resolved state home
 * @param inherited what the outgoing round left — its outcome and the digest its verdict bound
 * @returns the lines to print and refuse on — empty when the round may open
 */
export function reviewAfterCleanRefusal({
  answer,
  askIdentity,
  env,
  home,
  inherited,
}: {
  answer: unknown;
  askIdentity: AskIdentity;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  inherited: Pick<CarriedForward, "previousOutcome" | "round" | "settledDigest">;
}): readonly string[] {
  if (inherited.previousOutcome !== "clean" || inherited.settledDigest === undefined) {
    return [];
  }
  // The LITERAL variable, because `src/devLint/escapeHatch.ts` checks a row's `reader` names it in this file.
  if (env["SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN"] === "1") {
    return [];
  }
  const paths = reviewPaths({ askIdentity, home });
  const reviewed = join(paths.dir, reviewedAnswerFileName({ digest: inherited.settledDigest }));
  const changes = previousAnswerChanges({ answer, askIdentity, home, inherited });
  return [
    `round ${String(inherited.round - 1)} of review for this ask came back CLEAN, bound to ${inherited.settledDigest}.`,
    "Its low-impact residue is advisory (skills/loop-bot/reference/posting.md), and editing the answer voided it.",
    ...answerChangeLines({ changes }).filter((line) => line.length > 0),
    `Post the answer that verdict cleared — ${reviewed} — on your usual turn answer line with --verdict ${paths.verdict}`,
    ...hatchRefusalLines({
      detail: `round ${String(inherited.round - 1)} was clean`,
      hatch: hatchFor({ id: "review-after-clean" }),
    }),
  ];
}
