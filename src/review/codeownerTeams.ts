/**
 * Which CODEOWNERS **teams** a pull request's review depends on, and whether it needs EVERY one of them or
 * ANY one of them — the question the GitHub UI answers with "Review required, 2 pending" and nothing else.
 *
 * ## Why this is its own answer rather than a reading of the rule list
 *
 * Working out who the code owners are is painful in GitHub's own interface, and the part that actually decides
 * what the owner does next is not the rule list — it is whether two named teams BOTH owe them a review or
 * whether either one will do, because sometimes the requirement is an "and" and sometimes an "or".
 *
 * Both connectives are real, and they come from two different places in the same file:
 *
 * - **OR, inside one rule.** `/apps @org/a @org/b` is satisfied by ONE approval from either team. That is
 *   GitHub's own semantics and it is why {@link ./codeowners.requiredRules} makes the rule the unit.
 * - **AND, across rules.** `/apps @org/a` plus `/infra @org/b` needs both. A flattened token list cannot tell
 *   the two apart — it prints `@org/a @org/b` either way — which is exactly the shape the OWNERS cell had
 *   before this module, and exactly the ambiguity this module removes.
 *
 * ## The one collapse that is not cosmetic
 *
 * MEASURED on one live pull request (`slopweaver github review-state --repo <slug> --number
 * <n> --json`): three invoked rules, but only TWO team requirements — one rule owned by one team and two
 * owned by another. A reader told "3 rules owed" reasonably concludes three approvals are needed; GitHub
 * needs two, because one person's approval satisfies every rule that person owns. So rules whose team set is
 * IDENTICAL fold into one group, and the count a consumer reads is the group count with the rule count
 * beside it rather than instead of it.
 *
 * Teams only. A rule owned by a named person is not a team dependency, but it is still a way the SAME rule
 * can be cleared without the team — so where that happens the group carries the people who could clear it
 * instead ({@link CodeownerTeamGroup.alsoClearableBy}) and the sentence says so, rather than asserting a team
 * review that is not actually the only route.
 *
 * Pure. It reads rule states somebody else decided; the clock, the network and team MEMBERSHIP are all
 * somebody else's problem — and membership is the reason a team rule can be `unknown` at all.
 */

import type { CodeownerRuleState, RuleSatisfaction } from "./codeownerRules.js";
import { ownerKind } from "./codeowners.js";

/**
 * How many of the named teams a review depends on.
 *
 * @internal
 *
 * `single` is deliberately not folded into `every`: with one team there is no connective to state, and
 * printing "EVERY team" over a list of one is the kind of ceremony a reader learns to skip past.
 */
export type TeamQuantifier = "none" | "single" | "any" | "every";

/**
 * One team requirement: the teams that can clear it, any ONE of which does.
 *
 * @internal
 */
export interface CodeownerTeamGroup {
  /** The team tokens as CODEOWNERS spells them, sorted and deduped — any one of them satisfies this group. */
  readonly teams: readonly string[];
  /** Every rule pattern that folded into this group, in the order the file declares them. */
  readonly patterns: readonly string[];
  /**
   * The named people who could clear the same rules instead, the author already excluded. Non-empty means
   * the team review is one route rather than the only one.
   */
  readonly alsoClearableBy: readonly string[];
  /** `satisfied` only when every rule folded in here is; `unsatisfied` when any one of them is. */
  readonly satisfaction: RuleSatisfaction;
}

/** The whole team answer for one pull request: the groups, the connective, and the line a reader reads. */
export interface CodeownerTeamRequirement {
  readonly groups: readonly CodeownerTeamGroup[];
  readonly quantifier: TeamQuantifier;
  /** Every distinct team token across all groups, sorted — the flat list a consumer that wants one takes. */
  readonly teams: readonly string[];
  /** The connective spelled out: `(@org/a OR @org/b) AND @org/c`, or the empty string when no team owns. */
  readonly expression: string;
  /** The whole sentence, including what the expression alone cannot say. Always populated. */
  readonly sentence: string;
}

/** The team tokens one rule names, sorted and deduped so two rules spelled differently still fold. */
function teamsOf({ rule }: { rule: CodeownerRuleState }): readonly string[] {
  return [...new Set(rule.owners.filter((token) => ownerKind({ token }) === "team"))].toSorted((a, b) =>
    a.localeCompare(b),
  );
}

/** The people who could clear a rule instead of its teams — `clearableBy` already drops the author. */
function peopleOf({ rule }: { rule: CodeownerRuleState }): readonly string[] {
  return rule.clearableBy.filter((token) => ownerKind({ token }) === "user");
}

/** One group's satisfaction, folded over the rules in it: any unsatisfied decides, then any unknown. */
function foldSatisfaction({ states }: { states: readonly RuleSatisfaction[] }): RuleSatisfaction {
  if (states.includes("unsatisfied")) {
    return "unsatisfied";
  }
  if (states.includes("unknown")) {
    return "unknown";
  }
  return "satisfied";
}

/** Every rule that names at least one team, folded into one group per distinct team set, in file order. */
function groupsOf({ rules }: { rules: readonly CodeownerRuleState[] }): readonly CodeownerTeamGroup[] {
  const byTeams = new Map<string, { rules: CodeownerRuleState[]; teams: readonly string[] }>();
  for (const rule of rules) {
    const teams = teamsOf({ rule });
    if (teams.length === 0) {
      continue;
    }
    const key = teams.join(" ");
    const existing = byTeams.get(key);
    if (existing === undefined) {
      byTeams.set(key, { rules: [rule], teams });
      continue;
    }
    existing.rules.push(rule);
  }
  return [...byTeams.values()].map((entry) => ({
    alsoClearableBy: [...new Set(entry.rules.flatMap((rule) => peopleOf({ rule })))],
    patterns: entry.rules.map((rule) => rule.pattern),
    satisfaction: foldSatisfaction({ states: entry.rules.map((rule) => rule.satisfaction) }),
    teams: entry.teams,
  }));
}

