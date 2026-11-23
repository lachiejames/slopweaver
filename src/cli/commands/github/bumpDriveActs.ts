/**
 * What `github bump-drive` DOES about one bump, act by act — the three performers and the outcome each returns.
 *
 * Split out of `./bumpDriveRun.ts` to stay under the 300-code-line cap, along the seam the verb
 * already has: `./bumpDriveRun.ts` reads the fleet, plans and prints, and every WRITE it makes is made here.
 * Each performer takes the injected seams, so a pass can be run whole against fakes. What a pass reports
 * WITHOUT writing — a cap, a no-act arm, the ledger rail, a dry run — is `./bumpDriveOutcomes.ts`.
 */

import type { DependencyBotActors } from "../../../organisation/dependencyBots.js";
import { prFormOfBump } from "../../../outbound/github/bumpBodyForm.js";
import { registrationSlug } from "../../../review/boardAtHead.js";
import type { BumpPlan } from "../../../review/bumpSelection.js";
import { DEV_GATE_CHECK } from "../../../review/gatingChecks.js";
import { EXIT_OK } from "../../exitCodes.js";
import {
  BUMP_REWRITE_HATCHES,
  type BumpScheduleEntry,
  bumpEnqueueArgv,
  bumpReadyArgv,
  bumpRegisterArgv,
  bumpRegistrationAsk,
  bumpRewriteArgv,
  type GithubBumpDriveArgs,
} from "./bumpDriveCore.js";
import {
  bumpBodyActionId,
  bumpBodyWasRecorded,
  bumpLedgerRow,
  bumpRewriteLedgerRow,
  bumpUndraftLedgerRow,
} from "./bumpDriveLedger.js";
import { cappedOutcome, dryOutcome, ledgerRefusal, NO_ACT_ARMS, outcomeBase } from "./bumpDriveOutcomes.js";
import { type BumpDriveOutcome } from "./bumpDriveReport.js";
import type { GithubBumpDriveDeps } from "./bumpDriveRun.js";
import { lostRowsClause, recordOccurrence } from "./landingPress.js";
import { boardHold } from "./landingRegister.js";

/** One `github enqueue`, plus the autonomy-ledger row rule 10 owes the owner for it. */
async function enqueueOne({
  plan,
  deps,
  home,
  quiet,
  undrafted,
}: {
  plan: BumpPlan;
  deps: GithubBumpDriveDeps;
  home: string | undefined;
  quiet: boolean;
  undrafted: boolean;
}): Promise<BumpDriveOutcome> {
  const refused = await ledgerRefusal({ deps, home, plan: { ...plan, act: "enqueue" } });
  if (refused !== undefined) {
    return undrafted ? { ...refused, detail: `undrafted, but ${refused.detail}` } : refused;
  }
  const code = await deps.press({ quiet, rest: bumpEnqueueArgv({ home, row: plan.row, signal: plan.signal }) });
  if (code !== EXIT_OK) {
    return {
      ...outcomeBase({ plan }),
      detail: undrafted
        ? "undrafted, but `github enqueue` refused it — its own findings are printed above, and it is now a NON-draft that did not queue"
        : "`github enqueue` refused it — its own findings are printed above",
      outcome: "failed",
    };
  }
  const atIso = deps.now().toISOString();
  const unregistered = await deps.recordPress({
    atIso,
    entryState: "",
    headOid: plan.row.headOid,
    home,
    number: plan.row.number,
    repoSlug: plan.row.repoSlug,
  });
  const unledgered = await recordOccurrence({
    deps,
    home,
    row: bumpLedgerRow({ atIso, bySession: deps.sessionRef(), plan }),
  });
  const queued = undrafted ? "undrafted it and enqueued it" : "enqueued it";
  const lost = lostRowsClause({ act: "act", unledgered, unregistered });
  if (lost !== undefined) {
    return { ...outcomeBase({ plan }), detail: `${queued}${lost}`, outcome: "acted" };
  }
  return { ...outcomeBase({ plan }), detail: `${queued}, and recorded it on the autonomy ledger`, outcome: "acted" };
}

/** One `github ready` followed by its enqueue, which is the act `github landing` had no word for. */
async function undraftAndEnqueue({
  plan,
  deps,
  home,
  quiet,
}: {
  plan: BumpPlan;
  deps: GithubBumpDriveDeps;
  home: string | undefined;
  quiet: boolean;
}): Promise<BumpDriveOutcome> {
  const refused = await ledgerRefusal({ deps, home, plan });
  if (refused !== undefined) {
    return refused;
  }
  const code = await deps.markReady({ quiet, rest: bumpReadyArgv({ home, row: plan.row }) });
  if (code !== EXIT_OK) {
    return {
      ...outcomeBase({ plan }),
      detail: "`github ready` refused the undraft — its own lines are printed above, so nothing was enqueued",
      outcome: "failed",
    };
  }
  const queued = await enqueueOne({ deps, home, plan, quiet, undrafted: true });
  if (queued.outcome !== "failed") {
    return queued;
  }
  // The undraft ALREADY HAPPENED, and `enqueueOne`'s ledger row is only written on a press that succeeded — so
  // without this the one act this pass took would exist nowhere the owner looks. This failed-press arm
  // is the one that writes it; `bumpUndraftLedgerRow` says why the happy path does not also write one.
  const unledgered = await recordOccurrence({
    deps,
    home,
    row: bumpUndraftLedgerRow({
      atIso: deps.now().toISOString(),
      bySession: deps.sessionRef(),
      plan,
      why: queued.detail,
    }),
  });
  if (unledgered === undefined) {
    return { ...queued, detail: `${queued.detail}; the undraft is on the autonomy ledger` };
  }
  return {
    ...queued,
    detail: `${queued.detail}; the undraft could not be written to the autonomy ledger either (${unledgered})`,
  };
}

