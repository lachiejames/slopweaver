/**
 * Which CODEOWNERS rules a pull request has actually SATISFIED — the question `reviewDecision` was supposed
 * to answer and does not.
 *
 * ## Why this exists, stated as the failure it was written from
 *
 * MEASURED: three rows told the owner to merge pull requests whose codeowners had not approved, and GitHub
 * refused all three. The read that produced them decided readiness from CI, from the CodeRabbit loop and from
 * whether a human had reviewed at all — none of which is the codeowner requirement. The one field that would
 * have said so, `PullRequest.reviewDecision`, came back **null on every pull request read live**, so a leg trusting it learns nothing. This module computes the answer from GitHub's own
 * two inputs instead: the rules themselves, and the reviews that have landed.
 *
 * **One satisfied rule is not all of them, and that is the trap this module is shaped around.** The row that
 * was confidently wrong named a required approver who really was one — and the two team rules the same pull
 * request invoked were both still owed, which is why GitHub was showing "Review required, 2 pending". So the
 * unit here is the RULE ({@link ../review/codeowners.requiredRules}), never the flattened owner token, and a
 * verdict is the conjunction over every invoked rule rather than the existence of one tick.
 *
 * ## The three answers, and why `unknown` is one of them
 *
 * A user token is decidable from here: either that login's latest opinionated review is an approval or it is
 * not. A TEAM token is not — team membership is not in anything this read fetches, so an approval from
 * somebody who happens to be a member is invisible. Rather than guess in either direction, the two pieces of
 * evidence GitHub does hand over are used. **An approval GitHub recorded ON BEHALF OF the team** (the review's
 * `onBehalfOf`, the satisfied owner its own interface renders) satisfies it, while that reviewer's latest
 * opinion is still the approval. **A review request GitHub still has out to the team**, which it removes when
 * a member reviews, makes it `unsatisfied` and can be said out loud. A team with neither is `unknown`, never
 * `satisfied`.
 *
 * MEASURED on one `acme/acme-admin` pull request: all three codeowner teams carried an on-behalf-of
 * approval, and this module, reading only the request register, printed `5/6 unproven` — the row a chase then
 * read as a codeowner tick still owed. Reproduce: `slopweaver github review-state --repo acme/acme-admin
 * --number <n> --json` and compare `githubCodeowners.owners` against `codeowners.rules`.
 *
 * That asymmetry is deliberate. The costly error is asserting ready when it is not — it sends the owner to a
 * merge button GitHub refuses — so nothing here reads `satisfied` from an absence.
 *
 * ## The team answer rides along
 *
 * The same rule states decide WHICH TEAMS a review depends on and whether that is an AND or an OR, which the
 * owner needs because the GitHub interface makes it painful to work out. That
 * lives in `./codeownerTeams.ts` and is attached here as {@link CodeownerReviewState.teams} rather than being
 * re-derived by each consumer — two consumers deriving the same answer separately is two answers.
 *
 * Pure. The clock, the network and the roster are somebody else's problem.
 */

import { type CodeownersRule, isSelfOwner, ownerKind, type RequiredRule, requiredRules } from "./codeowners.js";
import { type CodeownerTeamRequirement, codeownerTeamRequirement } from "./codeownerTeams.js";

/** Whether one invoked rule has been satisfied, and `unknown` when membership makes it undecidable here. */
export type RuleSatisfaction = "satisfied" | "unsatisfied" | "unknown";

/** One invoked CODEOWNERS rule, with whether a landed review has satisfied it and what decided that. */
export interface CodeownerRuleState {
  readonly pattern: string;
  readonly owners: readonly string[];
  readonly paths: readonly string[];
  readonly satisfaction: RuleSatisfaction;
  /**
   * The owners that could still clear this rule — the author's own token excluded, because a row naming the
   * author as the person to chase is a row that never clears. Empty on a satisfied rule, and empty on one
   * the author alone owns, which is the shape that can never be satisfied at all.
   */
  readonly clearableBy: readonly string[];
  /**
   * The login whose approval satisfied it, the `org/team` GitHub recorded an approval on behalf of, or the
   * empty string when nothing did.
   */
  readonly satisfiedBy: string;
  /** The sentence a row shows — always populated, including on `satisfied`. */
  readonly why: string;
}

/**
 * The whole pull request's codeowner answer. `none` means the changed paths invoked no rule at all, which is
 * a real answer and not a failure — a repository may declare no CODEOWNERS, or the paths may fall outside it.
 */
type CodeownerVerdict = "satisfied" | "unsatisfied" | "unknown" | "none";

/**
 * Two ways a {@link CodeownerReviewState} may not be the rule set GitHub enforces, as flags rather than prose
 * because `./requiredCodeowners.ts` branches on them.
 */
