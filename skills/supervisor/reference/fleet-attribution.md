# Whose load is it — fleet attribution, the orphan reap, and the sub-agent gate

Detail behind [machine-capacity.md](machine-capacity.md) § "The hold that named nobody". Read it before
raising either per-session threshold, and before proposing that a sub-agent count should hold a spawn.

## The incident, and what the verdict does about it

**MEASURED.** The machine sat at 1-minute load **100 to 146** against a hold of
22 for over two hours, everything ran ten times slower and asks took an hour. Eleven consecutive sweep ticks
published a `capacity-hold` reading, in full, `HOLD on cpu (1-min load 146, hold at 22)` — true, and naming
nobody — and the owner had to come in and ask why the fleet was so slow. Told the circumstances, the owner would
have said kill them.

The cause was entirely fleet-owned and entirely visible in one `ps` snapshot: **64 orphaned `zsh` shells** at
10-13% CPU each (parent `launchd`, from one dead seat's shell snapshot and one seat's test loops), plus **one
ask worker running nineteen tool calls in parallel**, each stuck **43 minutes** on its PreToolUse hooks. Hooks
took ~6 minutes per call at load 146; the chair could not even run `ps`.

**So the verdict names a CULPRIT, and the report attributes the load.** `machine capacity` groups every fleet
process by the session that owns it (climbing the parent chain to a `claude --session-id`), groups what no
live session owns by the **shell snapshot** it was launched from — the one identity that survives a session's
death — and reads two numbers per session:

- **tool calls in flight**: the largest number of concurrent processes running any ONE PreToolUse hook script
  under that session. One script fires once per tool call, so N of them is N parallel agents — the main thread
  and N-1 sub-agents.
- **hook stall**: the longest-running live PreToolUse hook, from `ps -ax -o pid=,etime=`.

**Which of them holds, and which only alerts, is the load-bearing half.** A hook past **300 s** HOLDS: the
measured normal is under one second and the incident measured ~6 minutes per call, so the line sits two to
three orders of magnitude clear of correct work. **A sub-agent COUNT never holds** — `skills/loop-bot` makes the
detective fan-out mandatory, "N is COUNTED off the probe, never chosen", and a measured lap ran 28 readers.
Nineteen parallel agents is inside a bot turn's normal range, so the count
ALERTS at **8** and stops nothing. Orphans alert at ONE, with no threshold to argue about: `machine reap` is
supposed to have taken them.

When something fires and a safe subject exists, the verdict appends ONE clause — `SUBJECT session <id> — 19 tool calls in flight,
its poll-gate hook stalled 43m; end it with \`kill <pid>\``— and`capacity-hold`carries the same two
strings as`culpritSubject`and`culpritKill`, so step 8's react-now card offers the kill without a supervisor
going looking. A CLEAN reading names nobody, deliberately: a subject in front of the owner every tick for doing
nothing wrong is how a real signal gets ignored. The per-session breakdown stays in the text report and
`--json`'s `fleet`, never in the verdict (rule 7).

**A kill is offered only to a session that did something measured, and never to the pinned chair.** The
pinned supervisor's Claude Code session (read from the recorded pin) is never a stalled or CPU-ranked
candidate: ending it ends the owner's one intake, so the pick moves to the next session. Outside a stall, a
live session is named for CPU only when the per-process sample was read and its own CPU measured above zero;
a `top` sample that failed leaves every session at 0%, and the top of that list is an arbitrary row, not a
cause. A stalled hook stays a candidate without CPU, because the stall is its own measurement, and a dead
seat's orphans may still be named with `machine reap`, which ends no live seat. With no safe candidate the
hold stands with no `SUBJECT` clause, and `capacity-hold` carries no `culpritKill`. `fleetCulprit`
(`src/live/machine/fleetCulprit.ts`) carries the order.

**A memory hold whose heaviest process of any kind is a watched daemon names THAT daemon, never a session.** Once
the verdict read `SUBJECT session … — 16% cpu; end it with kill …` while fseventsd held 32 GB: no
session kill frees a root daemon's memory. So `daemonCulprit` (`src/live/machine/daemonCulprit.ts`) runs first,
over the watched rows, and names the daemon with its `WATCHED_DAEMONS` relief as **the owner's one hand step,
never during a call**. That culprit is `endedBy: "owner"`, so `culpritKill` is withheld: the relief reaches the
owner only through the call-gated `fseventsd-bloated` card ([its reference](../../monitor/reference/fseventsd-bloated.md)),
and a seat's backoff keeps doubling, since no seat can end it.