/**
 * Whether one bump is still a draft, read off the landing test that already judged it.
 *
 * Off `row.tests` rather than a second field, because those verdicts are what the plan was built from — a
 * separate read could disagree with the ladder that chose this act. An absent verdict is treated as a draft:
 * this verb's population is renovate's drafts, and the form's `draft` field is recorded state rather than
 * something a description PATCH can change.
 */
function rowIsDraft({ row }: { row: BumpPlan["row"] }): boolean {
  const undrafted = row.tests.find((test) => test.id === "undrafted");
  if (undrafted === undefined) {
    return true;
  }
  return undrafted.verdict !== "pass";
}

/**
 * One description rewrite: the per-head guard, the composed form, the write, and the row that records it.
 *
 * The guard is read BEFORE the compose and the ledger row is written AFTER the write, which is the only order
 * that fails safely in both directions: a ledger this pass cannot read OR write stops the act (no record
 * means no bound, and an unbounded rewrite is the loop the guard exists to prevent), while a row that cannot
 * be written after a successful send — the window after that check — leaves the act done and unbounded,
 * reported as such, and held for one day by the child verb's own no-op check rather than by anything here.
 * The row is written once per head and never takes an occurrence ordinal, because a second rewrite at one
 * head is exactly what the guard refuses.
 *
 * A guard HIT seats the bump rather than only reporting it. The ladder is pure and cannot see the ledger, so
 * every later firing plans `rewrite-body` again on a head already rewritten; without the seat, a bump whose
 * `dev-gate` a description cannot fix would be named in a pass's output every four hours and never reach the
 * one board, which is the only register of what is in flight. The seat is idempotent — `seatOne` asks `./landingRegister.ts`'s `boardHold`, which
 * holds on a live row or one that ended at this head — and it spends this pass's REWRITE budget, not its seat budget.
 */
async function rewriteBodyOne({
  plan,
  bots,
  deps,
  home,
  quiet,
}: {
  plan: BumpPlan;
  bots: DependencyBotActors;
  deps: GithubBumpDriveDeps;
  home: string | undefined;
  quiet: boolean;
}): Promise<BumpDriveOutcome> {
  const actionId = bumpBodyActionId({ row: plan.row });
  const acted = await deps.ledgerActs({ home });
  if (acted.isErr()) {
    return {
      ...outcomeBase({ plan }),
      detail: `the AUTONOMY ledger could not be read (${acted.error}), and it is this act's only guard against rewriting the same body every firing — nothing was sent`,
      outcome: "failed",
    };
  }
  if (bumpBodyWasRecorded({ acts: acted.value, row: plan.row })) {
    const why =
      `${actionId} says this head's description was already rewritten, so ${DEV_GATE_CHECK} is red for ` +
      "something a description cannot fix";
    const seated = await seatOne({ bots, deps, home, plan: { ...plan, act: "seat", why }, quiet });
    return { ...seated, detail: `${why} — ${seated.detail}` };
  }
  const form = prFormOfBump({
    draft: rowIsDraft({ row: plan.row }),
    observedIso: deps.now().toISOString(),
    row: plan.row,
  });
  const code = await deps.rewriteBody({ argv: bumpRewriteArgv({ form, home, row: plan.row }), quiet });
  if (code !== EXIT_OK) {
    return {
      ...outcomeBase({ plan }),
      detail: `\`github pr update --form\` refused the rewrite — its own lines are printed above; the two hatches this act adds (${BUMP_REWRITE_HATCHES.join(", ")}) were open, so the refusal is a different one`,
      outcome: "failed",
    };
  }
  const hatched = `with ${BUMP_REWRITE_HATCHES.join(" and ")} added for that one call`;
  const unledgered = await deps.recordAutonomy({
    home,
    row: bumpRewriteLedgerRow({ atIso: deps.now().toISOString(), bySession: deps.sessionRef(), plan }),
  });
  if (unledgered !== undefined) {
    return {
      ...outcomeBase({ plan }),
      detail: `sent the typed bump form as its whole description ${hatched}, but the AUTONOMY ledger row could not be written (${unledgered}) — the act happened, the owner's briefing will not show it, and nothing now bounds a second rewrite at this head`,
      outcome: "acted",
    };
  }
  return {
    ...outcomeBase({ plan }),
    detail: `sent the typed bump form as its whole description ${hatched}; ${DEV_GATE_CHECK} re-runs on the edit, and ${actionId} on the autonomy ledger is the record and the one-per-head guard`,
    outcome: "acted",
  };
}

