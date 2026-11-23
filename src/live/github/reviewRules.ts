/**
 * Whether a base branch REQUIRES a pull-request review before anything lands on it — the fact that decides
 * whether `slopweaver github merge --admin` has a bypass to take, or is offering a route that does not exist.
 *
 * ## The measurement that made this a module
 *
 * MEASURED against both repositories this fleet lands into, reading
 * `GET /repos/{owner}/{repo}/branches/{branch}/protection` and
 * `GET /repos/{owner}/{repo}/rules/branches/{branch}` for each:
 *
 * - `lachiejames/slopweaver` `main` — CLASSIC protection, `enforce_admins: false`, and **no
 *   `required_pull_request_reviews` object at all**. Nothing requires a review, so the administrator bypass
 *   is available and is this repository's ordinary landing path (`AGENTS.md` rule 1).
 * - the work repository's default branch — the classic endpoint answers **404**, and every rule in force
 *   comes from a repository RULESET: a `pull_request` rule with `require_code_owner_review: true`, and the
 *   ruleset's `bypass_actors` is EMPTY, so no actor — a repository administrator included — can merge past
 *   it. The owner's ruling is literally true there: it is not merely irresponsible, it is
 *   structurally impossible.
 *
 * ## Why the 404 was the actual defect
 *
 * `../../corpus/github/writeMerge.ts` translates that 404 into `kind: "unprotected"`, which is correct about
 * CLASSIC protection and wrong about the branch. Before this module existed, `../../cli/commands/github/
 * mergeAdminCore.ts` read it and printed *"carries no branch protection, so this merge needs no bypass"* over
 * a branch whose ruleset nothing can bypass — then permitted the merge. A route that cannot exist was being
 * offered as the clean one, which is exactly the class the owner keeps having to refuse by hand.
 *
 * So the requirement is read from BOTH mechanisms and unioned, the same call — and for the same reason —
 * `./mergeQueue.ts`'s `requiredContexts` makes about status-check contexts: a branch may be governed by
 * either, and each API reports only its own.
 *
 * This module is pure. The two payloads are read by the seam in `../../outbound/github/adminMerge.ts`.
 */
import { classifyProtectionReadFailure } from "../../corpus/github/protectionRead.js";
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadRest } from "./read.js";

/** One review requirement standing on a base branch, as the mechanism that carries it reports it. */
export interface ReviewRule {
  /** Which mechanism put it in force — the two are configured and reported by separate APIs. */
  readonly source: "branch-protection" | "ruleset";
  /** Whether the rule requires an approval from a CODEOWNERS owner of the changed paths. */
  readonly codeOwners: boolean;
  /** How many approving reviews the rule requires; zero alongside `codeOwners` is a real configuration. */
  readonly approvals: number;
}

/**
 * What this run established about the reviews a base branch requires.
 *
 * `unreadable` is its own member rather than an empty rule list, for the reason
 * `./requiredContexts.ts`'s own gate spells out: "the base requires no review" and "this run could not find
 * out what the base requires" are different facts, and a caller that cannot tell them apart merges on the
 * second one.
 */
export type ReviewGate =
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "read"; readonly branch: string; readonly rules: readonly ReviewRule[] };

/**
 * The classic `required_pull_request_reviews` object, as one rule — or none when the branch carries no
 * classic review requirement (including the 404 case, where the caller has nothing to hand in).
 *
 * @param protection the raw `GET …/branches/{branch}/protection` payload, unvalidated
 * @returns the single classic rule, or undefined when classic protection requires no review
 */
export function classicReviewRule({ protection }: { protection: unknown }): ReviewRule | undefined {
  const reviews = isRecord(protection) ? protection["required_pull_request_reviews"] : undefined;
  if (!isRecord(reviews)) {
    return undefined;
  }
  const approvals =
    typeof reviews["required_approving_review_count"] === "number" ? reviews["required_approving_review_count"] : 0;
  const codeOwners = reviews["require_code_owner_reviews"] === true;
  if (!codeOwners && approvals === 0) {
    return undefined;
  }
  return { approvals, codeOwners, source: "branch-protection" };
}

