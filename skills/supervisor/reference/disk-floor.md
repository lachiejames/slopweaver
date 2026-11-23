# The disk floor — `HOLD on disk`

The volume holding `$SLOPWEAVER_HOME` holds on `disk` when its `df`-available space is below room for a
**5.6 GB seat tree each for the 6-seat boots burst, the next seat and one spare** — 8 × 5.6 = 44.8 GB, whatever
the fleet's size (`diskFloorFor`, `src/live/machine/capacityHolds.ts`):

```text
HOLD on disk (disk 44.7 GB free (df, Finder shows at least this), hold below 44.8 GB — a 5.6 GB seat tree each for the 6-seat boots burst, the next and one spare; run slopweaver worktree prune --apply)
```

## Why it is derived, and why it should never fire

A disk 85% full with 150 GB free in Finder is no reason to hold. The question the hold answers is "would the
next seats bring the disk dangerously close to full? if so, do not spawn them until the cleanup has finished",
so the floor reserves only growth that has not happened yet. **A live session's tree is already inside `df`'s
used space**, so it is never reserved again: the floor that did reserve one per live session held 53 sessions at
308 GB with 262.5 GB free. What can still grow fast is the seats about to start, and the `boots` hold
(`src/live/machine/recentBoots.ts`) stops seating after six inside its window, so a burst is six trees; the next
seat and one spare complete eight. `SEAT_TREE_GB` is the largest tree measured (`du -sk`: acme-admin trees at
4.5, 5.3 and 5.5 GB, a built slopweaver tree at 3.1 GB, an unbuilt one at 0.28 GB).

**The residue, stated:** a live tree that has not installed yet can still grow by up to 5.6 GB later, and this
floor does not model that. Noticing disk falling from ANY cause, and investigating what is eating it, is the
supervisor's judgement on what `machine capacity` reports, not this number.

The `worktree-prune` triggers ([operations](../../../docs/worktree-prune/operations.md#two-triggers-and-neither-waits-for-a-supervisor-pass))
are what keep the volume from ever getting near it — the owner expects about 300 GB free when it is working — so the
fleet should never hold on disk. **Free disk is never under 100 GB.** Any production
disk read under the RECLAIM floor backgrounds `worktree prune --apply --if-idle` the moment it is read, and the
first tool call of each hour fires the hourly row, neither waiting for a chair's tick. The reclaim floor is the
higher of the owner's 100 GB and this HOLD floor (`src/worktree/pruneFloor.ts`) — 100 GB today — so a disk this floor
holds is always one the prune is already reclaiming. The `max` is a guard: when this floor still scaled with live
sessions, sixteen put it at 100.8 GB and a prune that read itself relieved at 100 left the fleet held.
Crossing the reclaim floor starts a prune and holds nothing. Every surface says the free GB and the floor, never a percentage: the verdict clause, the
Fleet page's hold line, the Capacity tile and the briefing's disk clause all read `diskHoldFreeGb` off
`machine capacity --json`.

## Why `df`, never Finder

Finder's free figure is `df`'s available PLUS the APFS purgeable space, which macOS may never actually free.
So `df` is the floor a seat can count on, and Finder always shows at least as much: the hold fires no later
than Finder reaching the floor. Repro: `df -k "$SLOPWEAVER_HOME"`.

## What it stops, and what it does not

- **It stops** the chair's discretionary spawns that tick, the same as any hold
  ([sweep-contract.md](sweep-contract.md) step 8: `hold: true` holds every spawn), so the fleet never boots
  more seats into a disk that is filling. A `cmux spawn`, waited or not, meets the fleet spawn backoff, which never reads this floor
  ([machine-capacity.md](machine-capacity.md)).
- **It does not stop a `--wait`.** `machine capacity --wait` settles on a hold on `disk` alone (`holdBlocksWait`,
  `src/live/machine/recentBoots.ts`), and `cmux spawn … --wait` never reads the disk, because waiting frees no bytes.
- **It seats no investigation.** A hold on `disk` alone publishes no `capacity-hold`, opens no dispatch row
  and needs no `hold-rationale` ([load-dispatch.md](load-dispatch.md)), exactly as `boots` alone does
  (`NOT_STANDING`, `src/live/machine/capacityVerdict.ts`).

## The remedy

Already running by the time a tick sees the hold: the tick's own `machine capacity` read launched it, and a
second launch steps aside at the apply lock. `slopweaver worktree prune --apply`, run by the chair on the tick
that saw the hold, is the manual form, and it WAITS for a running apply rather than being refused by it —
[sweep-contract.md](sweep-contract.md) step 8 says how. What it removes, and why a cold tree on an open pull
request goes, is [the worktree-prune classes](../../../docs/worktree-prune/classes.md). It paces itself: one
tree at a time, at background priority, holding on a hot fseventsd and stopping at its budget, so running it
on a loaded tick is safe ([pacing](../../../docs/worktree-prune/decision-mechanics.md#paced-so-a-reclaim-never-takes-the-machine-down)).
