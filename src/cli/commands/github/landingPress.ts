/**
 * The WRITE half of `slopweaver github landing`: pressing GitHub's own 'Merge when ready'.
 *
 * Its own module because it is the only thing in this verb that writes to GitHub, and because the shell it
 * came out of had grown past what one reader holds in their head. `./landingRegister.ts` is the same split
 * for the board write; `./landingRun.ts` keeps the read and the reporting.
 *
 * ## What `--press` does NOT do
 *
 * It does not reimplement the click. It calls `github enqueue` in process, once per pressable row, so the
 * whole shipped guard applies — the merge hold, every finding, the door record and the `mergeQueueEntry`
 * read-back — and this verb can never disagree with the verb that owns pressing. What it adds is the
 * register the door ledger cannot be: a line naming the SUBJECT and the head THIS READ judged
 * (`../../../review/pressJournal.ts`).
 *
 * ## The TWO findings it answers for itself
 *
 * Both exist for the same reason and are held safe by the same two facts, so read them as one mechanism
 * with two subjects rather than as a list that might grow by habit.
 *
 * `github enqueue` raises `codex-loop-incomplete` for a head no checkout on this machine holds, which is
 * every pull request of the owner's a human wrote and humans reviewed. Left unanswered it comes back as
 * "`github enqueue` refused it" and a chair re-runs the enqueue by hand with
 * `--acknowledge codex-loop-incomplete --reason "…"`, leaving a green pull request unpressed for minutes (seven, once).
 * The press names that subject itself, on ONE criterion — a standing human approval, read fresh
 * (`pressCodexWaiverReason`, `../../../review/reviewSignals.ts`) — with one constant reason.
 *
 * It raises `ci-rollup-superseded` when GitHub's aggregate rollup still reads `FAILURE` while every check
 * in the latest-per-name view on the head passed, which on THIS repository is the routine cost of landing:
 * `pr-body-gate` re-runs `dev-gate` on every body edit, and the replaced run keeps pinning the rollup.
 * MEASURED: every green `merge-now` row a press pressed in one day was refused on it, and a seat re-did each
 * enqueue by hand with the same two acknowledgements, a lane the press replaces. So the press names
 * this subject too, on a criterion that is a PROOF rather than a standing approval:
 * `rollupSupersessionProof` (`../../../live/github/rollupSupersession.ts`) must establish, from the read,
 * that every run pinning the rollup was replaced on the same head by a strictly later run of its own name
 * that the read can NAME. Anything short of that — a truncated page, a disagreement with no superseded
 * failure behind it, a discard nothing ordered against the run still counting — acknowledges nothing and
 * `github enqueue` refuses exactly as it did before.
 *
 * Two facts keep both from being holes rather than narrowings, and both are somebody else's code: every
 * OTHER finding still refuses, because `unacknowledgedEnqueueFindings` filters by subject
 * (`./enqueueFindings.ts`) — and a red still standing on the head is `ci-not-green`, a subject this verb
 * never names; and the door records a waiver only when the finding actually STOOD
 * (`./enqueueAcknowledgements.ts`), so naming a subject on a press whose floor was clean writes nothing and
 * leaves the ledger's waiver count honest.
 *
 * ## The two windows it closes, and the one it cannot
 *
 * A press names a pull request by NUMBER, so both the HEAD and the CONVERSATION can move between the read
 * that judged a row and the click. Each is re-asked once, immediately before ITS press — per row rather than
 * once for the set, because an earlier press takes time and a later row's head can move inside that window.
 * What stays open is irreducible: the mutation takes an expected head and nothing else, so a reply landing
 * between the re-read and the write cannot be refused atomically the way a moved commit can.
 *
 * What that re-read DECIDES lives in `./pressJudgment.ts`; this file owns the sequence around it.
 */

