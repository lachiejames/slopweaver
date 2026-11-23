/**
 * `slopweaver github stack adopt --register-only` — the effectful shell.
 *
 * The order is the contract, and it differs from ordinary adopt's in exactly the ways the mode differs:
 * parse (already done) → read the repository slug and remote default → read the child → resolve the parent →
 * authorise → plan → [dry-run stops here, before the lock] → [operation lock] → door → re-read and replan →
 * native write → read back and CONFIRM → local ledger → report.
 *
 * Three properties that are the design rather than notes:
 *
 * - **No replay fact is ever read.** `./stackAdoptGit.ts`'s `localAdoptFacts` reads symbolic HEAD, the local
 *   HEAD SHA and `git status`, and `./stackAdoptRun.ts`'s `planAdopt` measures effective commits before planning.
 *   None of that runs here: this shell reads the repository root and the remote's own `ls-remote --symref` and stops.
 *   Dispatching AFTER those reads would leave the deadlock exactly where it was, which is why the entrypoint
 *   branches before them and why the public-entrypoint test injects a Git edge that THROWS on each one.
 * - **Native first, ledger second.** `./stackAdoptPerform.ts`'s `registerAdoptedPr` writes the local ledger
 *   BEFORE attempting native registration, so a native failure leaves an enrolled pull request that is in no
 *   stack. Inverting the order moves the unavoidable partial outcome to the harmless direction: confirmed
 *   membership plus a failed local write, which a re-run repairs with no second native write because the
 *   membership is then already equal.
 * - **A provider success is not a confirmation.** `createStack`/`addToStack` answer with a stack number and
 *   nothing else; both pull requests and the stack itself are re-read and checked against a PINNED expected
 *   number before anything is called repaired. A read-back failure is reported as `unconfirmed`, never as
 *   "nothing was sent" — something was.
 */
import { absentAs } from "#lib/absent.js";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { registerStackMember } from "../../../outbound/github/stackLedger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import type { GithubPushDeps } from "./pushPrimitives.js";
import type { GithubStackAdoptArgs } from "./stackAdoptCore.js";
import {
  type ConfirmedRegistration,
  githubStackAdoptNoRegistrationLine,
  githubStackAdoptRegistrationDoorRequest,
  githubStackAdoptRegistrationFreshness,
  githubStackAdoptRegistrationPlan,
  githubStackAdoptRegistrationPreviewLine,
  githubStackAdoptRegistrationReportLines,
  type RegistrationFacts,
  type RegistrationPlan,
  sameRegistrationOperation,
} from "./stackAdoptRegistrationCore.js";
import { readRegistrationFacts } from "./stackAdoptRegistrationReads.js";
import {
  confirmRegistration,
  type RegistrationFailure,
  RegistrationFailures,
  sendRegistration,
} from "./stackAdoptRegistrationSend.js";
import { ALLOW_FOREIGN_PR, authorisationFor } from "./updateCore.js";

/** The injectable edges this mode needs — a strict subset of ordinary adopt's, plus the ledger seam. */
export interface GithubStackAdoptRegistrationDeps {
  readonly git: GithubPushDeps;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly env: (input: { readonly name: string }) => string | undefined;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  readonly token: (input: { readonly home: string }) => string | undefined;
  /** The local ledger write, injectable so a test can prove the partial-completion path without a mock. */
  readonly registerMember: typeof registerStackMember;
}

