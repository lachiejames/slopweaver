/**
 * The binding `claude reset` and `claude spend` both open with: the named plan's account, its enrollment, and a
 * profile-scoped sign-in one gauge probe proves is that enrolled organisation's (`claude/resetCredential.ts`). So a
 * figure read or a reset spent over it can never land on the wrong plan.
 *
 * Exit codes it ends on: 2 no such plan; 3 a plan no enrollment binds, or no qualifying sign-in, naming the one fix
 * only they can make; 4 the binding could not be settled yet; 1 the plan register could not be read.
 */
import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { ClaudeRotationError } from "../../../claude/errors.js";
import { assertionFor, type ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { type ResetLogin, type ResetLoginDeps, resolveResetLogin } from "../../../claude/resetCredential.js";
import { type ClaudeResetError, ClaudeResetErrors } from "../../../claude/resetErrors.js";
import type { Result } from "../../../lib/result.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { refuse } from "./resetSend.js";

/** The verbs that bind a plan's sign-in, named in every line a refusal prints. */
export type PlanLoginVerb = "claude reset" | "claude spend";

/** The effects binding a plan's sign-in performs. */
export interface PlanLoginDeps {
  readonly readAccounts: (options: {
    home: string;
  }) => Promise<Result<readonly ClaudeAccount[] | undefined, ClaudeRotationError>>;
  readonly readAssertions: (options: { home: string }) => readonly ClaudeIdentityAssertion[];
  readonly login: ResetLoginDeps;
  readonly nowIso: () => string;
}

/** A plan bound to a sign-in proven to be its enrolled organisation's. */
export interface BoundPlanLogin {
  readonly account: ClaudeAccount;
  readonly assertion: ClaudeIdentityAssertion;
  readonly login: ResetLogin;
}

/** A login that could not be bound, as the exit it ends on, naming the one fix only they can make. */
function loginRefusal({
  assertion,
  error,
  verb,
}: {
  assertion: ClaudeIdentityAssertion;
  error: ClaudeResetError;
  verb: PlanLoginVerb;
}): number {
  if (error.code !== "NO_QUALIFYING_LOGIN") {
    return refuse({ code: EXIT_DEFERRED, lines: [`${verb}: ${error.message}`] });
  }
  const signedInAs =
    assertion.email === undefined ? "signed in as the plan's enrolled account" : `signed in as ${assertion.email}`;
  return refuse({
    code: EXIT_EXPECTED_EMPTY,
    lines: [
      `${verb}: ${error.message}`,
      `${verb}: the fix is theirs: \`slopweaver claude signin --plan ${error.alias}\` in their own terminal, ${signedInAs}`,
    ],
  });
}

/**
 * Bind one named plan to a sign-in proven to be its enrolled organisation's.
 *
 * @param alias the plan alias the caller named
 * @param deps the effects
 * @param home the state home
 * @param verb the verb every refusal line is prefixed with
 * @returns the bound plan, or the exit code a missing plan, enrollment or sign-in ended on
 */
export async function bindPlanLogin({
  alias,
  deps,
  home,
  verb,
}: {
  alias: string;
  deps: PlanLoginDeps;
  home: string;
  verb: PlanLoginVerb;
}): Promise<number | BoundPlanLogin> {
  const accounts = await deps.readAccounts({ home });
  if (accounts.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`${verb}: ${accounts.error.message}`] });
  }
  const account = accounts.value === undefined ? undefined : accounts.value.find((entry) => entry.alias === alias);
  if (account === undefined) {
    return refuse({
      code: EXIT_USAGE,
      lines: [`${verb}: no configured Claude plan is called ${JSON.stringify(alias)}`],
    });
  }
  const assertion = assertionFor({ alias, assertions: deps.readAssertions({ home }) });
  if (assertion === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      lines: [`${verb}: ${ClaudeResetErrors.planUnbound({ alias }).message}`],
    });
  }
  const resolved = await resolveResetLogin({
    alias,
    assertion,
    deps: deps.login,
    nowIso: deps.nowIso(),
    storeDir: account.storeDir,
  });
  if (resolved.isErr()) {
    return loginRefusal({ assertion, error: resolved.error, verb });
  }
  return { account, assertion, login: resolved.value };
}
