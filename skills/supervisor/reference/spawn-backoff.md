# The fleet-wide spawn backoff

The ask: when hook latency or load is over the line the fleet backs off spawns exponentially
rather than every seat contending. Code: `src/live/machine/spawnBackoff.ts` (pure),
`src/live/machine/spawnBackoffStore.ts` (the state file and its lock), `src/cli/commands/cmux/spawnCapacityWait.ts`
(the door every `cmux spawn` passes).

## What a spawn reads

Every `cmux spawn`, waited or not, takes ONE cheap reading under one operation lock (`machine-spawn-admission`):
the load from `sysctl -n vm.loadavg`, the compressor, the swapfile count, the boots in flight and any stalled
hook, judged by the unchanged hold thresholds in [machine-capacity.md](machine-capacity.md). `top`'s one-second
idle sample is taken only when the load is at or over its hold, because idle only ever clears a load hold. The
disk floor is never read: a full volume is `worktree prune`'s ([disk-floor.md](disk-floor.md)).

**A healthy machine pays nothing.** A clear reading with no hold behind it admits with no window and no spacing,
so the thresholds are the whole of what slows a spawn on a box that is merely busy.

## The two halves

- **The held window.** A held reading closes the door FLEET-WIDE in `$SLOPWEAVER_HOME/live/machine/spawn-backoff.json`
  for 10 s, doubling per consecutive held reading (20, 40, 80, 160) to a 180 s cap — the 1-minute load average's
  3τ, past which a boot the window waited on is fully visible. Inside it no spawn reads the gauge, so twenty
  waiters cost the machine one reading per window. Two held readings more than 180 s apart start again at 10 s.
- **The recovery spacing.** The first clear reading after a hold admits ONE spawn and closes the door to the next
  for half the last window, then half that, until the gap falls under 10 s. That is what stops the herd a single
  clear reading would otherwise release.

## Exits, hatches and the callers past it

- An unwaited spawn the backoff defers exits **4** with the four-line refusal naming the window. A spawn that
  finds another being admitted (the lock held) waits it out for up to 90s — every timed gauge child at
  its 10s cap, plus margin — then exits 4. The lock is never taken
  from a LIVE holder (a dead one's is taken at once), and an admission writes only over the state it judged, so
  no two spawns are admitted on one state in one recovery gap. A state file that cannot be read or parsed exits
  **1** — never read as "nothing held", which would license a spawn on the machine that wrote it mid-incident.
- `--wait` re-attempts on the local wait schedule until admitted or `--timeout-seconds` passes (exit 4).
- `SLOPWEAVER_ALLOW_SPAWN_BACKOFF=1` waives the whole gate (hatch `spawn-backoff`); `SLOPWEAVER_ALLOW_BOOT_BURST=1`
  waives a hold on boots in flight alone (hatch `boot-burst`), never one on load or memory.
- `machine watch`'s investigation seat enters past the backoff in process: it exists BECAUSE the box is held.
  `session re-seat` takes its admission before it closes a walled seat, then boots it past the backoff, so a
  deferral never leaves a seat closed and unreplaced.

## Reading it

`machine capacity` prints a `spawn backoff:` line while the door is closing (HELD with the subject, the streak and
the instant; RECOVERY with the next admission; UNREADABLE with why), and carries `spawnBackoff` in `--json` always.
