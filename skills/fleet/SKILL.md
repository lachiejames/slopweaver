---
name: fleet
description: Bring the fleet back after a machine restart or a lockout with as little of the owner's attention as possible — the sessions page the desktop app shows (every seat red, flashing yellow or green, a capacity line of online over configured, each seat's priority band and board row), the one recovery pass it launches in a visible cmux tab (console, then the supervisor nudged, then every other seat by priority, then a bounded wait for the supervisor to say it is caught up), and the one button for the step only the owner can take. Use when the fleet is down after a restart, every seat reads "Not logged in", the console is down with nothing serving, the supervisor must say it is reoriented, or the capacity the page measures against changes, how much plan usage the fleet left on the table, or whether Claude and Codex can each still start a session at all (the Recovery check). Phrases like "fleet is down", "after a restart", "resume operations", "sessions page", "nothing is online", "zero of fifteen", "bring everything back", "fleet capacity", "reoriented".
argument-hint: "health [--json] [--home <dir>] | recover [--home <dir>] | resume [--episode <id>] [--reorient-seconds <n>] [--timeout-seconds <n>] [--json] | configure --capacity <n> | ceiling [--days <n>] [--json] | burn [--json] [--now <iso>] | landed [--limit <n>] [--ref <ref>] [--json] | restore-policy [--apply] [--config <path>] [--json] | status"
---

The owner's steer, after a restart took the fleet and the console down with nobody coordinating: the owner just
wants something that can gracefully allow them to resume operations with as little effort and thinking as possible.
So the desktop app does it, and the owner is asked only for what a machine cannot do for them. And quietly — the
owner's ruling: the owner wants the details of the fleet abstracted away from them, and does not want to be on the
hook for dealing with it. The page never raises itself; the owner sees the fleet when they open it. The Recovery check, `slopweaver fleet recover`, proves in one visible throwaway turn per vendor which of Claude and Codex can still start a session, falling back plan by plan; it runs from the command line or on the owner's Recovery press in the app, never on its own: [the Recovery check](reference/recovery-check.md).

## The verbs

```bash
slopweaver fleet health --json            # the sessions page's document; exit 0 healthy, 3 not, 1 no picture
slopweaver fleet resume                   # the recovery pass — run INSIDE a cmux tab
slopweaver fleet configure --capacity 15  # how many SESSIONS the capacity line counts against (default 15)
slopweaver fleet ceiling [--days 7] [--json] [--now <iso>] [--publish]  # plans' unused week vs working seats, and N
slopweaver fleet why [--minutes 60] [--json] [--now <iso>]  # why not more working seats, and what the machine measured
slopweaver fleet burn [--json] [--now <iso>] [--record-reading <by>]  # each host's tokens over 24h, the 7-day amount at that rate; --record-reading (with --json) appends the document
slopweaver fleet landed [--limit 30] [--ref origin/main] [--json]  # what landed on main, beside the owner's words and proof
slopweaver fleet restore-policy [--apply]  # is cmux's own session restore off; --apply turns it off
slopweaver fleet history [--hours 24] [--json] [--now <iso>]  # each tick's hold, load, ceilings, working, open ready
slopweaver supervisor reoriented --attempt <id>   # the pinned chair, once it is caught up
```

**`configure --capacity` is the page's display figure only; `ceiling` is what the supervisor fills to.**
`fleet ceiling` reads the plans' drawdown journal and the tick ledger, prints how much of each plan's week went
unused at its reset (an upper bound), the working seats against open ones, the burn per working seat, and **N**,
the working seats the plans' remaining week carries until each resets. The tick captures it and the fill gate
owes N ([fleet-ceiling.md](../supervisor/reference/fleet-ceiling.md)); the `fleet-ceiling-weekly` row pages it each
morning, carding a seat of headroom; a broken reading fails the firing, and its repair reruns `--now <slot> --publish`.

**`why` is the answer to "why is the fleet not running more right now".** It reads the ledger only: the newest
`machine capacity`, `fleet ceiling` and `session watch` readings, judged as ONE tick (a mismatch reads as unknown,
never a guess), and every sampled `machine capacity` reading in the window. It says what binds (plans, machine, both,
neither), how many readings held and on what, and where the cpu went: the seats, the heaviest foreign processes,
the cores no process accounts for. The tick records it as `fleet-why`, and the Fleet page shows its sentences
([fleet-ceiling.md](../supervisor/reference/fleet-ceiling.md) § Why not more).

