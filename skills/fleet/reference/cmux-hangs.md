# A hung cmux: how the revive reads it, restarts it, and stops

The detail behind [fleet](../SKILL.md#a-hung-cmux-is-restarted-never-the-owners-hand). The owner's ruling, after a
five-hour hang: always online, recovery and self-healing already answer whether to ask the owner.

## Reading a hang

Every minute the app runs `slopweaver cmux revive --json` from outside cmux, which knocks on the socket. A refused
or silent socket is hung. A reply is only cmux's outside-client refusal, which its access layer sends while the
handlers behind it hang, so a reply is judged by what the seats' own calls last heard — each live call a
seat makes stamps `cmux-inside-{answered,unanswered}.json` in the home's runtime directory: answered, or any answer within five minutes, is
`answering`; a timeout within five minutes with no answer in them `stalled` (hung); nothing to judge by `unprobed`,
which inside a hang keeps it open but never puts it over the bound (a read once showed healthy mid-hang).

The runtime directory is `/tmp/slopweaver-<uid>/<home key>`, one fixed root rather than `TMPDIR`, which differs
between launchers; it holds the stamps and the fleet's locks. Only the test lanes move it, through
`SLOPWEAVER_RUNTIME_ROOT`, each to its own sandbox.

## Restarting it

Hung for ten minutes of readings no more than five minutes apart, while the app's pid lives, it SIGTERMs the app
(SIGKILL past its wait), reopens it in the background with `open -g -a cmux`, and waits for the socket — at most one restart in thirty
minutes and three a day, each journalled in the store's cmux revive journal. A hang no seat is calling
into is never restarted. The app launches no `fleet resume` while the revive waits, restarts or holds, then health
reads the fleet as after any restore and the usual pass reseats every seat. `fleet health` reads the same journal:
`CMUX_UNRESPONSIVE` and `CMUX_RESTARTING` are recovering, `CMUX_HUNG_HELD` down. Run inside cmux, `revive` refuses
— it would die with the app it restarts — so the app hands no child a `CMUX_*` variable, and `desktop update`
reopens it with none. Decisions: `src/cmux/hang.ts`.

## A hang that comes back

One beginning within the hour after a restart came back answering is journalled `recurring` and reads
`CMUX_RECURRING`, degraded, until an hour after its restart; the fleet restarts it once more, and a third is held
(`CMUX_HUNG_HELD`) until cmux answers, never released by the clock or a decline (`src/cmux/recurrence.ts`). A hang
is dated from its first unanswered reading after cmux last answered, so a quiet stretch of unprobed readings before
the restart cannot push it outside the hour. The `recurring` line and the held marker are re-stated as the journal grows
(`src/cmux/hangNaming.ts`), so a hang of days still reads as the loop it is.

## The dialog behind a recurring loop

One such loop was a modal "Run Project Action?" alert: a seat had copied `~/.config/cmux/cmux.json` under its
workspace's cwd, and **a `cmux.json` under any seat's cwd is a fleet-wide hang** — cmux's handlers wait on the
alert. A seat whose own call times out reads cmux's dialogs through System Events and presses **Cancel** on that one
exact title, at most once a minute across the fleet, journalling `dialog-dismissed`, which starts the hang's run
afresh; `slopweaver cmux dialog [--dismiss]` is the same on request. Never another button — "Trust and Run" would
run the hook — and never from the desktop app, which holds no Accessibility grant (`src/cmux/dialog.ts`). Cancel
stores no trust: remove the file.
