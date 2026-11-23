/**
 * The second write `github landing --press` makes: re-requesting a stuck CodeRabbit review, BEFORE the row
 * is read as blocked on CodeRabbit.
 *
 * Owner ruling: every CodeRabbit thread resolved, twenty seconds waited, still
 * CHANGES_REQUESTED → re-request the review, recorded on the autonomy ledger, no card. What decides is
 * `../../../review/codeRabbitNudge.ts`; this file owns the sequence around it, per candidate:
 *
 * 1. wait out what is left of the twenty seconds since the fleet read came back (`observation`);
 * 2. re-read the pull request once, and re-derive the verdict from THAT read;
 * 3. claim the head exclusively in the register (`../../../review/codeRabbitNudgeJournal.ts`), then post
 *    `@coderabbitai review` through `github comment create` in process — its door, form and read-back apply;
 * 4. record one `nudge-coderabbit` row on the autonomy ledger.
 *
 * A `nudged` or `flipped-by-itself` outcome drops the row from this pass's `dispatchable`, so no
 * `coderabbit-loop` session is seated for it; a refusal or a failure leaves it there. Its own cap,
 * `CODERABBIT_NUDGE_CAP`, bounds the re-requests alone; it never touches the merge presses.
 *
 * The decision is true AS OF step 2's read, and no later. GitHub has no conditional comment write, so a push
 * or a reopened thread landing between that read and the post still gets the comment.
 * The window is one claim-file write; the cost is one redundant `@coderabbitai review`, which CodeRabbit
 * answers by reviewing whatever head it then sees.
 */

import type { Result } from "../../../lib/result.js";
import { dependencyBotsOf } from "../../../organisation/dependencyBots.js";
import {
  CODERABBIT_NUDGE_BODY,
  CODERABBIT_NUDGE_CAP,
  codeRabbitNudgeCandidates,
  codeRabbitNudgeDecision,
  remainingCodeRabbitWaitMs,
} from "../../../review/codeRabbitNudge.js";
import type { CodeRabbitNudgeJournalError, CodeRabbitNudgeRecord } from "../../../review/codeRabbitNudgeJournal.js";
import { type LandingRow, pressable } from "../../../review/landing.js";
import { EXIT_OK } from "../../exitCodes.js";
import type { GithubLandingArgs } from "./landingCore.js";
import type { GithubLandingDeps } from "./landingDepsContract.js";
import { type LandingPressDeps, performPresses } from "./landingPress.js";
import type { PressLedgerRow } from "./landingPressRow.js";
import type { LandingPressOutcome } from "./landingReport.js";

/** How much of a head commit a sentence quotes. */
const HEAD_CHARS = 7;

/** An instant taken just after the fleet read that judged every row — the twenty seconds are measured from it. */
interface LandingObservation {
  readonly atIso: string;
  readonly monotonicMs: number;
}

/** The edges the re-request path reads and writes through. */
export interface LandingCodeRabbitNudgeDeps extends Pick<
  LandingPressDeps,
  "judgmentNow" | "now" | "recordAutonomy" | "sessionRef"
> {
  /** Post one comment, through `github comment create`. Returns its exit code. */
  readonly requestCodeRabbitReview: (args: { rest: readonly string[]; quiet: boolean }) => Promise<number>;
  /** Every head already re-requested, or why the register could not be read. */
  readonly nudgedHeads: (args: {
    home: string | undefined;
  }) => Result<ReadonlySet<string>, CodeRabbitNudgeJournalError>;
  /** Reserve one head's re-request immediately before the post. */
  readonly reserveNudge: (args: {
    home: string | undefined;
    record: CodeRabbitNudgeRecord;
  }) => Result<"reserved" | "already-recorded", CodeRabbitNudgeJournalError>;
  /** A monotonic clock, in milliseconds — the wait is elapsed time, never wall-clock time. */
  readonly monotonicMs: () => number;
  /** Wait, without holding anything else up. */
  readonly sleep: (args: { milliseconds: number }) => Promise<void>;
}

/** One outcome for one row. */
function outcomeOf({
  row,
  outcome,
  detail,
}: {
  row: LandingRow;
  outcome: LandingPressOutcome["outcome"];
  detail: string;
}): LandingPressOutcome {
  return { detail, number: row.number, outcome, repoSlug: row.repoSlug, url: row.url };
}

/**
 * The `github comment create` argv one re-request runs, without the verb words the caller supplies.
 *
 * @param row the pull request to comment on
 * @param home the state home whose door records the write
 * @returns the argv
 */
