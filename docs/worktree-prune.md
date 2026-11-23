# Reclaiming worktrees

`slopweaver worktree prune` decides which of this install's git worktrees may be deleted, prints that as a
plan, and — with `--apply` — carries it out. It exists because nothing else does: a session ending does not
remove the worktree it ran in, and at the first run the two blessed worktree homes held **335 registrations
between them, 378 GB**, on a volume that was 93% full.

- [Why a verb and not another cleanup](./worktree-prune/classes.md)
  - [The classes](./worktree-prune/classes.md#the-classes)
  - [The three widenings, and the witness each rests on](./worktree-prune/classes.md#the-three-widenings-and-the-witness-each-rests-on)
  - [The reclaims, and what the disk was actually holding](./worktree-prune/classes.md#the-reclaims-and-what-the-disk-was-actually-holding)
- [The salvage capture](./worktree-prune/salvage.md)
- [Kept trees give up their dependencies](./worktree-prune/decision-mechanics.md)
  - [Two measurements that decide everything](./worktree-prune/decision-mechanics.md#two-measurements-that-decide-everything)
  - [The one place `--force` is used](./worktree-prune/decision-mechanics.md#the-one-place---force-is-used)
  - [Cost, and the disk budget](./worktree-prune/decision-mechanics.md#cost-and-the-disk-budget)
  - [Live state is a rail, not a nicety](./worktree-prune/decision-mechanics.md#live-state-is-a-rail-not-a-nicety)
- [The first real run](./worktree-prune/operations.md)
  - [The first run after the deadline fix](./worktree-prune/operations.md#the-first-run-after-the-deadline-fix)
  - [The hourly slot, and what it took to make it keep up](./worktree-prune/operations.md#the-hourly-slot-and-what-it-took-to-make-it-keep-up)
  - [The hole that left, and the declaration that closes it](./worktree-prune/operations.md#the-hole-that-left-and-the-declaration-that-closes-it)
  - [The briefing says what is registered](./worktree-prune/operations.md#the-briefing-says-what-is-registered)
- [The close reclaims its own seat](./worktree-prune/seat-close.md)
