# Who a dependency-bump post asks

The `mapped-codeowners` reviewer strategy for the batch posts of vulnerability-fix pull requests, which a row opts
into with `slopweaver vulnerability-fix digest --reviewer-strategy mapped-codeowners` (with no strategy, a line
names nobody and none of this is read). The people live in the install's roster,
`$SLOPWEAVER_HOME/live/vuln/reviewers.json`; the rule lives in `src/review/vulnReviewerChoice.ts`.

## The convention

- **Every posted line asks one person, and the post tags no user group.** A user group is a rotation with its
  own job, and reviewing a batch of bumps is not it.
- **The default reviewers take every line they can clear, alternating.** An install names as `defaults` the
  people whose teams between them own nearly every rule a bump touches — in the synthetic example,
  `reviewer-a` and `reviewer-b`, both on `@acme/platform` and `@acme/web`. Each line goes to whichever has
  fewer lines so far in the post; a tie goes to the one asked longer ago, then roster order.
- **The codeowners exception.** A line asks someone else ONLY when neither default can clear a code-owner rule
  GitHub still holds on it. Then it asks the ONE roster fallback who clears every owed rule, never a group,
  and the verb prints the rule that forced it. Worked example: a pull request in `acme/widgets` owes
  `@acme/web` AND `@acme/mobile`; neither default is on `@acme/mobile`, and the fallback `reviewer-c` is on
  both, so `reviewer-c` is asked.
- **A GitHub team never stands in for a person.** Team rules are answered by the team's membership, read
  live. Mapping a team onto one member puts that same member on nearly every line whenever both defaults sit
  on that team.
- **Nobody clears every rule: still ONE person, the rest asked later.** Pick one person, and bump
  another later once the first has ticked; a missing codeowner never blocks a pull request from getting
  reviews. The line asks whoever clears the MOST owed rules — defaults first on a tie, in turn order, then
  fallbacks in roster order — and the rules left are its `stillOwed`, asked for separately once they approve.
  Worked example: a pull request owes `@acme/web` and `@acme/data`, and nobody on the roster is on both, so
  the line asks the one who clears more of them and lists the other team as still owed.
- **Nobody clears a single rule: that one line is withheld**, named with its rules and who was checked, and
  the rest of the batch posts. The fix is a covering person added to the roster's `fallbacks`, never a group
  tag. Withholding empties a post only when every line is withheld.

## Which rules a line still owes

`LandingRow.owedCodeowners` (`src/review/owedCodeownerRules.ts`) takes GitHub's own `blockedOn` for
authority — EMPTY where GitHub would merge now ([landing.md](landing.md)) — and the parsed CODEOWNERS rules
for which owners are an AND and which an OR. A held owner no parsed rule names is kept as a rule of its own.

## The roster file

A GitHub login is not a person this machine can `@`-mention. The identity map links people by trusted email
and GitHub accounts here carry none — `slopweaver identity resolve quinn-acme` refuses while
`slopweaver identity resolve quinn` resolves. So the roster maps each login it names:

```json
{
  "logins": { "<github-login>": "<identity-map key>" },
  "defaults": ["<github-login>", "<github-login>"],
  "fallbacks": ["<github-login>"]
}
```

`defaults` is non-empty, and a login in `defaults` or `fallbacks` with no `logins` entry refuses the read. A
`teams` key is ignored. `--subteam` is refused by name on every `vulnerability-fix` sub-verb.