## `machine reap` — the orphans, every tick, with no judgement

`slopweaver machine reap` kills every orphaned fleet shell whose seat is dead, and its whole descendant tree,
deepest first. Three facts from one `ps` snapshot decide it and there is nothing to weigh: the argv sources a
Claude Code shell snapshot, the parent is `launchd`, and **no un-reparented process shares that snapshot** —
which is the checkable form of "its session is gone". A live seat's orphan is reported and LEFT, which is a
false negative the next tick takes; the opposite mistake kills a running session's work. It never signals
`launchd` and never anything in its own parent chain. `--dry-run` plans and signals nothing.

Killing only the `zsh` would reparent its children to `launchd` and manufacture the same class, minus the argv
that makes them findable — the incident's cost was the children, not the shells.

**A pid is not an identity, so the verb re-checks before it signals.** The plan and the kill read two different
instants — the `top -l 2 -s 1` sample alone blocks ~1.45 s — and at load 146 fork churn is at its highest, which
is exactly when this verb runs. So every target carries the argv each of its pids HAD when it was selected, the
verb re-reads the table immediately before signalling, and a pid whose argv moved is reported rather than
killed. A review pass on this change found it.

## The second class it takes — docs dev servers that outlived what started them

Nine `next-server` processes once showed in Activity Monitor, eight of them `yarn docs` servers that
docs-site seats had started to screenshot their own pages and never stopped, **four in one worktree**. The
same verb ends one on three criteria, checked in this order and each printed on the row it fired for:
**no live session is reading it**, its **board row is terminal** by the derived state, or it is a
**duplicate** — a second server in a worktree where another has been up longer. `src/live/machine/devServers.ts`
decides; `slopweaver perf` counts the class above the fold and owes a REACT line for it.

**Criterion 1 is two questions, because a seat works wherever it likes.** MEASURED: a live seat
ran `cd <other worktree> && bash
scripts/docs-site.sh --start --port 3001` nine times in one morning; no registry row named that
worktree, so the reap killed each server the seat was reading and the seat started another — which is the
server the owner watched reappear under a worktree with no seat. **Reap was
the restarter.** So a server is seat-closed only when no session sits in its worktree AND the session its
docs-site run record names is no longer live — matched by session id as well as pid, so a recycled pid
protects nothing. The error it makes is the safe one: a live seat that starts a server and never
returns holds it until the seat dies, its row goes terminal, or a second server appears beside it.

**A `next-server` process's own argv carries nothing** — measured, it is literally
`next-server (v15.5.25)`, with no path and no port — so its identity is its working directory, read with one
`lsof -a -d cwd` bounded to the pids that already matched `next dev`/`next start`. A `next build` is never a
target: same binary, same family, not a server, and killing one destroys a build a seat is waiting on.

**Two boundaries make this safe to run every tick.** It only ever touches a FLEET worktree — one under the
repository's own worktrees directory — so the server the owner runs in the main checkout to read the docs is left
alone with that reason printed — one was standing there when this was measured. And the **longest-running
server of a worktree always survives** a duplicate verdict, so the class can never empty a worktree that is
being read. An unreadable cwd, and an unreadable seat or board reading, switch their criterion **off** rather
than counting as empty: an empty session list taken at face value would call every server on the machine
stray, including the one under the seat running the reap.

**Its one known limit, stated rather than discovered** (found by the `never-kills-a-server-in-use` review pass): a **seat is a live agent session**, read from Claude Code's own registry rather than from
cmux, which is what keeps this verb synchronous. So "its seat is gone" is narrower than "nobody is reading
it" — a `yarn docs` started by hand from a plain terminal **inside a fleet worktree** has neither a seat in
its worktree nor a recorded starter, so it reads as seat-closed and is taken. The main checkout, where that
shape actually happens, is excluded outright, and one `bash scripts/docs-site.sh --start` brings the other
case back.

