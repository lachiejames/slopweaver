# Spotlight, and why the worktrees directory is named `worktrees.noindex`

The largest foreign hog `machine capacity` has ever named is `mds`, Spotlight's indexer: about 14 GB of
resident memory a day, and it once sat beside a kernel panic with swap at 9.4 of 10 GB. The feeder
is worktree churn — measured, the two worktree parents held 14,363,240 and 24,812,342 files
(`find <repo>/.claude/worktrees -type f | wc -l`), almost all `node_modules`, with 83 trees deleted that night
alone, and Spotlight re-imports every create and every delete.

**The repository invariant needs no `sudo` and holds on any machine where Spotlight is on:** every
repository's worktrees live under `<repo>/.claude/worktrees.noindex/`, with `<repo>/.claude/worktrees` left as
a symlink to it. Spotlight skips any directory whose name ends in `.noindex` and never follows a symlink, and
that held on a throwaway disk image across `mdutil -i off` then `-i on`, `mdutil -E` and a detach-and-reattach
(`src/worktree/location.ts` carries the proof and the two rejected alternatives). Every `git worktree add` this
repository performs re-asserts the layout first, so a spawn keeps it true for every new worktree;
`slopweaver worktree noindex --repo <checkout>` applies or confirms it for a checkout by hand and is idempotent.
Verify it without root where indexing is on: `mdfind -onlyin ~/dev/personal/slopweaver <a word from a worktree
file>` returns nothing.

**On the owner's machine `mds` is disabled in launchd, and a guard keeps it disabled** (turn it off outright; a footprint ceiling is the accepted fallback). Indexing off was not enough: with
every volume reading `Indexing and searching disabled.` and the `.metadata_never_index` marker honoured at
boot, `mds` still grew to 6.37 GB in a day (the growth mechanism is not identified). It is a `KeepAlive`
LaunchDaemon (`plutil -p /System/Library/LaunchDaemons/com.apple.metadata.mds.plist`), so `killall` only ever
bought a restart. The lever is launchd's override database, `launchctl disable system/com.apple.metadata.mds`,
whose `disable` persists across boots (`man launchctl`). `bootout` is not the lever — launchctl's own refusal
text for a system service asks for SIP off or `AllowUnloadingSystemServices`
(`strings /bin/launchctl | grep AllowUnloadingSystemServices`).

**A macOS upgrade drops that override.** MEASURED: the 26.7 → 27.0.1 upgrade (`grep -B2 'macOS
27.0.1' /Library/Receipts/InstallHistory.plist`) rewrote
`/private/var/db/com.apple.xpc.launchd/disabled.plist` in that same minute; afterwards it still held
`com.apple.ftpd` and the third-party vendors' entries, and no longer held `com.apple.metadata.mds` (`plutil -p`
that file), which launchd had shown disabled before. Third-party plists in `/Library/LaunchDaemons` dated
before the upgrade are still there (`ls -l` it). So the durable shape is a root LaunchDaemon,
`/Library/LaunchDaemons/com.slopweaver.mds-guard.plist` (source:
`$SLOPWEAVER_HOME/machine/com.slopweaver.mds-guard.plist`), which at load and every ten minutes re-asserts the
disable whenever the database has lost it and restarts an `mds` whose footprint (`top` MEM, never `ps` RSS) is
over 1 GiB — the cap that holds between an upgrade and the next boot, and if the disable alone never stops
`mds`. Its body is inline `/bin/sh` naming only system binaries, never a checkout's `bin/slopweaver`: root
running code from a user-writable tree is an escalation. Each act, and a failed re-disable, logs a line
opening `mds-guard:` (`logger -t` drops its tag from the unified log, so the prefix is in the text). Read-only
witness:

```bash
launchctl print system/com.slopweaver.mds-guard | grep -E 'state|runs|last exit'
launchctl print-disabled system | grep metadata.mds   # "com.apple.metadata.mds" => disabled
pgrep -x mds && top -l 1 -pid "$(pgrep -x mds)" -stats mem | tail -1   # nothing, or under 1024M
/usr/bin/log show --last 1d --predicate 'process == "logger" AND eventMessage BEGINSWITH "mds-guard:"'
```

Undo is `sudo launchctl enable system/com.apple.metadata.mds` and a restart.