/**
 * One effective branch rule as a review requirement, or undefined for every rule that is not one.
 *
 * The ruleset field is `require_code_owner_review`, SINGULAR — classic protection spells the same fact
 * `require_code_owner_reviews`. Reading either name for the other silently answers false, which is a permit
 * rather than a refusal, so both spellings are named here at the boundary where the difference is visible.
 *
 * @param rule one entry of REST's rules-for-a-branch array, unvalidated
 * @returns the requirement it carries, or undefined when it carries none
 */
function ruleReviewRequirement({ rule }: { rule: unknown }): ReviewRule | undefined {
  if (!isRecord(rule) || rule["type"] !== "pull_request") {
    return undefined;
  }
  const parameters = rule["parameters"];
  if (!isRecord(parameters)) {
    return undefined;
  }
  const approvals =
    typeof parameters["required_approving_review_count"] === "number"
      ? parameters["required_approving_review_count"]
      : 0;
  const codeOwners = parameters["require_code_owner_review"] === true;
  if (!codeOwners && approvals === 0) {
    return undefined;
  }
  return { approvals, codeOwners, source: "ruleset" };
}

/**
 * Shape REST's effective branch rules into every review requirement in force.
 *
 * A payload with no `pull_request` rule is a STATE rather than a fault — it answers an empty list, exactly
 * as `./branchRules.ts`'s own contexts parser does, and the caller decides what that means.
 *
 * @param data the raw `GET …/rules/branches/{branch}` response
 * @param branch the branch the rules were asked for, named in a malformed-payload error
 * @param identity the `owner/name` slug, named in a malformed-payload error
 * @returns the review requirements the rulesets carry, or the typed read failure
 */
