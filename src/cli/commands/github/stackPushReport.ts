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
 * @param routed what the door decided, and when it performed, the create, the registration and the carry
 * @returns the process exit code
 */
export function reportStackPush({
  deps,
  routed,
}: {
  deps: Pick<GithubStackPushDeps, "out">;
  routed: ThroughDoorResult<{
    create: PrOutcome;
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
  for (const line of outcomeLines({ outcome: routed.result.create })) {
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
  return routed.result.create.kind === "created" ? EXIT_OK : EXIT_ERROR;
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
 * @param result what the door performed — the create outcome and the head the push actually landed
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
  result: { create: PrOutcome; headSha: string | undefined };
}): void {
  if (result.create.kind !== "created" || result.headSha === undefined) {
    return;
  }
  const repo = `${plan.form.target.owner}/${plan.form.target.repo}`;
  const row = {
    atIso: deps.now().toISOString(),
    branch: plan.facts.branch,
    headSha: result.headSha,
    kind: "raised",
    number: result.create.number,
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
