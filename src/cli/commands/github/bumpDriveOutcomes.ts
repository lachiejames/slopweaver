/**
 * What `github bump-drive` reports about one bump WITHOUT making a write — a cap reached, an act with nothing to
 * do, a ledger that cannot take the row an act owes the owner, and the whole of a dry run.
 *
 * Split out of `./bumpDriveActs.ts` at the 300-code-line cap, along the seam between the performers and the
 * outcomes that stop one: every function here answers before a child verb is called, so a dry run and a real
 * pass read the same refusal off the same code.
 */

import type { BumpPlan } from "../../../review/bumpSelection.js";
import type { BumpScheduleEntry } from "./bumpDriveCore.js";
import { type BumpDriveOutcome } from "./bumpDriveReport.js";
import type { GithubBumpDriveDeps } from "./bumpDriveRun.js";
import { BUMP_ENQUEUE_CAP, BUMP_REWRITE_CAP, BUMP_SEAT_CAP } from "./bumpDriveUsage.js";
import { boardHold } from "./landingRegister.js";

/**
 * The acts that perform no write at all, so a dry run and a real pass say exactly the same thing about them.
 *
 * `awaiting-human-review` is here rather than beside `seat` deliberately: a bump whose only remaining hold is
 * a code owner GitHub names is waiting on a colleague, and this machine's correct act is none — no press, no
 * undraft, and no board row nothing can clear (`../../../review/bumpSelection.ts`'s `awaitingHumanReview`).
 * It costs none of the three caps for the same reason.
 */
export const NO_ACT_ARMS: readonly BumpPlan["act"][] = [
  "nothing",
  "held",
  "awaiting-human-review",
  "review-withheld",
] as const;

/** Which acts write an autonomy row, and so are not made while the ledger cannot take one. */
const LEDGERED_ACTS: readonly BumpPlan["act"][] = ["enqueue", "undraft-and-enqueue", "rewrite-body"] as const;

/**
 * The identity fields every outcome for one bump carries, whatever happened to it.
 *
 * @param plan the bump's planned act, whose row and signal name it
 * @returns every outcome field but the detail and the outcome itself
 */
export function outcomeBase({ plan }: { plan: BumpPlan }): Omit<BumpDriveOutcome, "detail" | "outcome"> {
  return {
    act: plan.act,
    number: plan.row.number,
    repoSlug: plan.row.repoSlug,
    signal: plan.signal,
    url: plan.row.url,
  };
}

/** Which of the three caps bounds one act, and the word its outcome line counts in. */
function capFor({ plan }: { plan: BumpPlan }): { cap: number; counted: string } {
  if (plan.act === "seat") {
    return { cap: BUMP_SEAT_CAP, counted: "board row(s)" };
  }
  if (plan.act === "rewrite-body") {
    return { cap: BUMP_REWRITE_CAP, counted: "description rewrite(s)" };
  }
  return { cap: BUMP_ENQUEUE_CAP, counted: "enqueue(s)" };
}

/**
 * What a bump past one of this pass's three caps reports, rather than a silent omission.
 *
 * @param plan the bump the cap stopped
 * @returns a skipped outcome naming the cap and the act it counts
 */
export function cappedOutcome({ plan }: { plan: BumpPlan }): BumpDriveOutcome {
  const { cap, counted } = capFor({ plan });
  return {
    ...outcomeBase({ plan }),
    detail: `this pass's cap of ${String(cap)} ${counted} was already reached — the next firing takes it`,
    outcome: "skipped",
  };
}

/**
 * What an act that writes an autonomy row reports when the ledger cannot take one, or undefined when it can.
 *
 * Asked BEFORE the act, the same rail `github landing --press` keeps (`./landingPress.ts`'s `pressCandidate`):
 * an unasked act the owner's briefing could not show is not made. The ledger is the store, so a store that answers the
 * read is one that can take the row. What is left is the window between this check and the write after the
 * act, which the writer reports rather than hides.
 *
 * @param plan the act about to be made, whose word the refusal names
 * @param deps the injected edges, of which only `ledgerActs` is read
 * @param home the state home the ledger answers for
 * @returns a failed outcome naming the unmade act, or undefined when the ledger can take its row
 */
export async function ledgerRefusal({
  plan,
  deps,
  home,
}: {
  plan: BumpPlan;
  deps: Pick<GithubBumpDriveDeps, "ledgerActs">;
  home: string | undefined;
}): Promise<BumpDriveOutcome | undefined> {
  const ledger = await deps.ledgerActs({ home });
  if (ledger.isOk()) {
    return undefined;
  }
  return {
    ...outcomeBase({ plan }),
    detail: `not ${unmadeAct({ act: plan.act })}: the autonomy ledger could not be read (${ledger.error}), and an unasked act the owner's briefing could not show is not made`,
    outcome: "failed",
  };
}

/** The past participle a ledger refusal names for the write it held back. */
function unmadeAct({ act }: { act: BumpPlan["act"] }): string {
  if (act === "undraft-and-enqueue") {
    return "undrafted";
  }
  if (act === "rewrite-body") {
    return "rewritten";
  }
  return "pressed";
}

/**
 * What a dry run says about one scheduled entry.
 *
 * It answers from the SAME schedule a real pass runs, caps included, because a dry run that omitted the caps
 * would describe a pass nobody can actually get. The ledger rail is asked here too: a dry run promising an act
 * the real pass refuses would be lying about the one thing a dry run is for. Local and cheap, and only for an
 * act that writes a row.
 *
 * @param entry the bump, its planned act and whether this pass's caps reach it
 * @param deps the injected edges, of which only `ledgerActs` is read
 * @param home the state home the ledger lives under
 * @returns the outcome a real pass would report, as `would-act` where it would act
 */
export async function dryOutcome({
  entry,
  deps,
  home,
}: {
  entry: BumpScheduleEntry;
  deps: Pick<GithubBumpDriveDeps, "ledgerActs">;
  home: string | undefined;
}): Promise<BumpDriveOutcome> {
  const { plan } = entry;
  // The real pass's `seatOne` skips a seat the board already holds, so the dry run says so rather than `would seat`
  // — ahead of the cap, since a held seat spends none (`./bumpDriveCore.ts`'s `scheduleBumpActs`).
  const held = plan.act === "seat" ? boardHold({ row: plan.row }) : undefined;
  if (held !== undefined) {
    return { ...outcomeBase({ plan }), detail: held, outcome: "skipped" };
  }
  if (entry.capped) {
    return cappedOutcome({ plan });
  }
  if (NO_ACT_ARMS.includes(plan.act)) {
    return { ...outcomeBase({ plan }), detail: plan.why, outcome: "skipped" };
  }
  const refused = LEDGERED_ACTS.includes(plan.act) ? await ledgerRefusal({ deps, home, plan }) : undefined;
  if (refused !== undefined) {
    return refused;
  }
  return { ...outcomeBase({ plan }), detail: `would ${plan.act}: ${plan.why}`, outcome: "would-act" };
}