/** One board row for a bump that needs a session, through the verb that owns the board. */
async function seatOne({
  plan,
  bots,
  deps,
  home,
  quiet,
}: {
  plan: BumpPlan;
  bots: DependencyBotActors;
  deps: GithubBumpDriveDeps;
  home: string | undefined;
  quiet: boolean;
}): Promise<BumpDriveOutcome> {
  const slug = registrationSlug({ row: plan.row });
  const held = boardHold({ row: plan.row });
  if (held !== undefined) {
    return { ...outcomeBase({ plan }), detail: held, outcome: "skipped" };
  }
  // The row states its workspace off the organisation's repositories; one that will not read seats nothing.
  const organisation = await deps.readOrganisation({ home });
  if (organisation.isErr()) {
    return { ...outcomeBase({ plan }), detail: organisation.error.message, outcome: "failed" };
  }
  const checkout = deps.checkoutFor({ home, repoSlug: plan.row.repoSlug });
  const code = await deps.registerRow({
    argv: bumpRegisterArgv({
      askedIso: deps.now().toISOString(),
      bots,
      checkout,
      home,
      organisation: organisation.value,
      plan,
      slug,
      // The register gates the WHOLE ask, so the whole ask is what is asked about — a
      // title-only question could pass an `owner/repo#n` the gate then refused.
      withheld: deps.askUnrootable({
        ask: bumpRegistrationAsk({ bots, plan, withheld: false }),
        checkout,
        home,
      }),
    }),
    quiet,
  });
  if (code !== EXIT_OK) {
    // The exit code, and nothing about what caused it — `./landingRegister.ts`'s `registerOne` records why:
    // guessing "a slug that already exists" is how a shape-gate refusal on every row read as de-duplication.
    return {
      ...outcomeBase({ plan }),
      detail: `\`handover register\` exited ${String(code)} — its own lines are printed above and name the cause`,
      outcome: "failed",
    };
  }
  return { ...outcomeBase({ plan }), detail: `registered ${slug} on the one board`, outcome: "acted" };
}

/**
 * The one outcome for ONE scheduled entry — the whole act dispatch, so the loop around it stays a loop.
 *
 * Split out for the `cognitive-complexity` gate rather than to be reused: five acts and two pre-act states in
 * one function scored over the ceiling the moment `rewrite-body` joined them, and a dispatch that has to be
 * read alongside the sequencing of every other bump is exactly the shape that ceiling is about.
 */
async function performOne({
  entry,
  bots,
  deps,
  args,
  home,
}: {
  entry: BumpScheduleEntry;
  bots: DependencyBotActors;
  deps: GithubBumpDriveDeps;
  args: GithubBumpDriveArgs;
  home: string | undefined;
}): Promise<BumpDriveOutcome> {
  const { plan } = entry;
  if (entry.capped) {
    return cappedOutcome({ plan });
  }
  if (NO_ACT_ARMS.includes(plan.act)) {
    return { ...outcomeBase({ plan }), detail: plan.why, outcome: "skipped" };
  }
  if (plan.act === "enqueue") {
    return enqueueOne({ deps, home, plan, quiet: args.json, undrafted: false });
  }
  if (plan.act === "undraft-and-enqueue") {
    return undraftAndEnqueue({ deps, home, plan, quiet: args.json });
  }
  if (plan.act === "rewrite-body") {
    return rewriteBodyOne({ bots, deps, home, plan, quiet: args.json });
  }
  return seatOne({ bots, deps, home, plan, quiet: args.json });
}

/**
 * Perform every scheduled act, in fleet order.
 *
 * @param scheduled every selected bump with its act and whether this pass performs it
 * @param deps the injected write edges
 * @param args whether this is a dry run, and whether a child verb's prose must stay off stdout
 * @param home the state home the credential, board and ledger live under
 * @param bots the dependency bots the pass resolved once, so a seated ask judges the same bots the selection did
 * @returns one outcome per bump, in the order the read returned them
 */
export async function performBumpActs({
  scheduled,
  bots,
  deps,
  args,
  home,
}: {
  scheduled: readonly BumpScheduleEntry[];
  bots: DependencyBotActors;
  deps: GithubBumpDriveDeps;
  args: GithubBumpDriveArgs;
  home: string | undefined;
}): Promise<readonly BumpDriveOutcome[]> {
  const outcomes: BumpDriveOutcome[] = [];
  for (const entry of scheduled) {
    if (args.dryRun) {
      outcomes.push(await dryOutcome({ deps, entry, home }));
      continue;
    }
    outcomes.push(await performOne({ args, bots, deps, entry, home }));
  }
  return outcomes;
}