import type { AutonomyActionRow } from "../../../autonomy/types.js";
import type { Result } from "../../../lib/result.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import type { MergeableRecheck } from "../../../live/github/mergeableRecheck.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import type { DependencyBotActors } from "../../../organisation/dependencyBots.js";
import type { LandingRow } from "../../../review/landing.js";
import { partitionPressableRows } from "../../../review/landingPressSelection.js";
import { EXIT_OK } from "../../exitCodes.js";
import { type PressLedgerRow, pressAutonomyRow, pressOccurrenceId } from "./landingPressRow.js";
import type { LandingPressOutcome } from "./landingReport.js";
import { wouldClearClause } from "./landingThreads.js";
import { NON_OWNER_PRESS_CAP_PER_REPO, PRESS_PASS_BUDGET_MS } from "./landingUsage.js";
import { HEAD_CHARS, headRefusalAtPressTime } from "./pressHeadCheck.js";
import { judgmentAtPressTime, type PressWaiver, unprovenClause, waiverClause } from "./pressJudgment.js";

/** The edges the press path writes and re-reads through, a strict subset of the verb's own. */
export interface LandingPressDeps {
  /** Press one pull request, through the verb that owns pressing. Returns its exit code. */
  readonly press: (args: { rest: readonly string[]; quiet: boolean }) => Promise<number>;
  /**
   * Record one press with its subject. Returns the sentence saying it could not be recorded, or undefined —
   * reported on the outcome rather than thrown, for the reason {@link LandingPressDeps.recordAutonomy} gives.
   */
  readonly recordPress: (args: {
    home: string | undefined;
    repoSlug: string;
    number: number;
    headOid: string;
    entryState: string;
    atIso: string;
  }) => Promise<string | undefined>;
  /**
   * Record one press on the AUTONOMY ledger, which is the half of `AGENTS.md` rule 10 that puts an unasked
   * act in front of the owner. Returns the sentence saying it could not be recorded, or undefined.
   *
   * Reported rather than thrown: the press already happened, and losing the line is a thing to SAY on the
   * outcome, never a reason to pretend the enqueue did not occur.
   */
  readonly recordAutonomy: (args: { home: string | undefined; row: PressLedgerRow }) => Promise<string | undefined>;
  /**
   * Every act the AUTONOMY ledger holds, steers excluded, or the sentence saying why it cannot be read. Asked
   * BEFORE a press, because a press whose row cannot be written is not made, and again after it, because
   * {@link pressOccurrenceId} resolves against what another writer may have appended meanwhile.
   */
  readonly ledgerActs: (args: { home: string | undefined }) => Promise<Result<readonly AutonomyActionRow[], string>>;
  /** What identifies this session on a ledger row. */
  readonly sessionRef: () => string;
  /** GitHub's CURRENT head for each pull request about to be pressed. */
  readonly headsNow: (args: { home: string | undefined }) => MergeableRecheck;
  /** The remote conversation on ONE pull request, re-read immediately before its press. */
  readonly judgmentNow: (args: {
    home: string | undefined;
  }) => (args: { repoSlug: string; number: number }) => Promise<Result<PrLiveState, GithubLiveError>>;
  readonly now: () => Date;
}

/**
 * Press every pressable row of the owner's, and a capped few of anybody else's, through the verb that owns pressing.
 *
 * Which is which is `../../../review/landingPressSelection.ts`: every row of an `--author @me` read and every
 * dependency bump is pressed in this one pass, because the owner's standing rule already decides them; a row that is
 * not the owner's is capped at {@link NON_OWNER_PRESS_CAP_PER_REPO} per repository, so a wide `--repo` still cannot turn
 * into a landing wave over a colleague's work. The cap is enforced HERE rather than by the caller for that
 * reason. Each row still gets its own head and conversation re-read immediately before its own press.
 *
 * @param rows every row this read produced
 * @param args whether the read was `--author @me`, whether this is a dry run, and whether the child's prose
 *   must stay off stdout
 * @param deps the injected edges
 * @param home the state home the register lives under
 * @param bots the dependency-bot identities this install recognises, whose bumps press uncapped
 * @returns one outcome per row this run touched
 */