export function parseRulesetReviewRules({
  data,
  branch,
  identity,
}: {
  data: unknown;
  branch: string;
  identity: string;
}): Result<readonly ReviewRule[], GithubLiveError> {
  const payload = isRecord(data) ? data["data"] : undefined;
  const list = Array.isArray(payload) ? payload : undefined;
  if (list === undefined) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned no rules array for ${identity} on ${branch}` }));
  }
  return ok(
    list.map((rule) => ruleReviewRequirement({ rule })).filter((rule): rule is ReviewRule => rule !== undefined),
  );
}

/** One rule, as the half-sentence that names what it requires and which mechanism carries it. */
function ruleClause({ rule }: { rule: ReviewRule }): string {
  const what = rule.codeOwners
    ? "an approving review from a CODEOWNERS owner of the changed paths"
    : `${String(rule.approvals)} approving review(s)`;
  const both = rule.codeOwners && rule.approvals > 0 ? ` plus ${String(rule.approvals)} approving review(s)` : "";
  const mechanism = rule.source === "ruleset" ? "a repository ruleset" : "classic branch protection";
  return `${mechanism} requires ${what}${both}`;
}

/**
 * The refusal for a base branch that requires a review, or undefined when `--admin` has a real route.
 *
 * **A ruleset requirement is refused unconditionally, and that is the owner's ruling made mechanical.**
 * `enforce_admins` is a field of CLASSIC protection and waives nothing a ruleset carries; a ruleset is
 * bypassed only by an actor listed in its own `bypass_actors`, and the work repository's carries none. So the
 * merge this flag would attempt cannot succeed, and offering it costs the owner a hand-typed refusal every
 * time — which is the whole reason this exists rather than a warning.
 *
 * A CLASSIC review requirement alongside `enforce_admins: false` is the one shape that is genuinely
 * bypassable, and it is still refused here: `../../cli/commands/github/mergeAdminCore.ts` already names the
 * `enforce_admins: true` half, and this repository's own `main` requires no review at all, so nothing this
 * fleet lands needs it. Narrowing what a session may do never needs anyone's authority.
 *
 * @param gate what the live read established about the base branch
 * @param baseRef the branch being merged into, named so the line reads standalone
 * @returns the refusal line, or undefined when no review requirement stands
 */
export function reviewGateRefusal({ gate, baseRef }: { gate: ReviewGate; baseRef: string }): string | undefined {
  if (gate.kind === "unreadable") {
    return undefined;
  }
  if (gate.rules.length === 0) {
    return undefined;
  }
  const clauses = gate.rules.map((rule) => ruleClause({ rule })).join("; ");
  const ruleset = gate.rules.some((rule) => rule.source === "ruleset");
  const impossible = ruleset
    ? "A ruleset is not what `enforce_admins` waives and not what admin permission bypasses — only an actor " +
      "listed in the ruleset's own bypass_actors merges past it — so this merge is not irresponsible, it is " +
      "structurally impossible."
    : "An administrator could technically bypass this, and that is exactly the route this door does not offer.";
  return (
    `${baseRef} requires a review before anything lands on it — ${clauses}. ${impossible} ` +
    "Get the review the branch asks for (`slopweaver github review-state` names who owes one, " +
    "`slopweaver github pr request-review` asks them); --admin is not a route here and must never be offered as one."
  );
}

/**
 * Read both mechanisms for one base branch and union what they require.
 *
 * The classic endpoint answering **404** is a STATE, not a fault — it means the branch carries no classic
 * protection, which on a ruleset-governed branch is the normal case and was the exact reading that made the
 * old permit wrong. It contributes no rule and never fails the read; the ruleset half still runs.
 *
 * @param rest the injected REST transport both reads go through
 * @returns a function answering what reviews one base branch requires, or why that could not be established
 */
export function makeReviewGateRead({
  rest,
}: {
  rest: GithubReadRest;
}): (args: { owner: string; repo: string; branch: string }) => Promise<ReviewGate> {
  return async ({ owner, repo, branch }) => {
    const identity = `${owner}/${repo}`;
    const rules: ReviewRule[] = [];
    const protection = await rest({
      params: { branch, owner, repo },
      route: "GET /repos/{owner}/{repo}/branches/{branch}/protection",
    });
    if (protection.isOk()) {
      const classic = classicReviewRule({
        protection: isRecord(protection.value) ? protection.value["data"] : undefined,
      });
      if (classic !== undefined) {
        rules.push(classic);
      }
    } else if (!classicContributesNothing({ error: protection.error })) {
      return { kind: "unreadable", reason: protection.error.message };
    }
    const answered = await rest({
      params: { branch, owner, repo },
      route: "GET /repos/{owner}/{repo}/rules/branches/{branch}",
    });
    if (answered.isErr()) {
      return { kind: "unreadable", reason: answered.error.message };
    }
    const ruleset = parseRulesetReviewRules({ branch, data: answered.value, identity });
    if (ruleset.isErr()) {
      return { kind: "unreadable", reason: ruleset.error.message };
    }
    return { branch, kind: "read", rules: [...rules, ...ruleset.value] };
  };
}

/**
 * Whether a failed REST read was GitHub's 404 rather than a real fault.
 *
 * Matched on the message because the transport flattens the provider's status into one, and here the
 * difference between "no classic protection" and "the read failed" decides whether a merge is permitted — so
 * it fails CLOSED: anything it cannot recognise as a 404 is `unreadable`. `github pr reviewers` asks the same
 * question of each place a CODEOWNERS file may sit.
 *
 * @param error the typed read failure
 * @returns whether it is GitHub's not-found answer
 */
export function isNotFound({ error }: { error: GithubLiveError }): boolean {
  return /\b404\b|not found/i.test(error.message);
}

/**
 * Whether a failed classic-protection read means classic protection contributes no review rule, so the ruleset
 * half still runs: GitHub's 404 (no protection) or its plan-gated 403 (the plan cannot protect a branch).
 *
 * When the transport carried the boundary failure as `cause` with an HTTP status, that STATUS decides, through
 * `../../corpus/github/protectionRead.ts`'s classifier — so a 403 whose message happens to say "Not Found" stays
 * `unreadable`, and the plan answer needs the status and GitHub's whole sentence both. Only a failure carrying no
 * status falls back to `isNotFound`'s message match, which fails closed on anything it does not recognise.
 *
 * @param error the typed read failure
 * @returns whether the classic half is absent rather than unread
 */
function classicContributesNothing({ error }: { error: GithubLiveError }): boolean {
  const cause = error.code === "READ_FAILED" ? error.cause : undefined;
  if (isIngestError(cause) && cause.status !== undefined) {
    const disposition = classifyProtectionReadFailure({ failure: cause });
    return disposition === "unprotected" || disposition === "plan-unavailable";
  }
  return isNotFound({ error });
}

/** Whether a carried `cause` is the boundary's own typed failure, which is what the read transport hangs there. */
function isIngestError(value: unknown): value is IngestError {
  return isRecord(value) && typeof value["kind"] === "string" && typeof value["message"] === "string";
}