export interface CodeownerReadScope {
  /** Present only when GitHub reported more changed files than the read carried, so an invoked rule may be missing. */
  readonly changedPathsTruncated?: true;
  /**
   * Present only when the base is not the repository's default branch. The rules are read off the default
   * branch's tip while GitHub applies the BASE branch's file.
   */
  readonly codeownersOffBase?: true;
}

/** Every invoked rule, the ones still owed, and the verdict they add up to. */
export interface CodeownerReviewState {
  readonly rules: readonly CodeownerRuleState[];
  /** The rules that are not `satisfied` — what a consumer names instead of asserting the thing is ready. */
  readonly owed: readonly CodeownerRuleState[];
  readonly verdict: CodeownerVerdict;
  /** Why the verdict is not `satisfied`, or the empty string when it is. */
  readonly why: string;
  /**
   * Which TEAMS the review depends on, and whether it is an AND or an OR — the owner's need,
   * computed from the same rules rather than left for each consumer to re-derive off `rules`. Deriving it
   * per consumer is how the OWNERS cell and the detail block would disagree about the same pull request.
   */
  readonly teams: CodeownerTeamRequirement;
}

/** The owner tokens naming a team, and those naming a single account. */
function splitOwners({ owners }: { owners: readonly string[] }): {
  readonly users: readonly string[];
  readonly teams: readonly string[];
} {
  return {
    teams: owners.filter((token) => ownerKind({ token }) === "team"),
    users: owners.filter((token) => ownerKind({ token }) === "user"),
  };
}

/**
 * The slug half of a `@org/team` token, lower-cased — how GitHub names a team in a review request.
 *
 * Only ever called on a token {@link splitOwners} already classified as a team, which is exactly the test
 * for containing a slash, so the second half is asserted rather than defaulted.
 */
function teamSlug({ token }: { token: string }): string {
  return token.split("/")[1]!.toLowerCase();
}

/** The login half of a `@login` token, lower-cased. */
function ownerLogin({ token }: { token: string }): string {
  return token.replace(/^@/, "").toLowerCase();
}

/**
 * The teams an approval still standing was recorded on behalf of — GitHub's own record that a team's
 * codeowner requirement is met.
 *
 * Bound to the reviewer's LATEST opinion through `approvedLogins`: an approval that reviewer later replaced
 * with a change request no longer speaks for the team, and GitHub marks a dismissed one `DISMISSED` rather
 * than `APPROVED`, so neither counts here.
 *
 * @param reviews every submitted review the read carried, with the teams GitHub recorded it on behalf of
 * @param approvedLogins the lower-cased logins whose latest opinionated review is an approval
 * @returns the lower-cased `org/team` slugs
 */
export function approvedTeamsOf({
  reviews,
  approvedLogins,
}: {
  reviews: readonly { readonly login: string; readonly state: string; readonly onBehalfOf: readonly string[] }[];
  approvedLogins: ReadonlySet<string>;
}): ReadonlySet<string> {
  return new Set(
    reviews
      .filter((review) => review.state === "APPROVED" && approvedLogins.has(review.login.toLowerCase()))
      .flatMap((review) => review.onBehalfOf)
      .filter((team) => team !== "")
      .map((team) => team.replace(/^@/, "").toLowerCase()),
  );
}

/**
 * The approval that satisfies one rule, if any: a user owner who approved, else a team GitHub recorded an
 * approval on behalf of. Undefined when neither has landed.
 */
function approvalOf({
  users,
  teams,
  pattern,
  approvedLogins,
  approvedTeams,
}: {
  users: readonly string[];
  teams: readonly string[];
  pattern: string;
  approvedLogins: ReadonlySet<string>;
  approvedTeams: ReadonlySet<string>;
}): { readonly satisfiedBy: string; readonly why: string } | undefined {
  const approver = users.find((token) => approvedLogins.has(ownerLogin({ token })));
  if (approver !== undefined) {
    return {
      satisfiedBy: ownerLogin({ token: approver }),
      why: `${approver} approved, which satisfies \`${pattern}\``,
    };
  }
  const team = teams.find((token) => approvedTeams.has(ownerLogin({ token })));
  if (team !== undefined) {
    return {
      satisfiedBy: ownerLogin({ token: team }),
      why: `GitHub recorded an approval on behalf of ${team}, which satisfies \`${pattern}\``,
    };
  }
  return undefined;
}

