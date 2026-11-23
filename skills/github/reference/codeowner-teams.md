# Which CODEOWNERS teams owe a review, and whether it is an AND or an OR

The detail behind [review-state.md](review-state.md) § Which TEAMS owe a review. The code is
`src/review/codeownerTeams.ts`, attached to every answer as `codeowners.teams`.

**Why it exists.** Working out who the code owners are is a massive pain in GitHub's own
interface, and the half that decides the owner's day is the connective: sometimes it is an and and
sometimes it is an or. So owners are joined by their connective and never by a space, in the cell and in the `--detail`
block's own `codeowner teams:` line:

- **`OR` inside one rule** — `/apps @org/a @org/b` is satisfied by ONE approval from either team.
- **`AND` across rules** — `/apps @org/a` plus `/infra @org/b` needs both, and a space-joined `@org/a @org/b`
  is the same text for both cases. That ambiguity is what the connective removes.
- **Parentheses only where they bind**: `(@org/a OR @org/b) AND @org/c`, never around a lone group.

**Rules with an IDENTICAL team set fold into ONE requirement**, and that collapse is not cosmetic. MEASURED
on two live pull requests: one invoked three rules but only TWO team requirements — one team owned
one rule, another owned two — because one person's approval satisfies every rule that person owns. A reader
told "3 rules owed" reasonably concludes three approvals are needed; GitHub needs two. So the sentence reads
`2 team requirements across 3 rules`, carrying both counts rather than replacing one with the other.

A rule a NAMED PERSON co-owns with a team is still a team dependency, but not only one — the line says so
(_"a named person can clear the same rule instead of the team"_) rather than asserting a team review that is
not the only route. A satisfied requirement stays in the expression marked `[approved]`, so the connective
never reads as though everything in it is still owed.

**The proof, and what `reviewDecision` could not settle.** Verified against GitHub's own
outstanding team review requests on two live pull requests: a two-team `AND` matched `{growth, customer}` and a
single-team read matched `{customer}` exactly. `reviewDecision` came back **null on both**, exactly as
[review-state.md](review-state.md) says it does, so it is not a comparator this answer can be checked against — the
outstanding requests are.

`--json` carries the whole structure at `codeowners.teams`: `quantifier` (`none`/`single`/`any`/`every`), the
flat `teams` list, the `expression`, the `sentence`, and one `groups` entry per requirement with its patterns,
its satisfaction and anybody who could clear it instead.
