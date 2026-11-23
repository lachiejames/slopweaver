# What a row's own shape tells the owner

Bundled reference for the `session-start` skill, linked from § Reading a row. Loaded when you are walking
the list with the owner, not on every turn. The four mandatory fields and the argue-with-the-rank clause are in
the skill body; this is what each row's own markings mean.

**Somebody else's move is not on the list — rule zero** (the owner's ruling, after the first list told the owner
to "approve and merge" five pull requests already with a named reviewer). An item waiting on another person is
held off until it has been silent past `DEFAULT_THRESHOLD_HOURS` (48, `src/silver/ruleZero.ts`), and then it
returns as a CHASE — "bump <who>" or "add a second reviewer", naming the person — never as doing their half.
Read a chase row out as that, and never present work sitting with a reviewer as the owner's.

**A row never truncates.** A long `doneWhen` is cut to one short headline for scanning, never with an
ellipsis — the whole question always reprints on its own `(full)` line right below when the headline had to
shorten it, so nothing on the list is ever lost with nowhere left to read it. A row naming a Linear key or
pull request (the cycle leg's own rows) carries its title on the line right under the headline too, so the
owner never has to open the link to know what the row is about.

**A Slack review ask carries the owner's code-owner share on the line right under the headline** (the owner's
ruling, on a thirty-file pull request: only one file, one line in one file, and the owner would have loved to
know that when they opened the PR). A mention naming exactly ONE open pull request gets `Yours as code owner, by login: 1 of 30
files, +1 -0 lines, in <path>` from the live re-read (`src/review/codeOwnerSlice.ts`): files whose deciding
CODEOWNERS line names the owner's login, at most three named. `by login` is literal: a team-owned file is never
counted as the owner's, because the owner's team memberships are never read. No line means it was NOT READ — several pull requests
(every link the message carries counts, in any repository), one closed before or during the read, a
partial file list, 300 files or more, an errored or email-owned CODEOWNERS line, a file renamed between a path
of the owner's and one that is not, the read bound or `--no-verify` — and the reason is under
`could not see`; only a complete read prints `none of the N files`.

**A row marked `CLOSE —` is a different kind of row.** The action on it is to close something, not to do it,
and it explains itself with what the TRACE found rather than with the signal that scored it. Never read one
out as work; only the cycle leg produces these.

**`· freshness unverified` means the live re-read could not reach that row**, not that it was skipped. Under
`--no-verify` every row carries it, and age stops counting for all of them.

**A row whose pull requests have ALL merged or closed never reaches the list at all.** It is reported under
`held back, already settled where it lives`, with the state GitHub gave. One still-open or unreadable
reference keeps the row — unread is not done.

**A pull request whose base is not the repository's default branch never appears as a review ask.** The
owner's ruling — do not ask the owner about 16355 until it is targeting staging — after the list asked the owner
to undraft the sixth pull request of a stack and name a reviewer. Its state is `stacked`, it is suppressed
from the list with a reason naming the pull request it waits on, and the ONE row that carries the stack's
ask is the bottom pull request's: its background reads `It is the bottom of a stack of 6 and carries the
stack's only review ask; … wait behind it until it lands.` Read that row out as one ask, never six.

**A row saying `its session is gone — resume it or abandon it` is not somebody waiting on the owner.** The
run's holding session no longer exists, so nothing will answer its recorded question or write back to it; the
row scores zero on `stoppedOnOwner` and sits below every run that does have a live session stopped on the owner.
It is still the owner's to rule on, which is why it is demoted rather than dropped. `unknown` liveness — a Codex holder, a
journal predating host-labelled ownership — reads as waiting, because unclassifiable is not dead.

**A `status update overdue` row needs the live re-read more than the others do**, because a project's bronze
record only re-lands when the project itself changes: a status update posted since is invisible to the corpus
at any cursor age, so a `--no-verify` row can name a project updated an hour ago (measured — the
cycle skill has the reproduction).
