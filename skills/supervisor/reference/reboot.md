# A machine reboot — tell every session, tally, green-light, re-arm

Linked from [SKILL.md](../SKILL.md) § 7a. A reboot costs the fleet almost nothing: cmux restores every
workspace, so what dies is PROCESSES and the harness scratchpad under `/private/tmp`, never context. cmux's OWN
session restore is kept OFF (`slopweaver fleet restore-policy`, exit 0 when off; `--apply` turns it off): left on,
it re-runs `claude --resume <id>` with no setup-token descriptor and no store, so every seat, the chair first among
them, reads `Not logged in` (measured twice) — or, signed in on an ambient login, comes back booted on
NO plan with a clean screen, where `claude seat` refuses every prompt typed into it, a nudge included (measured). With it off each tab reopens as a bare shell and `slopweaver fleet resume` brings the chair back FIRST
on the pin and its plan, then every other seat ([fleet](../../fleet/SKILL.md)). A seat that still comes back
walled or on no plan is `cmux reseat --all`'s.

## When to propose one

When `machine capacity --json` has read `hold` on cpu or memory for hours and the hogs it names are FOREIGN (the
endpoint sensor, `mds`, the Docker VM), propose the reboot early rather than hunting for levers one at a time — the
fleet cost is one supervisor tick of messaging. MEASURED: the machine sat at
load1 34–54 with six swapfiles for hours; the chair's first answer was "not yet, it costs every session", and the owner
corrected it. The reboot took swap and the compressor to zero, the Docker VM from 6 GB to 2.5 GB and load1 from
33.69 to 14.95, which no single lever had done. It is easy to do: tell the supervisor and wait for the
greenlight. Thresholds and what the
gauge reads: [machine-capacity.md](machine-capacity.md).

## The flow

1. **One notice file, one pointer to every live session.** Write `restart-notice.txt` under your own
   `$SLOPWEAVER_HOME/supervisor-scratch/<handoff>/`: finish or abort any push, enqueue or CI lap; WIP-commit by
   name; write the resume point to the board row; move anything worth keeping out of
   `/private/tmp`; kill nothing. Message every live session (`ListAgents` first) a pointer to it, asking for
   one line back: `safe to restart`, or `NOT safe: what, and what it is waiting on`. Never a `review-` session
   ([reaching-a-session.md](reaching-a-session.md)). A session idle on the owner's word is safe by construction.
2. **Tally in a file**, appending once per batch of replies — the poll gate refuses re-reading one target
   inside a minute. For a session that has not answered, read its screen ONCE (`slopweaver cmux read-screen`):
   mid-turn with an empty composer and no half-written store or partial push is safe.
3. **Green-light the owner with the tally.** Commit the state doc, write `restart-recovery.txt` beside the notice
   (the order below), and tell the owner "N of N safe". Measured: 32 of 32 answered safe within about fifteen minutes.