/** Turn an unknown thrown value into one bounded line, the same way every other shell here does. */
function failureText({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Plan from facts already read, applying the same authorisation gate every governed PR write applies.
 *
 * `viewerId` is read by the CALLER, before the topology reads, rather than here, which closes a window: an `await` between the last topology read and the decision is
 * time another client can retarget the parent in, and the identity read is one this function never needed to
 * make itself. The window a provider read leaves behind cannot be removed, only not widened — the read-back
 * in `stackAdoptRegistrationCore.ts`'s `confirmationFailures` is what refuses to CALL such a race a repair.
 */
function planFrom({
  deps,
  facts,
  viewerId,
}: {
  deps: GithubStackAdoptRegistrationDeps;
  facts: RegistrationFacts;
  viewerId: number | undefined;
}): ReturnType<typeof githubStackAdoptRegistrationPlan> {
  const allowForeign = deps.env({ name: ALLOW_FOREIGN_PR }) === "1";
  const { parent } = facts;
  return githubStackAdoptRegistrationPlan({
    authorisation: authorisationFor({
      allowForeign,
      authedUserId: viewerId,
      prAuthorId: facts.child.authorId,
      purpose: "stack-register",
    }),
    facts,
    // The parent is asked the same question because `createStack` enrols it too — see the core's
    // `parentAuthorisationOutcome`, which is what decides whether the answer is load-bearing.
    parentAuthorisation:
      parent === undefined
        ? undefined
        : authorisationFor({
            allowForeign,
            authedUserId: viewerId,
            prAuthorId: parent.authorId,
            purpose: "stack-register",
          }),
    viewerId,
  });
}

/** Re-read the facts, replan, and refuse unless the whole decided operation is still the same write. */
async function replanInsideDoor({
  api,
  args,
  deps,
  plan,
}: {
  api: GithubWriteApi;
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptRegistrationDeps;
  plan: RegistrationPlan;
}): Promise<Result<RegistrationPlan, RegistrationFailure>> {
  const identity = await api.authenticatedUserId();
  const fresh = await readRegistrationFacts({ api, args, git: deps.git });
  if (fresh.isErr()) {
    return err(RegistrationFailures.refused({ lines: githubVerbErrorLines({ error: fresh.error }) }));
  }
  const freshness = githubStackAdoptRegistrationFreshness({ current: fresh.value, previewed: plan.facts });
  if (!freshness.fresh) {
    return err(RegistrationFailures.refused({ lines: [freshness.reason] }));
  }
  const replanned = planFrom({ deps, facts: fresh.value, viewerId: identity.isOk() ? identity.value : undefined });
  if (replanned.isErr()) {
    return err(RegistrationFailures.refused({ lines: replanned.error }));
  }
  if (replanned.value.kind !== "register") {
    return err(
      RegistrationFailures.refused({ lines: [githubStackAdoptNoRegistrationLine({ decision: replanned.value })] }),
    );
  }
  if (!sameRegistrationOperation({ current: replanned.value.plan.operation, planned: plan.operation })) {
    return err(
      RegistrationFailures.refused({
        lines: [
          "the registration operation changed before registration; nothing was sent. Re-run to work from the current state",
        ],
      }),
    );
  }
  return ok(replanned.value.plan);
}

/** The whole write, already inside the door: replan, send, confirm, then enrol locally. */
async function performRegistration({
  api,
  args,
  deps,
  home,
  plan,
}: {
  api: GithubWriteApi;
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptRegistrationDeps;
  home: string;
  plan: RegistrationPlan;
}): Promise<Result<ConfirmedRegistration, RegistrationFailure>> {
  const current = await replanInsideDoor({ api, args, deps, plan });
  if (current.isErr()) {
    return err(current.error);
  }
  const sent = await sendRegistration({ api, plan: current.value });
  if (sent.isErr()) {
    return err(sent.error);
  }
  const confirmed = await confirmRegistration({ api, expectedStackNumber: sent.value, plan: current.value });
  if (confirmed.isErr()) {
    return err(confirmed.error);
  }
  try {
    deps.registerMember({
      home,
      nowIso: deps.now().toISOString(),
      number: confirmed.value.childNumber,
      owner: current.value.facts.owner,
      repo: current.value.facts.repo,
      via: "adopt",
    });
  } catch (error: unknown) {
    return err(RegistrationFailures.localEnrolment({ confirmation: confirmed.value, reason: failureText({ error }) }));
  }
  return ok(confirmed.value);
}

/** Print one failure and answer with the exit code it earns. */
function reportFailure({
  deps,
  failure,
}: {
  deps: GithubStackAdoptRegistrationDeps;
  failure: RegistrationFailure;
}): number {
  if (failure.kind === "local-enrolment-failed") {
    for (const line of githubStackAdoptRegistrationReportLines({ confirmation: failure.confirmation })) {
      deps.out({ line });
    }
    deps.out({
      line:
        `native membership confirmed, local enrolment failed for PR #${String(failure.confirmation.childNumber)}: ` +
        `${failure.reason}. Re-run --register-only; matching membership needs no second native write.`,
    });
    return EXIT_ERROR;
  }
  const [first, ...rest] = failure.lines;
  deps.out({ line: `${failure.kind}: ${absentAs({ value: first, whenAbsent: "the registration did not complete" })}` });
  for (const line of rest) {
    deps.out({ line });
  }
  return EXIT_ERROR;
}

/**
 * Run one governed register-only adopt: the native stack membership and the local enrolment, and no rebase,
 * no push and no commit read anywhere.
 *
 * @param args the already-parsed invocation, shared with ordinary adopt's parser
 * @param deps the injectable Git, API, environment, clock, ledger and output edges
 * @param home the state home whose door ledger records the write and whose ledger holds the enrolment
 * @returns the process exit code
 */
export async function runGithubStackAdoptRegistration({
  args,
  deps,
  home,
}: {
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptRegistrationDeps;
  home: string;
}): Promise<number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const identity = await api.authenticatedUserId();
  const facts = await readRegistrationFacts({ api, args, git: deps.git });
  if (facts.isErr()) {
    for (const line of githubVerbErrorLines({ error: facts.error })) deps.out({ line: `refused: ${line}` });
    return EXIT_ERROR;
  }
  const planned = planFrom({ deps, facts: facts.value, viewerId: identity.isOk() ? identity.value : undefined });
  if (planned.isErr()) {
    const [first, ...rest] = planned.error;
    deps.out({ line: `refused: ${absentAs({ value: first, whenAbsent: "the registration was refused" })}` });
    for (const line of rest) deps.out({ line });
    return EXIT_ERROR;
  }
  if (planned.value.kind === "no-registration") {
    deps.out({ line: githubStackAdoptNoRegistrationLine({ decision: planned.value }) });
    return EXIT_OK;
  }
  const { plan } = planned.value;
  for (const notice of plan.overrideNotices) deps.out({ line: notice });
  deps.out({ line: githubStackAdoptRegistrationPreviewLine({ plan }) });
  if (args.dryRun) {
    deps.out({ line: "dry run: no native write, no local enrolment, no operation lock, no door record." });
    return EXIT_OK;
  }
  return runRegistrationWrite({ api, args, deps, home, plan });
}

/**
 * Take the operation lock, go through the door, and report — split from the entrypoint so each stays inside
 * the function-length gate, and because everything above it is decision and everything below it is effect.
 *
 * @param api the GitHub write surface
 * @param args the parsed invocation, re-read from inside the door
 * @param deps the injectable edges
 * @param home the state home
 * @param plan the registration decided outside the lock
 * @returns the process exit code
 */
async function runRegistrationWrite({
  api,
  args,
  deps,
  home,
  plan,
}: {
  api: GithubWriteApi;
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptRegistrationDeps;
  home: string;
  plan: RegistrationPlan;
}): Promise<number> {
  // Lower-cased for the reason ordinary adopt lower-cases it: the lock hashes this key verbatim, so a
  // differently-cased remote for the SAME repository would contend on a different lock entirely.
  const lockKey = `${plan.facts.owner}/${plan.facts.repo}`.toLowerCase();
  const lock = acquireOperationLock({ home, key: lockKey, nowIso: deps.now().toISOString() });
  if (!lock.isOk()) {
    deps.out({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return EXIT_ERROR;
  }
  try {
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      home,
      ledger: deps.git.doorLedger,
      perform: () => performRegistration({ api, args, deps, home, plan }),
      request: githubStackAdoptRegistrationDoorRequest({ home, plan }),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "slopweaver github stack adopt", through: routed })) {
        deps.out({ line });
      }
      return EXIT_ERROR;
    }
    if (routed.result.isErr()) {
      return reportFailure({ deps, failure: routed.result.error });
    }
    for (const line of githubStackAdoptRegistrationReportLines({ confirmation: routed.result.value })) {
      deps.out({ line });
    }
    return EXIT_OK;
  } finally {
    lock.value.release();
  }
}