/** Which connective, if any, the groups add up to. */
function quantifierOf({ groups }: { groups: readonly CodeownerTeamGroup[] }): TeamQuantifier {
  const first = groups[0];
  if (first === undefined) {
    return "none";
  }
  if (groups.length > 1) {
    return "every";
  }
  return first.teams.length > 1 ? "any" : "single";
}

/**
 * The connective spelled out.
 *
 * A multi-team group is parenthesised only when there is something to bind it against — `(@a OR @b)` alone
 * reads as punctuation for its own sake, while `(@a OR @b) AND @c` is the whole point.
 */
function teamExpression({ groups }: { groups: readonly CodeownerTeamGroup[] }): string {
  const parenthesise = groups.length > 1;
  return groups
    .map((group) => {
      const joined = group.teams.join(" OR ");
      const bind = group.teams.length > 1 && parenthesise;
      const body = bind ? `(${joined})` : joined;
      return group.satisfaction === "satisfied" ? `${body} [approved]` : body;
    })
    .join(" AND ");
}

/** The clause naming every group a person could clear instead of its team, or the empty string. */
function personRouteClause({ groups }: { groups: readonly CodeownerTeamGroup[] }): string {
  const routed = groups.filter((group) => group.alsoClearableBy.length > 0);
  if (routed.length === 0) {
    return "";
  }
  const parts = routed.map((group) => `${group.teams.join(" OR ")} or ${group.alsoClearableBy.join(" or ")}`);
  return `; a named person can clear the same rule instead of the team — ${parts.join("; ")}`;
}

/** The count clause every populated sentence carries: how many groups, over how many rules. */
function countClause({ groups, ruleCount }: { groups: readonly CodeownerTeamGroup[]; ruleCount: number }): string {
  const patterns = groups.reduce((total, group) => total + group.patterns.length, 0);
  const plural = groups.length === 1 ? "" : "s";
  const noun = ruleCount === 1 ? "rule" : "rules";
  const rules =
    patterns === ruleCount ? `${String(ruleCount)} ${noun}` : `${String(patterns)} of ${String(ruleCount)} ${noun}`;
  return `${String(groups.length)} team requirement${plural} across ${rules}`;
}

/** The sentence for each quantifier — the connective said in words, not only in punctuation. */
function sentenceOf({
  groups,
  quantifier,
  ruleCount,
}: {
  groups: readonly CodeownerTeamGroup[];
  quantifier: TeamQuantifier;
  ruleCount: number;
}): string {
  if (quantifier === "none") {
    if (ruleCount === 0) {
      return "no CODEOWNERS rule was invoked at all, so no team owes a review";
    }
    return "no invoked CODEOWNERS rule names a team, so ownership is owed by named people rather than by any team";
  }
  const expression = teamExpression({ groups });
  const counts = countClause({ groups, ruleCount });
  const routes = personRouteClause({ groups });
  if (quantifier === "single") {
    return `${expression} — the only owning team (${counts})${routes}`;
  }
  if (quantifier === "any") {
    return `${expression} — OR: any ONE of those teams satisfies it (${counts})${routes}`;
  }
  return `${expression} — AND: every one of those teams owes its own review (${counts})${routes}`;
}

/**
 * Which teams a pull request's review depends on, and whether it is an AND or an OR.
 *
 * @param rules every CODEOWNERS rule the pull request's changed paths invoked, already decided
 * @returns the folded team groups, the connective they add up to, and the sentence a consumer prints
 */
export function codeownerTeamRequirement({
  rules,
}: {
  rules: readonly CodeownerRuleState[];
}): CodeownerTeamRequirement {
  const groups = groupsOf({ rules });
  const quantifier = quantifierOf({ groups });
  return {
    expression: teamExpression({ groups }),
    groups,
    quantifier,
    sentence: sentenceOf({ groups, quantifier, ruleCount: rules.length }),
    teams: [...new Set(groups.flatMap((group) => group.teams))].toSorted((a, b) => a.localeCompare(b)),
  };
}

/**
 * The same AND/OR shape over what is still OWED, teams and people alike — what a one-line cell prints.
 *
 * The cell has to answer "who do I chase" rather than "which teams own this", so it works over
 * {@link CodeownerRuleState.clearableBy} and keeps a named person in the expression. The connective is
 * identical because the semantics are: any one owner clears a rule, every rule must be cleared.
 *
 * @param owed the rules that are not satisfied, in file order
 * @returns the expression, or the empty string when nothing owed can be cleared by anybody
 */
export function clearanceExpression({ owed }: { owed: readonly CodeownerRuleState[] }): string {
  const byOwners = new Map<string, readonly string[]>();
  for (const rule of owed) {
    const tokens = [...new Set(rule.clearableBy)].toSorted((a, b) => a.localeCompare(b));
    if (tokens.length === 0) {
      continue;
    }
    byOwners.set(tokens.join(" "), tokens);
  }
  const groups = [...byOwners.values()];
  const parenthesise = groups.length > 1;
  return groups
    .map((tokens) => {
      const joined = tokens.join(" OR ");
      const bind = tokens.length > 1 && parenthesise;
      return bind ? `(${joined})` : joined;
    })
    .join(" AND ");
}
