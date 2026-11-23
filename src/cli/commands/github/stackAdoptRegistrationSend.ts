/**
 * `slopweaver github stack adopt --register-only` — the native write and its read-back.
 *
 * Sends exactly the decided `createStack`/`addToStack`, pins the stack number, then re-reads both pull requests,
 * the stack and the pull request below the parent, and hands them to `./stackAdoptRegistrationCore.ts`'s
 * `githubStackAdoptRegistrationConfirmation` before anything is called repaired. The operation lock, the door,
 * the replan and the local enrolment stay in `./stackAdoptRegistrationRun.ts`, which imports this module.
 *
 * `RegistrationFailure` and its `RegistrationFailures` factory are declared HERE rather than in the run module,
 * so this module stays a leaf: it imports nothing from `./stackAdoptRegistrationRun.ts`, not even a type.
 */
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type ConfirmedRegistration,
  githubStackAdoptRegistrationConfirmation,
  type RegistrationPlan,
} from "./stackAdoptRegistrationCore.js";

/** Why the write did not finish, and how much of it stands. */
export type RegistrationFailure =
  | { readonly kind: "refused" | "unconfirmed"; readonly lines: readonly string[] }
  | {
      readonly kind: "local-enrolment-failed";
      readonly confirmation: ConfirmedRegistration;
      readonly reason: string;
    };

/** The three failure shapes, built through one factory so no call site invents a fourth. */
export const RegistrationFailures = {
  localEnrolment: ({
    confirmation,
    reason,
  }: {
    confirmation: ConfirmedRegistration;
    reason: string;
  }): RegistrationFailure => ({ confirmation, kind: "local-enrolment-failed", reason }),
  refused: ({ lines }: { lines: readonly string[] }): RegistrationFailure => ({ kind: "refused", lines }),
  unconfirmed: ({ lines }: { lines: readonly string[] }): RegistrationFailure => ({ kind: "unconfirmed", lines }),
} as const;

/**
 * Send exactly the decided native write, and pin the stack number the read-back must prove.
 *
 * @returns the pinned stack number, or the unconfirmed native outcome
 */
export async function sendRegistration({
  api,
  plan,
}: {
  api: GithubWriteApi;
  plan: RegistrationPlan;
}): Promise<Result<number, RegistrationFailure>> {
  const { owner, repo } = plan.facts;
  const { operation } = plan;
  if (operation.kind === "already-joined") {
    return ok(operation.stackNumber);
  }
  const written =
    operation.kind === "create"
      ? await api.createStack({ owner, pullRequests: operation.pullRequests, repo })
      : await api.addToStack({ owner, pullRequests: operation.pullRequests, repo, stackNumber: operation.stackNumber });
  if (written.isErr()) {
    return err(
      RegistrationFailures.unconfirmed({
        lines: [
          `native registration was attempted but its outcome is unknown: ${written.error.message}. No local ` +
            "enrolment was written. Re-run to inspect current membership.",
        ],
      }),
    );
  }
  return ok(operation.kind === "add" ? operation.stackNumber : written.value.number);
}

/** The unconfirmed verdict a read-back that never returned earns — something was sent, so it is not a refusal. */
function unreadableReadBack({ message, subject }: { message: string; subject: string }): RegistrationFailure {
  return RegistrationFailures.unconfirmed({
    lines: [
      `could not read back ${subject}: ${message}. No local enrolment was written. Re-run to inspect current membership.`,
    ],
  });
}

/**
 * Re-read both pull requests and the stack, and prove the pinned membership.
 *
 * @returns the confirmed membership, or why the read-back could not confirm it
 */
export async function confirmRegistration({
  api,
  expectedStackNumber,
  plan,
}: {
  api: GithubWriteApi;
  expectedStackNumber: number;
  plan: RegistrationPlan;
}): Promise<Result<ConfirmedRegistration, RegistrationFailure>> {
  const { owner, repo } = plan.facts;
  const child = await api.getPr({ number: plan.facts.child.number, owner, repo });
  if (child.isErr()) {
    return err(unreadableReadBack({ message: child.error.message, subject: `PR #${String(plan.facts.child.number)}` }));
  }
  const parent = await api.getPr({ number: plan.facts.parent.number, owner, repo });
  if (parent.isErr()) {
    return err(
      unreadableReadBack({ message: parent.error.message, subject: `parent PR #${String(plan.facts.parent.number)}` }),
    );
  }
  const stack = await api.getStack({ owner, repo, stackNumber: expectedStackNumber });
  if (stack.isErr()) {
    return err(
      unreadableReadBack({ message: stack.error.message, subject: `native stack #${String(expectedStackNumber)}` }),
    );
  }
  // The bottom-first lookup, RE-RUN against what the parent's base branch holds now. Three races
  // each invalidate the planning-time answer a different way — a retarget of
  // the parent, a reopen of the pull request below it, and the same reopen on the `add` path — and none is
  // preventable, because a provider read always leaves a window behind it. Re-asking the same question after
  // the write is what stops a race being REPORTED as a repaired tree. It runs on every operation: the
  // comparison against what the plan saw is what keeps a chain that was ALREADY broken out of this, and an
  // `add` has that answer only because `readGrandparent` no longer skips it.
  const below = await api.findOpenPrByHead({ head: parent.value.baseRef, owner, repo });
  if (below.isErr()) {
    return err(
      unreadableReadBack({
        message: below.error.message,
        subject: `the pull request below parent PR #${String(plan.facts.parent.number)}`,
      }),
    );
  }
  const confirmed = githubStackAdoptRegistrationConfirmation({
    below: below.value,
    child: child.value,
    expectedStackNumber,
    parent: parent.value,
    plan,
    stack: stack.value,
  });
  return confirmed.isErr()
    ? err(RegistrationFailures.unconfirmed({ lines: [confirmed.error.message] }))
    : ok(confirmed.value);
}
