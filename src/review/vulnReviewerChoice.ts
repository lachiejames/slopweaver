/**
 * WHO each line of a dependency-bump post asks — the `#dev-alerts` convention, as code.
 *
 * ## The convention
 *
 * - **The default reviewers take every line they can clear, alternating.** The roster names them
 *   (`../live/vuln/reviewerMap.ts`'s `defaults`); each line goes to whichever of them has fewer lines so far
 *   in this post, ties going to whichever was asked longer ago and then to roster order, so a batch splits
 *   evenly and a line forced to one default never puts the other on two lines in a row.
 * - **A code-owner rule no default can clear is the exception.** Then the line asks the first roster
 *   `fallbacks` person who clears EVERY rule GitHub still holds on it, and its {@link VulnReviewerChoice.why}
 *   names the rule the defaults cannot clear. One person, because one approval from them clears it all.
 * - **Nobody clearing every rule still asks ONE person.** When no roster person clears them all — a line owing
 *   two teams nobody is on both of — it asks whoever clears the MOST rules, defaults before fallbacks on a tie,
 *   and the rules their approval leaves are its `stillOwed`, asked for separately once they approve. One person
 *   per line at a time; the line is never held for want of a second name.
 * - **Nobody clearing any rule is a refusal for that line, never a group.** It comes back `refused` with the
 *   rules and the people it checked, and the caller withholds that one line: a group tag on a line is a line
 *   nobody owns.
 *
 * ## What "clears a rule" means
 *
 * GitHub's own semantics: a rule is its owner tokens, any ONE of whom satisfies it, and a pull request owes
 * EVERY rule it invoked. A person clears a rule when they are one of its user tokens or a member of one of its
 * team tokens. Team membership is read live by the caller and handed in, so this module stays pure.
 *
 * The author never reviews their own pull request, so the author is never chosen.
 */

/**
 * Who one line asks, or why nobody on the roster can be asked. `stillOwed` is every rule the asked person does
 * not clear, in the line's own order — empty when their one approval clears them all.
 */
export type VulnReviewerChoice =
  | {
      readonly kind: "asked";
      readonly login: string;
      readonly why: string;
      readonly stillOwed: readonly (readonly string[])[];
    }
  | { readonly kind: "refused"; readonly why: string };

/** The roster the choice is made from, by lower-cased GitHub login. */
export interface VulnReviewerRoster {
  readonly defaults: readonly string[];
  readonly fallbacks: readonly string[];
}

/** One line to choose for: the rules GitHub still holds on it, and who opened it. */
export interface VulnReviewerLine {
  /** Each owed rule as the `@`-prefixed owner tokens any one of whom clears it; AND across entries. */
  readonly owedCodeowners: readonly (readonly string[])[];
  readonly authorLogin: string;
}

/** Every team a rule names, `org/slug` lower-cased, to the lower-cased logins of its members. */
export type VulnTeamMembers = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The teams the given lines' owed rules name, each once — what the caller reads membership for.
 *
 * @param lines the lines about to be chosen for
 * @returns each team as `org/slug`, lower-cased
 */
export function vulnOwedTeams({ lines }: { lines: readonly VulnReviewerLine[] }): readonly string[] {
  const teams = lines.flatMap((line) => line.owedCodeowners.flat()).filter((token) => token.includes("/"));
  return [...new Set(teams.map((token) => ownerKey({ token })))];
}

/**
 * Choose who every line of one post asks.
 *
 * All lines at once rather than one at a time, because alternation is a property of the post: which default a
 * line gets depends on how many the other already has.
 *
 * @param lines the post's lines, in the order they appear
 * @param roster the defaults and the fallbacks, by lower-cased login
 * @param members every team {@link vulnOwedTeams} named, with its members
 * @returns one choice per line, in the same order
 */
export function vulnReviewerChoices({
  lines,
  roster,
  members,
}: {
  lines: readonly VulnReviewerLine[];
  roster: VulnReviewerRoster;
  members: VulnTeamMembers;
}): readonly VulnReviewerChoice[] {
  const asked: string[] = [];
  const loadOf = ({ login }: { login: string }): number => asked.filter((each) => each === login).length;
  return lines.map((line): VulnReviewerChoice => {
    // On a load tie the one asked longer ago goes next, so a forced line never puts one default on two in a row.
    const defaultsInTurn = roster.defaults.toSorted(
      (left, right) =>
        loadOf({ login: left }) - loadOf({ login: right }) || asked.lastIndexOf(left) - asked.lastIndexOf(right),
    );
    const author = line.authorLogin.toLowerCase();
    const clearedBy = ({ login }: { login: string }): number =>
      login === author ? 0 : line.owedCodeowners.filter((rule) => ruleClearedBy({ login, members, rule })).length;
    const clears = ({ login }: { login: string }): boolean =>
      login !== author && clearedBy({ login }) === line.owedCodeowners.length;
    const held = rulesSentence({ rules: line.owedCodeowners });
    const chosen = defaultsInTurn.find((login) => clears({ login }));
    if (chosen !== undefined) {
      asked.push(chosen);
      return defaultChoice({ held, login: chosen, ruleCount: line.owedCodeowners.length });
    }
    const missed = rulesSentence({
      rules: line.owedCodeowners.filter((rule) =>
        roster.defaults.every((login) => login === author || !ruleClearedBy({ login, members, rule })),
      ),
    });
    const fallback = roster.fallbacks.find((login) => clears({ login }));
    if (fallback !== undefined) {
      return {
        kind: "asked",
        login: fallback,
        stillOwed: [],
        why: `code-owner exception — no default reviewer clears ${missed}, and ${fallback} clears every rule GitHub holds (${held})`,
      };
    }
    const partial = mostRulesCleared({ candidates: [...defaultsInTurn, ...roster.fallbacks], clearedBy });
    if (partial === undefined) {
      return refusedChoice({ fallbacks: roster.fallbacks, held, missed });
    }
    if (roster.defaults.includes(partial)) {
      asked.push(partial);
    }
    return partialChoice({ held, login: partial, members, rules: line.owedCodeowners });
  });
}