export async function performPresses({
  rows,
  args,
  deps,
  home,
  bots,
}: {
  rows: readonly LandingRow[];
  args: { readonly authoredByOwner: boolean; readonly dryRun: boolean; readonly json: boolean };
  deps: LandingPressDeps;
  home: string | undefined;
  bots: DependencyBotActors;
}): Promise<readonly LandingPressOutcome[]> {
  const { toPress, capped } = partitionPressableRows({
    authoredByOwner: args.authoredByOwner,
    bots,
    nonOwnerCapPerRepo: NON_OWNER_PRESS_CAP_PER_REPO,
    rows,
  });
  const outcomes: LandingPressOutcome[] = [];
  // A dry run makes no press, so it has no budget and never reads the clock: it reports every row's own outcome.
  const budget = args.dryRun ? undefined : { startedMs: deps.now().getTime() };
  const budgetSpent = ({ index }: { index: number }): boolean =>
    budget !== undefined && index > 0 && deps.now().getTime() - budget.startedMs >= PRESS_PASS_BUDGET_MS;
  for (const [index, row] of toPress.entries()) {
    // Checked before each START, never mid-press: a press under way is a write half made, and stopping it is
    // worse than finishing it. What the budget buys is a read that reports rather than one the tick kills. The
    // first row always presses: the budget runs from the first row's start, its own pre-press reads included, so
    // no clock movement before that can spend it, and the bound is on the whole press phase's wall time. Asked here
    // so a spent budget spends no pre-press read, and again at the press itself, because those reads take time.
    if (budgetSpent({ index })) {
      outcomes.push(...toPress.slice(index).map((waiting) => overBudgetOutcome({ row: waiting })));
      break;
    }
    outcomes.push(await pressCandidate({ args, budgetSpent: () => budgetSpent({ index }), deps, home, row }));
  }
  outcomes.push(...capped.map((row) => overCapOutcome({ row })));
  return outcomes;
}

/** What a row reached after this pass's press budget reports, rather than a press the tick would kill. */
function overBudgetOutcome({ row }: { row: LandingRow }): LandingPressOutcome {
  return {
    detail:
      `not pressed: this pass spent its ${String(PRESS_PASS_BUDGET_MS / 1000)}s of press starts on the rows ` +
      "before it — the next pass presses it",
    number: row.number,
    outcome: "failed",
    repoSlug: row.repoSlug,
    url: row.url,
  };
}

/** What one row reports, rather than a silent omission from the outcome list. */
function failedOutcome({ row, detail }: { row: LandingRow; detail: string }): LandingPressOutcome {
  return { detail, number: row.number, outcome: "failed", repoSlug: row.repoSlug, url: row.url };
}

/**
 * One candidate row: the head check, the conversation re-read, then the dry run or the press.
 *
 * Its own function so {@link performPresses} reads as the cap and the loop it is, and so the ORDER these
 * three questions are asked in sits in one place — it is the whole safety property of this file.
 *
 * @param row the pressable row
 * @param args whether this is a dry run, and whether the child's prose must stay off stdout
 * @param deps the injected edges
 * @param home the state home the register lives under
 * @param budgetSpent asked immediately before the press, after every pre-press read, so a row whose reads
 *   crossed the pass budget is reported `not pressed` rather than pressed late
 * @returns the row's outcome, pressed, would-pressed or failed
 */