**`burn` is the Fleet page's burn line per host.** It counts Claude transcripts once per `message.id`, all four
counters, and takes each Codex rollout as the rise of its cumulative total across the 24-hour window. "Drawing now"
means a draw in the last ten minutes. The seven-day amount at that rate is printed only for a host it measured whole;
a host with unreadable lines is a lower bound with no projection, and one it could not list says why
(`src/fleet/hostBurn.ts`). The tick records it as `fleet-burn`.

**`history` is the Fleet page's folded history of its state.** It reads the supervisor tick ledger from its END
until a tick predates the window (`src/fleet/stateHistoryRead.ts`; a week is 1–168 hours), and prints per tick the
facts the page judges with: the machine's hold and load, the plans' ceilings, the working count and how many ready
rows had nobody on. A fact a tick did not record is `null` or `not-recorded`, never a zero; one row that will not
parse refuses the read.

**`health` reads offline, from outside cmux.** The process table, each live session's boot credential, the
board, the console's run record and the recovery journal — no cmux socket and no network, which is why the app
can run it from Finder every half minute with the console and the supervisor both down.

**A seat is green on its OWN signal.** Live means the process at a registry record's pid started when the record
says its own did (`src/fleet/liveSeat.ts`), so a dead session's file whose pid a stranger inherited is no seat —
and `resume` finds the chair by the same rule. A
worker: live, and booted on a plan credential that can answer — a restored seat is live AND walled at once, so
liveness alone would paint a locked-out fleet green. The supervisor: booted on a credential bound to its process,
and only once it gave a sign of working — `supervisor reoriented` after that process started, or a sweep its pinned
workspace started and closed after it took the seat (the tick ledger's tail) — yellow until then, and red once ten
minutes pass from the later of its start and its pin with no pass running (`REORIENT_SECONDS`, the pass's own wait),
worded as the signal that has not arrived, so a chair that restarted on its own reads down and the pass nudges it
rather than the fleet settling forever. Its seat names its last sign and since when one was expected. The same ten minutes turn a seat whose plan
cannot be read red: with no pass running, no seat stays yellow longer. The capacity line
counts sessions alone — the supervisor and the workers green, over the configured capacity — so the Slack loop
and the keep-alive show as seats but neither fill a slot nor count online. An empty slot is red so the line reads
true, and never makes the fleet down.

**`resume` runs in this order**, under one lock, journalling each step to the store's recovery journal: the console
(`docs-site.sh --serve`), the pinned supervisor reseated if walled, a nudge into it pointing at
[reboot.md § Reoriented](../supervisor/reference/reboot.md#reoriented), every other walled or COLD seat by its board
row's priority through `cmux reseat`'s own pass, and only then a wait for the chair's `reoriented` line. It never starts
a fresh session in place of a lost one (`NO_LIVE_SESSION`); a LIVE seat with no transcript, or a `No conversation found` whose tab comes back to a bare prompt, boots fresh once
as `SEAT_NOT_RESUMED`, never recovered (a tab that never does is `RELAUNCH_FAILED`), while a COLD one with no transcript is refused `NO_RESUMABLE_SESSION`. A seat it could not bring back stays red with its reason until `session close-done` journals its
workspace gone (`src/fleet/goneSeats.ts`). A chair refused `NO_LIVE_SESSION` names why its tab was not read as a bare shell and the way
back — `fleet resume` again, or `cmux reseat <its ref>` from another tab, once the tab shows a prompt — because `session re-seat` never
seats the chair. A bare tab is read off cmux's `processes` AND its `unattributed_tty_process_pids` grafted from the process table: on cmux 0.65.2 the
tab's own `login` and shell sit only in the latter, and reading `processes` alone refused the whole fleet; a tab cmux reports NO pid for is tied by its surface `tty`. A console that will not start is
a `CONSOLE_FAILED` refusal, so the attempt reads `failed`, and health reads a console it cannot measure as down.

**Nothing about the chair, and no capacity reading, holds a worker** (measured once: four attempts
deferred, no worker touched, every seat reseated by the owner's hand). A chair with no pin, no tab or no live session is
recorded and the workers go on; a chair still walled after its relaunch is its own refusal; a chair slow to say it is
caught up ends the attempt `deferred` only AFTER every worker is reseated. A worker relaunch paces on boots in flight
(six inside 180s, `src/live/machine/recentBoots.ts`) for at most `--timeout-seconds` (default 180), then goes
regardless — a reseat replaces a session, it never adds one, and cpu and memory are not read. Only a relaunch that
failed after its stop halts the later workers, since the next would be stopped into the same failure.

**cmux's own restore stays OFF; `resume` is the only restore.** With `terminal.autoResumeAgentSessions` on, cmux
relaunches every seat's `claude --resume` on reopen without the setup-token env, so every seat comes back signed out,
in no order (measured). The owner's word: if it had to use our commands for restoration, that would
have been fine. `fleet restore-policy` reads the key (exit 0 off, 3 on); `--apply` turns it off behind a timestamped `.bak`.
Then a reopened tab is a bare shell (one childless known shell, read twice), a COLD seat (`src/sessions/coldSeat.ts`):
the chair's is resumed on the supervisor PIN first, and counts as standing only where the pin's own pid then runs
in its tab; a worker's is resumed on the session cmux saved for it (`surface.resume.get`) only when it pairs to an
OPEN ledger row by worktree. A tab is LIVE on its Claude pid before its shell forest (`liveInTab.ts`), so a zombie
child never reads a seat as bare. A session live in any tab is never resumed twice; a cold tab whose saved session has no
transcript in its directory is `NO_RESUMABLE_SESSION`. Every other tab in or under an open row's worktree that runs no program — no
saved session, one live elsewhere, a guessed pairing, an unpaired tab, an unknown lone process holding a session, an
empty tab, the pass's own — is NAMED to the standing chair, never typed into and never dropped, bar one cmux no longer
lists once the walk ends: it closed mid-pass and prints as closed. A tab cmux reports no process for stays unread,
never live. A step only the owner's hands can take (`CMUX_HUNG_HELD` included) is the chair's `hand post` note, never a card.

**A pass the desktop launched closes its own tab, however it ended.** Once its finish is printed and journalled, a
pass run with `--episode` closes the unpinned workspace it ran in whose screen shows that finish line, forcing past
cmux's running-process confirmation (the process is itself); a resume the owner typed personally stays open. `session
close-done` closes a tab left behind — its finish line with only the prompt under it, a bare shell, and a healthy end,
a later attempt finished, or every seat it refused journalled gone — and says why it left any other: before this, one
tab per attempt piled up (63 once, `src/fleet/resumeShell.ts`).

**A seat that keeps falling over is investigated, never relaunched again** (the owner's word: not spinning up
fixes for the same thing that crash every time so the work never moves). A worker `resume` relaunched in three distinct
attempts inside the last hour (`src/fleet/crashLoop.ts`) is held — `CRASH_LOOP`, no button — and the caught-up
chair is asked, without interrupting its turn, to find the cause and reseat it itself once fixed. A looping chair
is relaunched anyway, since the owner reads the fleet through it, and told the same about itself; with no chair standing,
a looping worker is still held and the pass says no one was asked. A fleet whose only red seats
are held reads `degraded`: the desktop launches nothing more for it, and any other red seat still reads `down`.

## The desktop app is the only caller the owner sees

One down EPISODE gets ONE automatic `fleet resume --episode <id>`, typed into a new cmux tab through cmux's
AppleScript dictionary (cmux refuses an outside socket client) WITHOUT raising cmux — only the owner's press does — and the episode survives an app restart: the app saves each launch before it types it, and launches nothing by itself while
it cannot save — the page offers "Start recovery again" instead, and the owner's press launches unsaved. A line the
app typed that no finished attempt follows (the tab closed first, or the pass died) is typed again once nothing runs
and two minutes have passed; a line the owner's button typed never is. Once the app will launch nothing more and the fleet
still reads down with no step of its own, the page offers one button, "Start recovery again", which counts as the owner's —
only while something down is recovery's to move (the console, the supervisor, a worker): `fleet resume` never
restarts the Slack loop or the keep-alive, so a down that is only those offers no button (the loop is
`bot-off-the-air`'s card). Its floating note waits until the fleet has read down for two minutes, so a swap that
settles by itself never reaches the owner, and it says what the app READS as down and when it first read the FLEET down (never that it IS
down, and never that instant for a seat that went down later), what recovery did as far as the journal shows (`newestAttempt`, `lastAttempt`: an attempt of this episode
finished, started with no end, or none recorded starting), whether anything is being supervised, whether Slack still
answers, and shows `slopweaver fleet resume`; under its fold, why it reads that way — each red seat's words, the
supervisor's last sign of working, and when one was expected from. The other exception is an attempt that finished `deferred`: once nothing is running, the app
continues it, once per deferred attempt (`health --json`'s `lastAttempt` names it) and at most four launches an
episode, the owner's button presses included; a `failed` or `hand-step` outcome is never continued — that is the button's, and a
press is never refused at the cap. A press reads the fleet again before it types anything, and
does nothing if that reading no longer offers the button. A launch holds every other back, a second click included, until a reading shows
its attempt or two minutes pass — the bound is so a line that never ran cannot kill the button. Past it a second
line can be typed beside a slow first one, and the lock is what keeps them to one pass. It is the operation lock
(`src/admit/operationLock.ts`): a takeover of a dead pass's lock seats exactly one contender, and a holder is known
by its pid and its process start, so a reused pid never holds it — and health reads an attempt running the same
way, from one `ps` listing that must show the pass's own start, so an attempt journalled with no start, or a pid
whose start `ps` could not print, never reads running. A pass whose start the journal will not take refuses before it touches anything. The typed line exports the app's own `SLOPWEAVER_HOME` and `CLAUDE_CONFIG_DIR` when it was started with
them, so the tab resumes the world the page read — which is how a throwaway home drills the lockout without
touching the real fleet. Everything after that is the sessions page, opened from the menu bar: one headline in the owner's words, the
producer's text under a fold, and at most one button. Only that button reaches the owner unasked, as a floating note.
There are no priority controls and no reseat buttons: a priority is changed by telling the supervisor. Code:
`desktop/src/fleet*.ts`.

## A hung cmux is restarted, never the owner's hand

The owner's ruling: always online, so a hung cmux is the fleet's to restart. Every minute the app runs
`slopweaver cmux revive --json` from outside cmux; hung for ten minutes by the seats' own calls, it quits and
reopens the app (one in thirty minutes, three a day, journalled in the store's revive journal), and the usual pass
reseats every seat. **A hang that comes back is named, never pressed in a loop**: within the hour after a restart it
reads `CMUX_RECURRING`, is restarted once more, and a third is held (`CMUX_HUNG_HELD`) until cmux answers. A seat
whose call times out presses **Cancel** on cmux's "Run Project Action?" alert, never another button, at most once a
minute fleet-wide — **a `cmux.json` under any seat's cwd is a fleet-wide hang**; remove the file. How each reading
is judged, the bounds and the dialog: [cmux hangs](reference/cmux-hangs.md). Decisions: `src/cmux/hang.ts`.

## Every refusal has a row

`src/fleet/refusals.ts` maps each code the path records to a reason and at most one button, typed at the
producer and never parsed from prose. The buttons, in the order one wins when several stand: Automation
consent, open cmux, an Anthropic sign-in naming the exact account email the plan maps to (`claude signin
--plan <alias>`, then the same episode resumes), and a policy override that re-runs the resume with one named
hatch. The first mapping is the gate the owner hit after a restart: `MODEL_REFUSED`, Fable on a worker,
whose hatch `ALLOW_FABLE_OVERRIDE=1` the owner had to find in the refusal's own text.

## What it does not cover, stated

- A chair with no live session and no bare shell to resume it in is refused, never fresh-spawned: tell a new chair
  which handoff to resume.
- cmux's memory-pressure HIBERNATION resumes a seat by its own path, which `restore-policy` does not switch off and
  nothing here has measured. A seat it brought back signed out is a walled seat like any other.
- The pass itself starts neither the Slack loop nor the keep-alive: the chair does, while reorienting and before its
  `reoriented` line ([reboot.md](../supervisor/reference/reboot.md#reoriented)), and each shows red with its reason
  until it re-arms. Nothing checks they are up before the chair's green.
- A target is a cold tab, or a seat whose SCREEN shows a sign-in wall or whose session booted on no configured plan — what
  the `claude seat` hook refuses every prompt on while the screen looks idle (`reseatWallOf`, `cmux/reseatPass.ts`). A
  live seat on a token present but no longer accepted reads green, since `health` makes no network call, as does one
  waiting on a usage limit. A relaunched seat still walled records `SEAT_STILL_WALLED` or `SEAT_STILL_LIMITED`, never
  `reseated`, and a WORKER's defers the rest; a LAST failed screen read records `CMUX_READ_FAILED`; a seat another
  reseat holds `RESEAT_CONTENDED`, and one unwalled by the time its lock is held `WALL_CLEARED`, halting nobody.
- A sign-in the button starts that itself fails ends in its terminal tab, not on the page.
- Nothing revives a hung cmux while the desktop app is not running: `revive` has no other caller.
- A fleet `health` that cannot read — the store unreachable (never a file instead), or an unimported
  `fleet/config.json` that no longer parses — prints no document: the page says so and nothing launches until the
  store answers or `fleet configure --capacity <n>` writes the row. A malformed file is never the default capacity,
  and `configure` writes only a valid one.
- `cmux takeover` and `checkout sync` are not on the resume path, so they have no rows.
- `fleet resume` passes no `--model`, so `MODEL_REFUSED` fires only on a hand `cmux reseat --model fable`.
- A seat relaunched by an ambient default-login restore names no plan, so its sign-in has no button.
- The crash-loop guard sees only `resume`'s own relaunches: a row's worker respawned and dying by `cmux spawn` or a
  sweep writes nothing here. Workspace refs renumber after a restart, so a loop across one is missed, never invented.