/** One rule, decided against the approvals that have landed and the requests GitHub still has out. */
function ruleState({
  rule,
  authorLogin,
  approvedLogins,
  approvedTeams,
  requestedNames,
}: {
  rule: RequiredRule;
  authorLogin: string;
  approvedLogins: ReadonlySet<string>;
  approvedTeams: ReadonlySet<string>;
  requestedNames: ReadonlySet<string>;
}): CodeownerRuleState {
  const { users, teams } = splitOwners({ owners: rule.owners });
  const others = users.filter((token) => !isSelfOwner({ authorLogin, token }));
  const base = {
    clearableBy: [...others, ...teams],
    owners: rule.owners,
    paths: rule.paths,
    pattern: rule.pattern,
  };
  const approval = approvalOf({ approvedLogins, approvedTeams, pattern: rule.pattern, teams, users });
  if (approval !== undefined) {
    return { ...base, ...approval, clearableBy: [], satisfaction: "satisfied" };
  }
  if (base.clearableBy.length === 0) {
    return {
      ...base,
      satisfaction: "unsatisfied",
      satisfiedBy: "",
      why: `\`${rule.pattern}\` is owned only by the author, so nobody can ever satisfy it`,
    };
  }
  const undecidable = teams.filter((token) => !requestedNames.has(teamSlug({ token })));
  if (undecidable.length > 0) {
    return {
      ...base,
      satisfaction: "unknown",
      satisfiedBy: "",
      why:
        `no approval names an owner of \`${rule.pattern}\`, and whether a member of ${undecidable.join(" ")} ` +
        "has approved cannot be read from here — team membership is not in this read",
    };
  }
  return { ...base, satisfaction: "unsatisfied", satisfiedBy: "", why: owedBy({ rule, teams, users: others }) };
}

/** The sentence naming who still owes a review on one unsatisfied rule. */
function owedBy({
  rule,
  users,
  teams,
}: {
  rule: RequiredRule;
  users: readonly string[];
  teams: readonly string[];
}): string {
  const pending = teams.length === 0 ? "" : ` (GitHub still has a review request out to ${teams.join(" ")})`;
  return `\`${rule.pattern}\` is still owed a review by ${[...users, ...teams].join(" ")}${pending}`;
}

/**
 * Every codeowner rule a pull request invoked, decided.
 *
 * @param rules the repository's parsed CODEOWNERS, in file order
 * @param changedPaths the pull request's changed paths
 * @param authorLogin the pull request's author, who can never satisfy a rule that names them
 * @param approvedLogins the lower-cased logins whose LATEST opinionated review is an approval, bots and the
 *   author already excluded by the caller
 * @param approvedTeams the lower-cased `org/team` slugs a standing approval was recorded on behalf of —
 *   {@link approvedTeamsOf}
 * @param requestedReviewers the logins and team slugs GitHub currently has an open review request out to
 * @returns each rule's state, the ones still owed, and the verdict over all of them
 */
export function codeownerReviewState({
  rules,
  changedPaths,
  authorLogin,
  approvedLogins,
  approvedTeams,
  requestedReviewers,
}: {
  rules: readonly CodeownersRule[];
  changedPaths: readonly string[];
  authorLogin: string;
  approvedLogins: ReadonlySet<string>;
  approvedTeams: ReadonlySet<string>;
  requestedReviewers: readonly string[];
}): CodeownerReviewState {
  const requestedNames = new Set(requestedReviewers.map((name) => name.toLowerCase()));
  const states = requiredRules({ paths: changedPaths, rules }).map((rule) =>
    ruleState({ approvedLogins, approvedTeams, authorLogin, requestedNames, rule }),
  );
  const owed = states.filter((state) => state.satisfaction !== "satisfied");
  return {
    owed,
    rules: states,
    teams: codeownerTeamRequirement({ rules: states }),
    verdict: verdictOf({ owed, states }),
    why: whyOf({ owed, states }),
  };
}

/** The conjunction over every invoked rule — one unsatisfied rule decides the whole pull request. */
function verdictOf({
  states,
  owed,
}: {
  states: readonly CodeownerRuleState[];
  owed: readonly CodeownerRuleState[];
}): CodeownerVerdict {
  if (states.length === 0) {
    return "none";
  }
  if (owed.some((state) => state.satisfaction === "unsatisfied")) {
    return "unsatisfied";
  }
  return owed.length === 0 ? "satisfied" : "unknown";
}

/** The one sentence a consumer prints instead of asserting the pull request is ready. */
function whyOf({
  states,
  owed,
}: {
  states: readonly CodeownerRuleState[];
  owed: readonly CodeownerRuleState[];
}): string {
  if (states.length === 0) {
    return "the changed paths invoke no CODEOWNERS rule, so ownership requires no approval";
  }
  if (owed.length === 0) {
    return "";
  }
  return `${String(owed.length)} of ${String(states.length)} codeowner rules still owe a review: ${owed
    .map((state) => state.why)
    .join("; ")}`;
}
