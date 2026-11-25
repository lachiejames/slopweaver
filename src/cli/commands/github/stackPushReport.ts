/**
 * What `slopweaver github stack push` says once the door has answered: the outcome and its exit code, and the
 * checks-read obligation a fresh create leaves behind. Split from `./stackPushRun.ts`, which owns the plan
 * and the lock; the door is `./stackPushSend.ts`'s. Nothing here reaches GitHub.
 */
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import type { ThroughDoorResult } from "../../../admit/effects.js";
import { appendChecksReadRecord, checksReadCommand } from "../../../outbound/github/checksReadLedger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { outcomeLines, type PrOutcome } from "./core.js";
import type { GithubStackPushDeps } from "./stackPushDeps.js";
import {
  type GithubStackRegistrationOutcome,
  stackRegistrationFailed,
  stackRegistrationLines,
} from "./stackRegistration.js";

/**
 * Print the outcome and choose the exit code. A door refusal and a store that could not record the decision are
 * different facts and print differently; both exit `EXIT_ERROR`.
 *
 * A create succeeds only as `created`; an update of the branch's open pull request succeeds as `updated`, or as
 * `unchanged` when the pull request already said exactly what the push was given.
 *
 * @param routed what the door decided, and when it performed, the create or update, the registration and the carry
 * @returns the process exit code
 */
export function reportStackPush({
  deps,
  routed,
}: {
  deps: Pick<GithubStackPushDeps, "out">;
  routed: ThroughDoorResult<{
    outcome: PrOutcome;
    registration: GithubStackRegistrationOutcome | undefined;
    carried: boolean;
  }>;
}): number {
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github stack push", through: routed })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const line of outcomeLines({ outcome: routed.result.outcome })) {
    deps.out({ line });
  }
  for (const line of stackRegistrationLines({ registration: routed.result.registration })) {
    deps.out({ line });
  }
  // The whole reason `stack push` is the only verb that opens a pull request is that it registers the native
  // stack membership as part of opening one. A create that succeeded while that registration failed leaves
  // exactly the chained-not-native state the owner ruled against, so it is a FAILED command
  // even though the pull request exists — the report above names the repair.
  if (stackRegistrationFailed({ registration: routed.result.registration })) {
    return EXIT_ERROR;
  }
  if (!routed.result.carried) {
    deps.out({ line: "refused to report success: the stack above this branch was only partially carried" });
    return EXIT_ERROR;
  }
  return succeededWrite({ outcome: routed.result.outcome }) === undefined ? EXIT_ERROR : EXIT_OK;
}

/** A write that reached the pull request: a create as `created`, an update as `updated` or `unchanged`. */
export type SucceededWrite = Extract<PrOutcome, { kind: "created" | "updated" | "unchanged" }>;

/**
 * The outcome narrowed to a write that reached the pull request, else nothing.
 *
 * @returns the outcome when it is a confirmed create or update, else `undefined`
 */
export function succeededWrite({ outcome }: { outcome: PrOutcome }): SucceededWrite | undefined {
  const { kind } = outcome;
  return kind === "created" || kind === "updated" || kind === "unchanged" ? outcome : undefined;
}

/**
 * Post the walkthrough whenever the write itself reached the pull request, then answer the worse of the two exits.
 *
 * A carry or a stack registration that failed AFTER the create or update still fails the run, but it no longer
 * withholds a walkthrough from a pull request whose title and body did land: the round goes to the pull request the
 * write produced, and the report's failure is kept.
 *
 * @param reported the exit `reportStackPush` chose
 * @param outcome the write's outcome when the door performed it, else `undefined`
 * @param walk posts (or, given none, accounts for) the walkthrough on the written pull request
 * @returns the report's exit when it failed, else the walkthrough's
 */
export async function walkthroughAfterReport({
  outcome,
  reported,
  walk,
}: {
  outcome: PrOutcome | undefined;
  reported: number;
  walk: (input: { outcome: SucceededWrite }) => Promise<number>;
}): Promise<number> {
  const written = outcome === undefined ? undefined : succeededWrite({ outcome });
  if (written === undefined) {
    return reported;
  }
  const posted = await walk({ outcome: written });
  return reported === EXIT_OK ? posted : reported;
}

/**
 * Record the OBLIGATION this create just left behind: somebody now has to read #n's checks.
 *
 * A draft that sat with two red checks is why this line exists: the session that pushed it went straight on
 * to building proof artifacts and never read its checks once, nothing watched it, and the owner found the
 * reds themselves. The rule is that a pull request is not raised with red checks and then left red. AGENTS.md rule 2 forbids the obvious
 * answer of leaving a watcher behind, so the create leaves a ROW behind instead:
 * `slopweaver github checks` discharges it and `handover finish`/`settle` refuse while it stands.
 *
 * A failed append is REPORTED, never fatal. The pull request genuinely exists by this point, and failing a
 * create over its bookkeeping would be the worse outcome — so the line names the obligation in prose as
 * well, which is the state a session is left in when the register could not take it.
 *
 * @param home the state home whose checks-read register takes the row
 * @param plan the gate-checked plan, naming the repository and the head branch the gate scopes by
 * @param result what the door performed — the write's outcome and the head the push actually landed; only a create
 *   leaves this row, since an update raises nothing new
 */
export function recordRaise({
  deps,
  home,
  plan,
  result,
}: {
  deps: Pick<GithubStackPushDeps, "now" | "out">;
  home: string;
  plan: {
    readonly form: { readonly target: { readonly owner: string; readonly repo: string } };
    readonly facts: { readonly branch: string };
  };
  result: { outcome: PrOutcome; headSha: string | undefined };
}): void {
  if (result.outcome.kind !== "created" || result.headSha === undefined) {
    return;
  }
  const repo = `${plan.form.target.owner}/${plan.form.target.repo}`;
  const row = {
    atIso: deps.now().toISOString(),
    branch: plan.facts.branch,
    headSha: result.headSha,
    kind: "raised",
    number: result.outcome.number,
    repo,
  } as const;
  const appended = appendChecksReadRecord({ home, nowIso: row.atIso, row });
  if (appended.isErr()) {
    deps.out({
      line: `could not record the checks-read obligation for #${String(row.number)}: ${appended.error.message}`,
    });
  }
  deps.out({ line: "NEXT: this pull request is not RAISED until its checks have been read once. Run:" });
  deps.out({ line: `  ${checksReadCommand({ row })}` });
  deps.out({
    line: "  `handover finish` and `handover settle` refuse on this branch until that read is on the record.",
  });
}