## The third class it takes — browser sessions whose opener is gone, or that have gone quiet

Agent-opened Chrome windows piled up and the owner could not tell which were safe to close. The
mechanism is **ownership at open, liveness at reap, never age, never a promise**. `browser open` records the
opener's Claude Code pid, cmux workspace and run slug; the reap closes a session whose opener pid is gone, and
forgets a record no Playwright daemon holds any more. Eleven blank windows were once all one LIVE
seat's, one per page it had looked at. So a BACKGROUND session idle past its 15-minute expiry — one no command
may act through any more — is let go of too, whoever opened it; a foreground one (`browser present`) is not.
A live opener's session in use is kept however long ago it opened. An opener it cannot judge (a legacy record, an
unreadable registry) is kept unless its localhost page has nothing listening. A close the client cannot confirm
is never retried — a second `tab-close` would close whatever tab is now current — so it SIGTERMs the one daemon
still carrying that session (never two) and defers the rest to the next tick. `browser sessions` prints the same
verdict per row. `src/browser/sessionReap.ts` decides.

## The fourth class it takes — a live seat's runaway searches

**MEASURED**: six `ugrep` processes — Activity Monitor shows them as
`2.1.310`, because Claude Code's `grep` shell function execs its own binary under that name — each a child of
one LIVE seat's Bash tool shells, 20 to 58 minutes old at half a core each, held the machine at 0% idle for an
hour. They read a 17.5 GB bronze file with backtracking `-P` patterns. The orphan class never saw them (their
seat was alive), and the verdict named the SEAT and proposed `kill <session pid>`.

So a fourth class is taken, five facts from the same snapshot (`src/live/machine/runawaySearch.ts`): the
binary is a grep-family program or `rg`, a Claude Code tool shell is an ancestor, a live `--session-id` is
above that, it is at least **10 minutes** old, and it holds at least **20%** CPU. Only the search pid is
signalled — never the tool shell, never the seat, which keeps working and reads the tool call as failed. Age
alone would take `tail -F | grep` filters, which idle at 0%, and CPU alone would take a ten-second search.
Each search gets its OWN table re-read just before its signal, and is signalled only while the same live
session is still above it, so killing one can never act on a table that predates killing another.

**The culprit names the searches first**, ahead of a stalled session, as `runaway searches in session <id>`
with `slopweaver machine reap` as the kill. The subject carries no pid, so the anomaly register's dedupe key
does not rotate as each search ends. The reader-side half is the disk-scan gate's search row
([seat-never-scans](../../../docs/doctrine-rationale/seat-never-scans.md)).

**Its blind spots, stated:** a `find`/`bfs` (the gate's other row covers its roots), a search under an
`xargs`/`timeout` wrapper whose own argv is not the search, and one under the CPU floor — slow but not the
load.

## The sub-agent gate — `session no-subagents`

A worker whose brief forbids sub-agents is refused the Agent tool by a PreToolUse hook in that session, so the rule
is a gate and not prose. A session declares its own ban with
`slopweaver session no-subagents --why "<the brief clause>"`, and the `Agent|Task` PreToolUse hook then refuses
one in that session, printing the clause back with `SLOPWEAVER_ALLOW_SUBAGENT=1` as the hatch. `--clear` lifts
it; a ban lapses after `--hours` (default 12) so a stale record cannot wedge a session nothing can reach.

**The ban is DECLARED, never inferred from a dispatch's execution mode**, and that narrowing is the point. The
`continuous-drain` brief's "it must never block on a native subagent call" binds the LISTENER, which must
never stop reading the stream — not the worker it dispatched, which follows `skills/loop-bot` including the
mandatory fan-out. Inferring the ban from the mode would refuse the fan-out the owner ruled FOR, so the
brief names which session that clause binds.

**Its limit, stated rather than discovered.** A Claude Code PreToolUse payload carries `session_id`,
`tool_name`, `tool_input`, `cwd` and `transcript_path` and nothing that marks a sidechain, so a ban is a ban
on the SESSION and cannot express "the parent may spawn, a detective may not". `src/detective/brief.ts`'s flat
fan-out prohibition stays prose, and claiming otherwise would be false.
