# Reading a pass's output, and why its bounds are shaped this way

Detail lifted out of [the Codex skill](../SKILL.md) so its body stays inside the 200-line agent-doc cap. None
of it changes what you DO — the skill body carries that — but each part is the reason a line there reads the
way it does.

## The one-line human summary carries WHY, not just WHAT

Both the immediate `<pass> <verdict> → <artifact>` line and every row of `slopweaver codex status` append a
short, bounded clause for anything short of a clean first-try answer — a blocker count, which property a
`BROKEN` counterexample scopes to, the no-verdict reason plus what was salvaged before the stop, or that a
clean answer only arrived after a recovery turn. This is composition of data the artifact already carried,
never a new confidence concept: it never quotes the model's own prose (summary, blockers, evidence,
counterexample), because that is unbounded and can itself read as more alarming than the actual finding. Read
the artifact for the full account; the line is only ever a pointer to why it says what it says.

## The measured evidence behind one-property-per-call, and behind the two bound rules

| shape                                | result                                           |
| ------------------------------------ | ------------------------------------------------ |
| review: ~25 checks in one call       | 115 calls, 1h50m, **no verdict**                 |
| review: ONE property, diff supplied  | **51 seconds**, correct finding, zero tool calls |
| plan: narrowed prompt, SAME bound    | still **no verdict** — narrowing did not help    |
| plan: `no-conclusion-in-bound` cases | **100% of a 25-to-30-minute bound**, every one   |

That last row is the whole reason a plan's remedy is "raise the bound to match the breadth" while a review's
is "narrow the property": narrowing a planning prompt was measured NOT to help, and every unconverged plan
had used its entire bound.

## Which tree a pass reads, and the counter that says it read nothing

A pass reads a frozen snapshot of ONE repository: `--repo <dir>` when given, else the git toplevel of the
directory you ran it from (`src/cli/commands/codex/run.ts`). Codex's own working directory is the pass's
empty scratch directory, which is the write boundary, and the prompt points it at the snapshot. So run a pass
from the worktree whose tree you mean, or pass `--repo "$(git rev-parse --show-toplevel)"` from it; launched
from anywhere else it plans over whatever tree that directory belongs to.

**A pass that can read nothing looks exactly like one reading everything.** The progress line keeps printing a
percentage, an ETA and a rising command count; only the heartbeat's FAILED count tells them apart. MEASURED:
a P1 pass pointed at an empty directory ran 13 minutes and 90 commands, every one failed, and
returned nothing usable; the same pass over the real tree reported zero failed and caught a live canon defect.
Read the failed count once, early, in `$SLOPWEAVER_HOME/orchestration/stream-<pass>-<pid>.log`: zero failed
in the first minute is what a correctly aimed pass looks like.

Tool calls are EXPECTED: the diff is a file, so reading it takes one, and web search is available. What
matters is what a pass touches, not how often — it streams every command, so watch the paths. The prompt tells
Codex the diff is complete, so a well-scoped pass has nothing to go looking for.