async function pressCandidate({
  row,
  args,
  budgetSpent,
  deps,
  home,
}: {
  row: LandingRow;
  args: { readonly dryRun: boolean; readonly json: boolean };
  budgetSpent: () => boolean;
  deps: LandingPressDeps;
  home: string | undefined;
}): Promise<LandingPressOutcome> {
  // The ledger is the rail, so it is asked FIRST: a press the owner's briefing could not show is not made, and a dry
  // run that promised one would be promising a press the real run refuses. Local and cheap, so it also spends
  // no GitHub read on a row that was never going to be pressed.
  const ledger = await deps.ledgerActs({ home });
  if (ledger.isErr()) {
    return failedOutcome({
      detail:
        `not pressed: the autonomy ledger could not be read (${ledger.error}), and a press the ` +
        "owner's briefing could not show is not made",
      row,
    });
  }
  const moved = await headRefusalAtPressTime({ recheck: deps.headsNow({ home }), row });
  if (moved !== undefined) {
    return failedOutcome({ detail: moved, row });
  }
  // Asked BEFORE the dry-run branch on purpose: a dry run that answers `would-press` for a row a real run
  // would refuse is a lie about what `--press` is going to do, which is the one thing a dry run is for.
  // The waiver rides the same answer for the same reason — a dry run that hides an acknowledgement the
  // real run would make is the same lie, one finding further down.
  const judgment = await judgmentAtPressTime({ deps, home, row });
  if (judgment.kind === "refused") {
    return failedOutcome({ detail: judgment.detail, row });
  }
  if (args.dryRun) {
    return {
      detail:
        `every test passed; it is not queued and its head is ${row.headRefName}` +
        waiverClause({ tense: "would", waivers: judgment.waivers }) +
        wouldClearClause({ threadIds: judgment.oursResolvable }) +
        unprovenClause({ unproven: judgment.unproven }),
      number: row.number,
      outcome: "would-press",
      repoSlug: row.repoSlug,
      url: row.url,
    };
  }
  if (budgetSpent()) {
    return overBudgetOutcome({ row });
  }
  return pressOne({ deps, home, quiet: args.json, row, unproven: judgment.unproven, waivers: judgment.waivers });
}

/** What a row past its repository's cap reports, rather than a silent omission from the outcome list. */
function overCapOutcome({ row }: { row: LandingRow }): LandingPressOutcome {
  return {
    detail:
      `not pressed: it is neither the owner's nor a dependency bump, and ${row.repoSlug}'s cap of ` +
      `${String(NON_OWNER_PRESS_CAP_PER_REPO)} such presses per invocation was already reached — run it again`,
    number: row.number,
    outcome: "failed",
    repoSlug: row.repoSlug,
    url: row.url,
  };
}

/**
 * The `github enqueue` argv one press runs. The acknowledgements are the LAST thing appended and only when
 * there is at least one, so the argv of a press that answered nothing for itself is byte-identical to the
 * plain one — which is what the paired argv assertions in `landingRun/tick.test.ts` pin.
 *
 * The subjects ride ONE comma-separated `--acknowledge` and the reasons ONE `--reason`, because that is the
 * flag surface `github enqueue` has: a caller names a SET of subjects and states why. The reasons are joined
 * rather than one of them chosen, so the ledger row for each subject carries the sentence that justified it
 * alongside the other — losing one to keep the line short is the misleading-ledger shape this verb's own
 * autonomy row exists to avoid.
 */
function enqueueArgv({
  row,
  home,
  waivers,
}: {
  row: LandingRow;
  home: string | undefined;
  waivers: readonly PressWaiver[];
}): readonly string[] {
  const acknowledgement =
    waivers.length === 0
      ? []
      : [
          "--acknowledge",
          waivers.map((waiver) => waiver.subject).join(","),
          "--reason",
          waivers.map((waiver) => waiver.reason).join("; "),
        ];
  return [
    "--pr",
    String(row.number),
    "--repo",
    row.repoSlug,
    ...(home === undefined ? [] : ["--home", home]),
    ...acknowledgement,
  ];
}

/**
 * One press and the register line that names its subject.
 *
 * Our own open walkthrough threads are not resolved here: the child `github enqueue` resolves them itself,
 * immediately before its mutation, and prints and ledgers what it did (`./walkthroughStep.ts`).
 */