4. **After the owner says it is done**, in this order:
   - **Every seat comes back, the chair first.** The desktop types `slopweaver fleet resume` into a tab of its
     own on a down fleet (the owner can type it into any tab but the chair's, a plain shell included): it resumes each
     bare-shell seat on its saved session and relaunches each logged-out, limit-walled or no-plan one in place with
     `--resume` on a routed plan, answering the resume-in-full prompt with **2**, and you arrive at § Reoriented by
     its nudge. A relaunched seat whose session has no transcript, or any seat whose resume prints `No conversation found` and whose
     tab comes back to a bare prompt, is booted fresh once and journalled `SEAT_NOT_RESUMED`: it lost its context and
     is NOT counted recovered; a tab that never comes back is refused `RELAUNCH_FAILED`. A bare-shell
     seat whose saved session has no transcript is refused `NO_RESUMABLE_SESSION` instead. For a seat still walled, `slopweaver cmux reseat --all`; for a worker refused `NO_LIVE_SESSION`,
     `slopweaver session re-seat`; for the chair refused it, the refusal names why its tab was not a bare shell, and
     `fleet resume` again or `cmux reseat <its ref>` once the tab shows a prompt. This is the owner's own escape hatch too
     (a disaster-recovery command that costs nothing), so it never needs a working chair.
     Never `/login`, and never sign the default store out to fix a seat. That logout deleted the shared
     `oauthAccount`, so telemetry after it carries no identity, and that is expected.
   - **The console** — `--all`'s last line says whether `:3000` is serving. If it is not, run
     `bash <main checkout>/scripts/docs-site.sh --serve`. `slopweaver checkout console --json` reads the same
     state, where `served.kind` `none` means nothing is serving. It once died with the restore and
     nothing named it.
   - **Seat check** — `slopweaver claude gauge` and its `chair:` line, never `userEmail`
     ([setup-tokens.md](setup-tokens.md)).
   - **Capacity before anything else.** The first minutes of uptime are boot churn (the endpoint sensor's boot scan,
     `fseventsd`, `rsync`): measured, load1 49 at four minutes settled to 15 by ten. `machine capacity --json`
     also holds on a burst of session boots, which the restore itself is, so spawn with `--wait`. A reseat is not a
     spawn: `cmux reseat` and `fleet resume` pace each worker on boots in flight for at most `--timeout-seconds`
     and then relaunch regardless, never on cpu or memory.
   - **Standing sessions** — `slopweaver session standing`: start the credential keep-alive the way
     [standing-sessions.md](standing-sessions.md#the-keep-alive-dies-with-its-seat) says; the loop session
     re-arms its own listener from its worktree with `listen arm --background` (one arm — Slack caps
     connections).
   - **Re-arm the sweep** (`supervisor sweep-prompt`, then `ScheduleWakeup`) — it died with the process.
   - **Answer every resume prompt.** A deep session can come back parked on Claude Code's "Resuming the full
     session will consume a substantial portion of your usage limits — 1. Resume from summary / 2. Resume full
     session as-is", where it shows as `busy` to `ListAgents` and silent to `session watch`. The owner's standing answer
     is **2**. `cmux read-screen` every session over ~300k and answer it with `cmux send` — never leave it for
     the owner (measured: a 544k session sat on it until the owner pressed 2 by hand).

## Reoriented

**An unplanned restart has no step 1–3, and step 4 is the desktop app's**. The
Slopweaver app reads `slopweaver fleet health` from outside cmux, and on a down fleet types ONE `slopweaver fleet
resume` into a cmux tab the owner can see: the console, then the chair reseated first, then a nudge into the chair that
points here, then every other walled seat — none waits on your answer — and last a bounded wait for it. Its
sessions page paints the chair yellow until you do. The skill: [fleet](../../fleet/SKILL.md).

When that nudge arrives, in this order: the seat check, capacity, the standing sessions (the keep-alive, and the
loop's `listen arm --background`), the sweep re-armed, every resume prompt answered —
the step 4 bullets above, minus the reseat and the console the pass already did. Then read the board until you
know what you will do next, and say so:

```bash
slopweaver supervisor reoriented --attempt <id>   # the id the nudge named
```

That line is your green on the page and the end of the pass's wait; the workers were reseated while you read in, so
read capacity as their boots settle. A slow answer leaves the attempt `deferred`, never a worker. Run it only
from the pinned chair's own session (it refuses any other), and only once you ARE caught up. It is one of the two
signs the page trusts; the other is a sweep your pinned workspace started and closed after you took the seat
(`src/fleet/chairSeat.ts`). The process existing never counts.

**A crash-loop line is yours, not the owner's.** A pass that finds a seat it has relaunched three times in the hour holds
it and types _"Recovery held workspace:N (row) instead of relaunching it again …"_ into this session. Investigate it
like anything worth a look: read that seat's screen and its handover's journal, find why it walls again after being
brought back, fix the cause, and only then `cmux reseat` it yourself — recovery never will. The owner's page reads the fleet
`degraded` meanwhile and asks the owner for nothing. A recovery step only the owner's hands can take — a hung cmux the revive
has stopped restarting (`CMUX_HUNG_HELD`) included — is your `hand post` floating note, never a Queue ask, and never
a relaunch.

## What the restore changes that nobody tells you

- **Every address is stale.** Workspace refs are renumbered (the pinned chair went from `workspace:164` to
  `workspace:1`) while workspace ids survive, and session name suffixes change, so every cross-session address in the handoff doc, the
  shift text and any "reply to X" instruction is wrong. Re-run `ListAgents` and `cmux list --json` before
  sending anything.
- **Background work dies**: background shells, monitors, `ScheduleWakeup`, the dogfood run's workers and
  reviewers.
- **`/private/tmp` is wiped**, harness scratchpads included. That is why a seat's carried files live under
  `$SLOPWEAVER_HOME/supervisor-scratch/` ([state-doc.md](state-doc.md)) and a page under `pages/`.
- **A `launchctl disable` on a SIP-protected daemon (`mds`) does not survive the boot.**

## A hung cmux is not yours to restart

A cmux that stops answering takes every seat with it, this chair included, so nothing inside it can bring it back.
The desktop app runs `slopweaver cmux revive` from outside every minute and quits and reopens the app itself once
the socket is dead or every seat's call has timed out for ten minutes — so your own `cmux` timeouts are its evidence; its `fleet resume` then reseats every seat as after any restore ([fleet](../../fleet/SKILL.md#a-hung-cmux-is-restarted-never-the-owners-hand)).
Never arrange a restart from a chair through `launchctl` or a script: measured: one such runner died on
`node: not found` and re-ran every six and a half minutes until it was found.

A hang back within the hour of a restart reads `CMUX_RECURRING`, and a third is HELD for you: that is a cause to find,
not a restart to press. Run `slopweaver cmux dialog` first — it was once a "Run Project Action?" alert raised by
a `cmux.json` copied under a seat's cwd; `--dismiss` presses Cancel, and the file is what to remove.
