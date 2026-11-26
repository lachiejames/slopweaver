# Lap teardown — what a stopped lap removes, and what prune takes after a killed one

Part of [the local lap](local-lap.md).

**Everything a lap brings up goes when it stops.** The machine lock, the tree, the lane home and the proof store
each register a cleanup as they come up, the store's container before its readiness wait
(`src/cli/commands/github/lapCleanupDeps.ts`). A first `SIGINT`, `SIGTERM` or `SIGHUP` drains them newest first
and exits `128 + n`; a second exits at once (`src/cli/commands/github/lapSignals.ts`).

**A lane is not interrupted.** Rule 2 admits no asynchronous child, so a lane runs under `spawnSync` in its own
process group, and no JavaScript handler runs until it returns: a signal mid-lane is acted on when that lane
ends, at most its 45-minute ceiling later, and no lane starts after it. Every step first hands the loop back
twice, so the drain begins before the next step is asked for.

**A killed lap's tree is prune's.** SIGKILL skips every cleanup, so the tree's private gitdir carries a marker
naming the lap's pid, that process's start stamp and the minted HEAD (`src/worktree/lapTreeProvenance.ts`). Once
that pid and stamp name no running process, `worktree prune` classes the tree `lap`, pins its HEAD and removes it
([classes](../../../docs/worktree-prune/classes.md#the-classes)). A lap whose start stamp `ps` cannot read refuses
to mint a tree rather than mint one nobody could later attribute.