async function pressOne({
  row,
  deps,
  home,
  quiet,
  waivers,
  unproven,
}: {
  row: LandingRow;
  deps: LandingPressDeps;
  home: string | undefined;
  quiet: boolean;
  waivers: readonly PressWaiver[];
  unproven: string | undefined;
}): Promise<LandingPressOutcome> {
  const code = await deps.press({ quiet, rest: enqueueArgv({ home, row, waivers }) });
  if (code !== EXIT_OK) {
    return failedOutcome({
      detail: "`github enqueue` refused it — its own findings are printed above" + unprovenClause({ unproven }),
      row,
    });
  }
  const atIso = deps.now().toISOString();
  const unregistered = await deps.recordPress({
    atIso,
    entryState: row.queue.kind === "queued" ? row.queue.state : "",
    headOid: row.headOid,
    home,
    number: row.number,
    repoSlug: row.repoSlug,
  });
  const unledgered = await recordOccurrence({
    deps,
    home,
    row: pressAutonomyRow({ atIso, bySession: deps.sessionRef(), row, waivers }),
  });
  const pressed =
    `pressed 'Merge when ready' at head ${row.headOid.slice(0, HEAD_CHARS)}` + waiverClause({ tense: "did", waivers });
  return {
    detail: pressedDetail({ pressed, unledgered, unregistered }),
    number: row.number,
    outcome: "pressed",
    repoSlug: row.repoSlug,
    url: row.url,
  };
}

/**
 * Write one act's row under its occurrence id, re-reading the ledger first because another writer may have
 * appended since the check before the act.
 *
 * ONE attempt, never retried: the store decides a second act under one id, so another session that took this
 * ordinal first is an `ACTION_ID_CONFLICT` reported on the outcome, never a loop that writes a row on a guess.
 * `github bump-drive` writes its press and undraft rows through this too, so one bump pressed by both verbs at
 * one head, one after the other, is two occurrences rather than one refused row.
 *
 * @param row the row, carrying the first act's id at its head (`./landingPressRow.ts`'s `pressActionId`)
 * @param deps the ledger edges
 * @param home the state home the ledger answers for
 * @returns why the row could not be written, or undefined when it was
 */
export async function recordOccurrence({
  row,
  deps,
  home,
}: {
  row: PressLedgerRow;
  deps: Pick<LandingPressDeps, "ledgerActs" | "recordAutonomy">;
  home: string | undefined;
}): Promise<string | undefined> {
  const held = await deps.ledgerActs({ home });
  if (held.isErr()) {
    return held.error;
  }
  return deps.recordAutonomy({ home, row: { ...row, actionId: pressOccurrenceId({ held: held.value, row }) } });
}

/**
 * What a press that HAPPENED says, including the sentence a lost ledger row owes its reader.
 *
 * A lost row is reported rather than thrown for the reason {@link LandingPressDeps.recordAutonomy} states:
 * the press occurred, so the only honest outcome is `pressed` with the loss named.
 *
 * @param pressed what the press itself did, waivers included
 * @param unledgered why the autonomy row could not be written, or undefined
 * @param unregistered why the press register row could not be written, or undefined
 * @returns the outcome's detail sentence
 */
function pressedDetail({
  pressed,
  unledgered,
  unregistered,
}: {
  pressed: string;
  unledgered: string | undefined;
  unregistered: string | undefined;
}): string {
  const lost = lostRowsClause({ act: "press", unledgered, unregistered });
  if (lost === undefined) {
    return `${pressed} and recorded it`;
  }
  return `${pressed}${lost}`;
}

/**
 * The clause an act that happened owes its reader for each row it could not write: what was lost, and what
 * that loss hides. Shared with `github bump-drive`, whose enqueue writes the same two rows.
 *
 * @param act the noun for what happened — "press" here, "act" for a bump-drive enqueue
 * @param unledgered why the autonomy row could not be written, or undefined
 * @param unregistered why the press register row could not be written, or undefined
 * @returns the clause, opening ", but", or undefined when both rows were written
 */
export function lostRowsClause({
  act,
  unledgered,
  unregistered,
}: {
  act: string;
  unledgered: string | undefined;
  unregistered: string | undefined;
}): string | undefined {
  const lost: string[] = [];
  const hidden: string[] = [];
  if (unledgered !== undefined) {
    lost.push(`the AUTONOMY ledger row could not be written (${unledgered})`);
    hidden.push("the owner's briefing will not show it");
  }
  if (unregistered !== undefined) {
    lost.push(`the press register row could not be written (${unregistered})`);
    hidden.push("an eviction from the queue will not read as one");
  }
  if (lost.length === 0) {
    return undefined;
  }
  return `, but ${lost.join(", and ")} — the ${act} happened and ${hidden.join(", and ")}`;
}