/** A default reviewer clearing every rule GitHub holds, or a line holding none. */
function defaultChoice({
  held,
  login,
  ruleCount,
}: {
  held: string;
  login: string;
  ruleCount: number;
}): VulnReviewerChoice {
  return {
    kind: "asked",
    login,
    stillOwed: [],
    why:
      ruleCount === 0
        ? "default reviewer, next in turn — GitHub holds no code-owner rule on it"
        : `default reviewer, next in turn — clears every code-owner rule GitHub holds (${held})`,
  };
}

/** Nobody on the roster clears a single rule, so this one line is withheld, never given to a group. */
function refusedChoice({
  fallbacks,
  held,
  missed,
}: {
  fallbacks: readonly string[];
  held: string;
  missed: string;
}): VulnReviewerChoice {
  const checked = fallbacks.length === 0 ? "none are listed" : `checked ${fallbacks.join(", ")}`;
  return {
    kind: "refused",
    why:
      `no one on the roster clears any code-owner rule GitHub holds (${held}) — no default clears ${missed}, ` +
      `and no fallback does (${checked}); add a person who clears it to the roster's fallbacks rather than ` +
      "tag a group",
  };
}

/** The one person clearing the most rules, and the rules still owed once they approve. */
function partialChoice({
  held,
  login,
  members,
  rules,
}: {
  held: string;
  login: string;
  members: VulnTeamMembers;
  rules: readonly (readonly string[])[];
}): VulnReviewerChoice {
  const stillOwed = rules.filter((rule) => !ruleClearedBy({ login, members, rule }));
  const cleared = rules.filter((rule) => ruleClearedBy({ login, members, rule }));
  return {
    kind: "asked",
    login,
    stillOwed,
    why:
      `one person at a time — nobody on the roster clears every rule GitHub holds (${held}); ${login} clears ` +
      `${rulesSentence({ rules: cleared })}, and still owed after their approval is ` +
      `${rulesSentence({ rules: stillOwed })}, asked for separately once they approve`,
  };
}

/**
 * The one roster person clearing the most of a line's rules, at least one, the first in the given order on a tie.
 *
 * @param candidates the defaults in turn order, then the fallbacks in roster order
 * @param clearedBy how many of the line's rules one login clears, the author always none
 * @returns the login, or `undefined` when nobody clears a single rule
 */
function mostRulesCleared({
  candidates,
  clearedBy,
}: {
  candidates: readonly string[];
  clearedBy: (input: { login: string }) => number;
}): string | undefined {
  // A fold, never `Math.max(...spread)`: the roster's length is unbounded and a spread overflows the stack.
  const best = candidates.reduce((most, login) => Math.max(most, clearedBy({ login })), 0);
  return best === 0 ? undefined : candidates.find((login) => clearedBy({ login }) === best);
}

/** Whether one login clears one rule: named on it, or a member of a team named on it. */
function ruleClearedBy({
  login,
  members,
  rule,
}: {
  login: string;
  members: VulnTeamMembers;
  rule: readonly string[];
}): boolean {
  return rule.some((token) => {
    const key = ownerKey({ token });
    return token.includes("/") ? members.get(key)?.has(login) === true : key === login;
  });
}

/** An owner token as the key it is compared by: no `@`, lower-cased. */
function ownerKey({ token }: { token: string }): string {
  return token.replace(/^@/, "").toLowerCase();
}

/** Rules as a reader parses them: `A AND (B or C)`, and an author-only rule said as such. */
function rulesSentence({ rules }: { rules: readonly (readonly string[])[] }): string {
  return rules
    .map((rule) => {
      const [only, ...more] = rule;
      if (only === undefined) {
        return "(a rule only the author owns)";
      }
      return more.length === 0 ? only : `(${rule.join(" or ")})`;
    })
    .join(" AND ");
}