export function nudgeArgv({ row, home }: { row: LandingRow; home: string | undefined }): readonly string[] {
  return [
    "--repo",
    row.repoSlug,
    "--number",
    String(row.number),
    "--form",
    JSON.stringify({ summary: [{ kind: "text", text: CODERABBIT_NUDGE_BODY }] }),
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/**
 * The autonomy-ledger row one re-request leaves behind.
 *
 * @param row the re-requested pull request
 * @param bySession what identifies this session
 * @param atIso when the comment was posted
 * @returns the ledger row
 */
function nudgeAutonomyRow({
  row,
  bySession,
  atIso,
}: {
  row: LandingRow;
  bySession: string;
  atIso: string;
}): PressLedgerRow {
  const head = row.headOid.slice(0, HEAD_CHARS);
  return {
    actionId: `${String(row.number)}-${head}-coderabbit-nudge`,
    bySession,
    doneIso: atIso,
    kind: "nudge-coderabbit",
    subject: row.url,
    why:
      "every CodeRabbit thread, outdated included, was resolved; twenty seconds after the read that saw it, its " +
      "latest opinion was still CHANGES_REQUESTED — the owner's standing rule",
    witness: `slopweaver github landing --press -> posted ${CODERABBIT_NUDGE_BODY} on ${row.repoSlug}#${String(row.number)} at head ${head}`,
  };
}

/**
 * Both `--press` writes: the stuck-CodeRabbit re-requests first, then the merge presses.
 *
 * The two select disjoint rows — a re-request candidate reads `spawn-coderabbit`, a press candidate `press` —
 * so the order only decides which one's outcome lines print first. They share `presses` on the document
 * because both are what `--press` did.
 *
 * The twenty seconds start at the top of this call. Only pure work separates it from the fleet read, every
 * thread that read saw resolved was resolved by then, and an anchor later than the read only lengthens the
 * wait, never shortens it.
 *
 * @param rows every row this read produced
 * @param args the parsed invocation
 * @param deps the injected edges
 * @returns every outcome, re-requests first
 */
export async function performPressWrites({
  rows,
  args,
  deps,
}: {
  rows: readonly LandingRow[];
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
}): Promise<readonly LandingPressOutcome[]> {
  const observation = { atIso: deps.now().toISOString(), monotonicMs: deps.reviewState.monotonicMs() };
  const nudges = await performCodeRabbitNudges({
    args,
    authoredByOwner: args.authoredByOwner,
    deps: { ...deps, monotonicMs: deps.reviewState.monotonicMs },
    home: args.home,
    observation,
    rows,
  });
  const presses = await pressesWithDependencyBots({ args, deps, rows });
  return [...nudges, ...presses];
}

/**
 * The merge presses, under the dependency-bot identities the organisation names — a bump presses uncapped, so who
 * counts as a bump bot decides the cap.
 *
 * The organisation is read only when a row is pressable at all. No organisation configured presses with the generic
 * Renovate and Dependabot and says so once on stderr; one that will not read presses nothing, each pressable row
 * failed with the read's own message, because reading it as "no bot of its own" would cap that organisation's
 * bumps as a colleague's work.
 *
 * @param rows every row this read produced
 * @param args the parsed invocation
 * @param deps the injected edges, the organisation read and the diagnostic channel included
 * @returns one outcome per row the presses touched
 */
async function pressesWithDependencyBots({
  rows,
  args,
  deps,
}: {
  rows: readonly LandingRow[];
  args: GithubLandingArgs;
  deps: GithubLandingDeps;
}): Promise<readonly LandingPressOutcome[]> {
  const candidates = pressable({ rows });
  if (candidates.length === 0) {
    return [];
  }
  const resolved = dependencyBotsOf({ organisation: await deps.readOrganisation({ home: args.home }) });
  if (resolved.isErr()) {
    const detail = `not pressed: which authors are dependency bots could not be read — ${resolved.error.message}`;
    return candidates.map((row) => outcomeOf({ detail, outcome: "failed", row }));
  }
  if (resolved.value.note !== undefined) {
    deps.writeDiagnostic(`github landing --press: ${resolved.value.note}`);
  }
  return performPresses({ args, bots: resolved.value.bots, deps, home: args.home, rows });
}

/**
 * Re-request every stuck CodeRabbit review this read found on the owner's own pull requests, capped.
 *
 * @param rows every row this read produced
 * @param authoredByOwner whether the read was `--author @me` — nobody else's pull request is re-requested
 * @param observation the instant after the fleet read that the twenty seconds start at
 * @param args whether this is a dry run, and whether the child's prose must stay off stdout
 * @param deps the injected edges
 * @param home the state home the register lives under
 * @returns one outcome per candidate this run touched, empty when there were none
 */
async function performCodeRabbitNudges({
  rows,
  authoredByOwner,
  observation,
  args,
  deps,
  home,
}: {
  rows: readonly LandingRow[];
  authoredByOwner: boolean;
  observation: LandingObservation;
  args: { readonly dryRun: boolean; readonly json: boolean };
  deps: LandingCodeRabbitNudgeDeps;
  home: string | undefined;
}): Promise<readonly LandingPressOutcome[]> {
  const stuck = rows.filter((row) => row.action === "spawn-coderabbit" && row.codeRabbit === "stuck");
  if (!authoredByOwner || stuck.length === 0) {
    return [];
  }
  const nudged = deps.nudgedHeads({ home });
  if (nudged.isErr()) {
    // An unreadable register must not read as empty — that would re-request every head it already spent.
    return stuck.map((row) =>
      outcomeOf({ detail: `not re-requested: ${nudged.error.message}`, outcome: "failed", row }),
    );
  }
  const candidates = codeRabbitNudgeCandidates({ authoredByOwner, nudgedHeads: nudged.value, rows });
  const outcomes: LandingPressOutcome[] = [];
  for (const row of candidates.slice(0, CODERABBIT_NUDGE_CAP)) {
    outcomes.push(await nudgeCandidate({ args, deps, home, observation, row }));
  }
  for (const row of candidates.slice(CODERABBIT_NUDGE_CAP)) {
    outcomes.push(
      outcomeOf({
        detail: `not re-requested: this invocation's cap of ${String(CODERABBIT_NUDGE_CAP)} was already reached — run it again`,
        outcome: "failed",
        row,
      }),
    );
  }
  return outcomes;
}

/**
 * One candidate: the wait, the fresh read, then the dry run or the reservation, post and ledger row.
 *
 * @param row the candidate
 * @param observation when the fleet read came back
 * @param args whether this is a dry run, and whether the child's prose must stay off stdout
 * @param deps the injected edges
 * @param home the state home
 * @returns the row's outcome
 */
async function nudgeCandidate({
  row,
  observation,
  args,
  deps,
  home,
}: {
  row: LandingRow;
  observation: LandingObservation;
  args: { readonly dryRun: boolean; readonly json: boolean };
  deps: LandingCodeRabbitNudgeDeps;
  home: string | undefined;
}): Promise<LandingPressOutcome> {
  const remaining = remainingCodeRabbitWaitMs({
    nowMonotonicMs: deps.monotonicMs(),
    observedAtMonotonicMs: observation.monotonicMs,
  });
  if (remaining > 0) {
    await deps.sleep({ milliseconds: remaining });
  }
  const fresh = await deps.judgmentNow({ home })({ number: row.number, repoSlug: row.repoSlug });
  if (fresh.isErr()) {
    return outcomeOf({
      detail: `not re-requested: the read after the wait failed (${fresh.error.message})`,
      outcome: "failed",
      row,
    });
  }
  const decision = codeRabbitNudgeDecision({ fresh: fresh.value, row });
  if (decision.kind === "flipped") {
    return outcomeOf({ detail: decision.detail, outcome: "flipped-by-itself", row });
  }
  if (decision.kind === "refused") {
    return outcomeOf({ detail: decision.detail, outcome: "failed", row });
  }
  if (args.dryRun) {
    return outcomeOf({
      detail: `${decision.detail}; it would post ${CODERABBIT_NUDGE_BODY}`,
      outcome: "would-nudge",
      row,
    });
  }
  return postNudge({ decisionDetail: decision.detail, deps, home, quiet: args.json, row });
}

/** Reserve, post, and record — the three writes, in the order that never posts twice. */
async function postNudge({
  row,
  decisionDetail,
  deps,
  home,
  quiet,
}: {
  row: LandingRow;
  decisionDetail: string;
  deps: LandingCodeRabbitNudgeDeps;
  home: string | undefined;
  quiet: boolean;
}): Promise<LandingPressOutcome> {
  const reserved = deps.reserveNudge({
    home,
    record: {
      attemptedAtIso: deps.now().toISOString(),
      headOid: row.headOid,
      number: row.number,
      repoSlug: row.repoSlug,
    },
  });
  if (reserved.isErr()) {
    return outcomeOf({ detail: `not re-requested: ${reserved.error.message}`, outcome: "failed", row });
  }
  if (reserved.value === "already-recorded") {
    return outcomeOf({
      detail: "not re-requested: another pass already re-requested this head during the wait",
      outcome: "failed",
      row,
    });
  }
  const code = await deps.requestCodeRabbitReview({ quiet, rest: nudgeArgv({ home, row }) });
  if (code !== EXIT_OK) {
    return outcomeOf({
      detail:
        "`github comment create` refused or failed — its own lines are printed above; this head's one automatic " +
        "re-request is spent",
      outcome: "failed",
      row,
    });
  }
  const atIso = deps.now().toISOString();
  const unledgered = await deps.recordAutonomy({
    home,
    row: nudgeAutonomyRow({ atIso, bySession: deps.sessionRef(), row }),
  });
  const posted = `${decisionDetail}; posted ${CODERABBIT_NUDGE_BODY} at head ${row.headOid.slice(0, HEAD_CHARS)}`;
  if (unledgered === undefined) {
    return outcomeOf({ detail: `${posted} and recorded it`, outcome: "nudged", row });
  }
  return outcomeOf({
    detail: `${posted}, but the AUTONOMY ledger row could not be written (${unledgered}) — the owner's briefing will not show it`,
    outcome: "nudged",
    row,
  });
}
