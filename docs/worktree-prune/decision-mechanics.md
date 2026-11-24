# Kept trees give up their dependencies

Part of [Reclaiming worktrees](../worktree-prune.md).

`--apply` runs a second pass AFTER the removals, on the same `--budget` deadline, checked between trees. It
strips every wholly-untracked `node_modules` from each tree the plan KEEPS whose verdict carries
`dropsDeps` (`src/worktree/pruneClassify.ts#depsDroppable`, `src/worktree/pruneDeps.ts`). A dry run's last
line counts them; `--json` carries the flag per tree; `--merged-only` skips the pass. The ROOT `node_modules`
is deposited into the recycle pool instead when the tree vouches for it and a slot is free
([operations](operations.md)); otherwise it is deleted with the nested ones, paced as below.

- **Who qualifies.** A held tree that is not the main checkout, is present, has no live session or
  workspace, and is untouched for over `--older-than`. Dirt does not stop it, because `node_modules` is not
  the work, and neither does an open pull request on its branch once the tree is cold. A closed run or a
  pushed branch does NOT stand in for age here. Stripping a tree under a session
  about to run in it breaks that session's first `yarn` call, so only the directory's own age will do.
- **Both facts are read again at drop time.** The pass runs after every removal, so the scan is old by
  then. The live registers are re-read and the tree's own mtime re-checked. A tree taken or touched since
  is skipped and says so, as is one whose root is now a symlink. A tree with no `.git` FILE is a main checkout, however its path
  is spelled, and is never stripped. Unreadable live state skips the whole pass.
- **Git names the directories, and that is the witness.** `git ls-files --others --ignored
--exclude-standard --directory` collapses a directory to one `dir/` entry only when nothing in it is
  tracked, so a `node_modules` holding a tracked patch is never touched. Each named directory is then asked
  again by its exact name (`ls-files -- <dir>`), and anything but an empty answer skips it, because a parsed
  listing can be misread. A symlinked one is skipped.
- **The tree's mtime is put back** after the drop. Otherwise the drop itself reads as activity and defers the
  tree's own removal by another `--older-than`.
- **What it cannot promise.** `yarn install` restores what a lockfile describes. It does not restore a hand
  edit inside `node_modules`, or state a tool wrote there. A drop starved by a removal backlog is reported as
  owed on the summary line, never silently skipped.

## Two measurements that decide everything

**Absorbed, by verbatim patch id.** This repository squash-merges, so plain ancestry reports every landed
branch as unmerged. Every branch commit's `git patch-id --verbatim` must be among the trunk's since the merge
base, which matches a commit landed under another SHA (`src/worktree/prunePatchIds.ts`). Not `git cherry`, whose
ids strip whitespace: the r2 Codex review committed ` x` on a branch and `\tx` on the trunk, cherry called it
absorbed, and the tree went with bytes no trunk commit holds — CRLF against LF reads the same. The patch log
runs with `--no-textconv --no-ext-diff --binary --full-index`, so no configured program and no "Binary files
differ" line can make two edits hash alike. Only trunk commits touching the same set of paths as a branch commit
are hashed, because the whole trunk side of a fortnight-old branch is 88 MB here. It writes nothing — the
widely-copied `commit-tree` recipe was rejected for writing loose objects into the owner's repository during
what is meant to be a read-only dry run. Its limit: a branch of several commits squashed into one has no single
matching patch, so it classifies as `pushed`. That is the conservative direction.

**Backed up nowhere.** `git rev-list <branch> --not --remotes` lists commits on no remote at all. An absorbed
branch reports zero by definition — its work is in the trunk, which is on a remote — because GitHub deletes
the remote branch after a merge, and asking the question literally would hold every landed worktree forever.

## The one place `--force` is used

`git worktree remove` refuses a dirty tree, and that refusal is kept, because it is an independent second
opinion. A branch ref goes only when its tip is an ancestor of the trunk, asked directly rather than through
`git branch -d`: `-d` judges "merged" against the branch's configured upstream, and the r2 Codex review made a
branch its own upstream (`branch.<b>.remote=.`, `branch.<b>.merge=refs/heads/<b>`) so `-d` deleted the only ref
to an unmerged commit. Overriding the upstream does not close it on git 2.54 — an empty `remote=` crashes git,
`merge` is multi-valued, and any remote name is one the repository can define. So the trunk is read fully
qualified, a trunk that resolves to the branch, either ref being symbolic, or a loose ref file the disk answers
under another name (a case or Unicode fold, asked of the directory listing rather than imitated) keeps it, both tips are pinned, ancestry is asked with replace refs, `info/grafts` and the commit-graph off, a branch another worktree has out is kept, and the deletion is one
`update-ref --no-deref --stdin` transaction that verifies `origin/HEAD` still names the trunk, verifies the
trunk's tip, and deletes the branch only at its own. A squash-merged branch is never an ancestor, so it keeps its forty-byte ref.
Two hand-built states still lose a commit, both reproduced by the fallback reviews and both reachable only by
writing into `.git` directly: a commit object whose bytes do not hash to its name (`git fsck --full` reports
it), and ref storage symlinked into the removed tree's ignored output, which plain `git worktree remove` on main
deletes too. The
exception is `interrupted`: when a
removal dies part-way — a scheduler tick killed at its time bound, a laptop closing — git has already deleted
the tracked files and the worktree stays registered, dirty with nothing but deletions. Git's refusal there is
not an independent opinion at all; it is an artifact of this verb's own half-finished write, and a verb that
only ever respected it would leak one gutted checkout per interruption. Five such trees once existed —
four from one night's own interrupted runs, one older. A gutted tree whose branch its own
remote carries whole is finished the same way, its branch kept ([the owner's word](classes.md#the-owners-word-held-only-for-uncommitted-or-unpushed-work)).

`--force` also skips git's look at a file hidden from `status`, so the apply's hidden-file re-read covers this
class too. A hidden file already gone holds no bytes the removal could destroy, so it is not an edit, whoever deleted it. One
still present and edited keeps the tree, and so does a worktree root swapped for a symlink. And because
`--force` deletes untracked and modified work too, the deletion-only shape that earned it is read again right
before the removal: a file written into the tree since the scan, or a status git cannot answer, keeps it. A deletion
is exactly ` D` or `D `, whose content HEAD still holds: `MD` or `AD` carries a staged blob that may be the only copy of
an edit, so a code merely containing a `D` is not one. A deliberate uncommitted deletion reads the same, and all
it loses is the intent to delete.

**Every status read the prune takes asks git for everything, whatever the repository's config says.** A
`status.showUntrackedFiles=no` hides an untracked file and a `diff.ignoreSubmodules=all` hides a dirty submodule,
and either leaves a tree reading as deletions only. The scan, the apply's re-read before EVERY removal and the
partial-removal check all pass `--untracked-files=normal --ignore-submodules=none` (`src/worktree/pruneGit.ts#workingTreeStatus`).
An un-forced removal needs that re-read too: `git worktree remove`'s own dirty check obeys the repository's
`status.showUntrackedFiles=no`, and deleted a file written since the scan. So every class but `interrupted` must
re-read empty, and `interrupted` must re-read deletions only. Before any of it, git must be reading the tree
itself: a per-worktree `core.worktree` aims every read at another directory while the removal deletes the
registered one, so a `rev-parse --show-toplevel` that is not the tree keeps it (`readsItself`).
And a tree carrying any submodule is never forced: its HEAD records a submodule as one commit id, never its objects, so the checkout inside may be the only copy. Any trace counts — a gitlink in the index or HEAD, or a `modules` directory beside the worktree's git dir (`holdsSubmodule`) — because `git submodule status` lists a checkout whose `submodule.<name>.active` is false as uninitialised. Codex reproduced both losses with real git; `pruneReclaim/removalRereadsHidden.test.ts` holds each case.

A clean filter hides an edit from every status read, whatever the flags: a lossy one maps new bytes onto the committed blob, and `git worktree remove` then deletes the only copy, in every class. So every path a `filter` attribute names joins the hidden files' raw-byte comparison (`filteredPaths`), which runs no filter. It reads `check-attr --all`, because asked for `filter` by name git answers `unspecified` for an absent one, and a driver may be named exactly that. A filter that only rewrites a checkout (LFS, line endings) reads as an edit and holds, the safe direction; neither slopweaver nor acme-admin sets one.

A filter is also repository code, and `status` runs it — so does `git worktree remove`'s own dirty check, after every read the prune can make. One that writes into another file defeats every comparison before it. So a tree where a clean or process command is configured and some tracked path carries a `filter` attribute is kept (`filterWouldRun`), checked first, before any read that would run it.

The stat cache is the same kind of hole. `core.trustctime=false` with `core.checkStat=minimal` lets a same-size edit whose mtime was put back read clean to `status` and to `git worktree remove`'s own check. So every prune git command, the removal included, carries `STRICT_STAT`: ctime trusted, every stat field checked, no untracked cache. That still is not enough: Apple's git compares ctime to the second, so an edit inside the index refresh's own second reads clean anyway. So the last read before a removal hashes EVERY regular tracked file's raw bytes against its staged blob (`hiddenEditsNow` with `every`), asking nothing of the cache. Every tracked symlink's target is read the same way, with `readlink` and `hash-object --stdin` (`symlinkEditsNow`): `status` vouches for one by stat data alone, and the r3 Codex review retargeted one behind stat fields a filesystem reported unchanged. Gitlinks stay with the submodule check.

Last of all, HEAD is read again, because every check above vouches for bytes against the index, never for a ref that keeps the commit they came from. A tree whose verdict names its branch must still have that branch checked out (`symbolic-ref`), and a salvaged tree the salvage branch its capture switched it onto: switched to a detached commit made since, it passes every byte check while the removal deletes the only checkout of a commit no ref names. A commit made ON the branch is safe, since the branch is kept or its new tip is not in the trunk. A detached tree's HEAD must still be the sha pinned for it (`headMoved`).

**`git worktree remove` sees no ignored file and no stash, so the last read asks for both.** Its dirty check is `status`, which lists neither, and it deletes every ignored file in the tree unasked. So right before every removal, after the status read, the apply lists the tree's ignored files again and its stashes (`src/worktree/pruneContext.ts`): an ignored file no build writes again, a stash made from the tree, or a listing git could not answer keeps it, in every class `interrupted` included. git lists a symlink with no trailing `/`, so a `node_modules` linked to another tree's reads as a FILE of that name; one the disk shows is a symlink standing where a reproducible directory goes is build output too, since a removal unlinks it and never follows it, while a regular file of that name still holds (`isReproducibleLinkCandidate`). Measured: 24 of 208 slopweaver registrations, every one a scratchpad worktree linked to its seat's `node_modules`, were held on that alone. After HEAD is read, a tree whose branch the removal KEEPS counts that branch's commits on no remote again (`unpushedSinceScan`), so a commit made since the scan keeps it too. A branch the removal deletes needs no count, because it is deleted only at a tip the trunk carries, and a salvaged tree answers to its confirmed push.

**The residue is the window after the last read.** Every re-read above happens before `git worktree remove`, and nothing locks the directory between them — git's own dirty check has the same shape. A process writing into a tree in those milliseconds loses what it wrote. What keeps that from being a live case is upstream of the removal: a tree is cold for `--older-than` and no live session references it.

## What a removal left, not what git said

A removal is judged from the directory once git has answered (`src/worktree/pruneRemoved.ts#judgeRemoval`). A path that is gone is removed, whatever git exited with. A zero exit over a directory still there is FAILED. A refusal is a decline only when git demonstrably stopped before deleting anything: the tree is still registered, its `.git` is present, and `status` reads with no deleted file. Anything else — a registration git already dropped, a `.git` that is gone, a status that would not read, a tracked file already deleted — is FAILED, printed with the path, and the run exits non-zero.

The reason a refusal proves nothing is git's own code: when `git worktree remove` fails to delete the working tree, `remove_worktree` in `builtin/worktree.c` goes on and deletes the admin directory anyway ("there's no going back"). The directory is left unregistered with a `.git` pointing at nothing, and every later scan lists registered trees only. So this is the last code that will ever see it: a residue holding only build output and its dangling `.git` is finished here with `rm -rf`, and one holding anything else is left where it is, FAILED with the first file that kept it. `status` is read only for a tree still registered with its `.git` present, because anywhere else git walks up to whatever repository encloses the directory, which for an acme-admin worktree nested inside its main checkout is that main checkout.

**What git never records is out of scope.** Extended attributes, a macOS resource fork and file modes beyond the executable bit live in no commit, so no removal of any class — nor a plain `git worktree remove` — keeps them, and no re-read here compares them. The r3 Codex review hid a payload in `com.apple.ResourceFork` on a tracked file; that is the boundary, stated, rather than a hole in a check. So is git's own layout: the prune trusts the object database to live where git puts it. The same review moved a branch's objects into the worktree's admin directory behind an `objects/info/alternates` entry, which no git command writes, and `git worktree remove` deletes that directory in every class. And a filter or hook that rewrites git's own state is repository code the scan's first `status` already ran: `filterWouldRun` keeps a tree whose filter would run again, but code that can rewrite the index could delete the bytes outright, so the prune does not try to outwit it.

A gutted tree's directory mtime is likewise excluded from its activity stamp: it records this verb's failed
write, not somebody working there, so counting it would defer each interrupted cleanup by a further
`--older-than` and a tree interrupted twice would never be finished at all.

## Cost, and the disk budget

`du -sk` over a worktree whose `node_modules` is a symlink is 0.2s; over one with a real 5.8 GB
`node_modules` it is 39s — reproduce with `time du -sk <worktree>`. The cheap case is going away: since
`worktree create` gave every worktree its own installed dependencies, a slopweaver worktree costs what
its deps mode costs rather than a symlink's nothing, which makes both halves of this verb — the measurement
and the reclaim — matter more, not less. A dry run therefore measures only
CANDIDATES, under a shared five-minute budget (`DISK_BUDGET_MS`), round-robin across repositories so a
shortfall is spread rather than falling entirely on whichever repository git listed second. Anything the
budget does not reach reports no footprint, and the plan labels its total **a FLOOR** rather than
understating in silence.

`--apply` does not measure per tree at all. It reads free space from the filesystem either side of the run,
which is cheaper and truer — `du` counts allocated blocks per tree and double-counts anything the filesystem
shares. **So an `--apply` run's plan prints COUNTS and no gigabyte figure at all**, and never a FLOOR:
`renderPrunePlan` takes `measured`, which `worktree prune` derives from the same `--apply` flag that
decided whether to measure. Measured on the first live acme-admin apply, whose plan read
`0.0 GB in total (a FLOOR — 44 candidate(s) went unmeasured within the disk budget)` — every word of it
true, and unreadable as anything but a failure. The free-space delta the run prints at the end is the
measurement; the plan above it is a census.

## Paced, so a reclaim never takes the machine down

One acme-admin tree is about 5 GB, nearly all `node_modules`: millions of files, each unlink an FSEvents
record. An unpaced acme-admin apply once held the 1-minute load at 119.8 against the 22 hold, with
fseventsd at 113% CPU and 7.2 GB, and it happens every time worktrees are deleted unpaced. An
unpaced delete runs at full speed through both paths, `git worktree remove` in place and the dependency
drop's `rmSync`. So an apply brakes five ways (`src/worktree/prunePacing.ts`):

- **Background priority.** A removal and a drop both rename the tree's `node_modules` into the reclaim
  trash first, the same move `session close-done` makes. A removal whose `node_modules` cannot all be moved
  keeps the whole tree for the next run rather than let git delete it in place. Every delete then runs under `taskpolicy -b`,
  darwin's background QoS tier, which caps CPU and throttles disk I/O behind every foreground process:
  - the trash `rm -rf`;
  - `git worktree remove` itself;
  - a residue's build output;
  - the plugin mirror slots.
- **A load gate before every tree**, every trash batch, every `node_modules` after a tree's first, and every
  mirror root. At or above `machine capacity`'s load hold, the pass stops and owes the rest to the next run.
  It prints `removals paused:` or `node_modules pass paused:` with the load.
- **fseventsd governs every bulk delete from inside**, because load alone let a paced prune storm: at
  load1 10-12, ONE background `rm` of one tree drove fseventsd to 23-47%. So every delete through
  `deleteGently` (the trash, the dependency drop, a residue, the mirror slots) removes its tree in quanta of
  at most 1,000 entries, counted to the last file, and reads fseventsd before each. At 20% CPU it holds,
  re-reading every 2 s, and resumes under 10%, all inside its own timeout (`src/worktree/governedDelete.ts`).
  A tree of at most 64 entries in all goes in one `rm`, still after a read and under the lease. A directory that cannot be
  listed is never handed to `rm`, nor is any directory above it, because its size is unknown. Only a counted
  subtree goes to `rm -rf`; a directory the walk opened goes to `rm -d`, which keeps it if anything is left in it.
  One lease at a fixed per-user path (`worktree/deleteLease.ts`) serialises every governed delete on the machine,
  read and `rm` together, and every `git worktree remove` — the prune's and `worktree remove`'s — waits on it too.
  `SLOPWEAVER_DELETE_LEASE_ROOT` moves it, and only the test lanes set it, each to its own sandbox.
  Only a live holder makes it busy, and it never goes stale while that holder lives; a lease that cannot be taken
  for any other reason (a full disk, a corrupt record) never stops the reclaim that would free the disk. A governed
  delete then runs on the gauge with a whole 2 s pause before every quantum, averaging at most 500 counted entries a second
  per cleanup (several at once can each start one quantum together), and
  git does not run at all: the moved-aside `node_modules` goes to the trash and the tracked tree waits for a lease. Every place the load gate reads also stops at
  20%, and the gate before each worktree removal backs off until fseventsd is under 10%. On darwin a
  missing fseventsd row or a failed `ps` never reads as quiet: a removal backs off on it, a maintenance pass
  stops. mds is not gated: Spotlight runs hot for reasons of its own and `.noindex` keeps it off the trees.
- **No fixed pause between trees: the gate before the next tree IS the drain.** A removal leaves fseventsd
  warm, and the next tree starts only once the gate reads it back under its bar, so a quiet machine pays nothing
  and a busy one waits exactly as long as it is busy. MEASURED: a fixed 30 s sleep after every
  removal, on top of that same gate, held an hourly run to about 15 to 17 trees against a backlog of 213
  (`grep -o "^removed [0-9]* worktree(s)" auto-prune.log | sort | uniq -c`). A `close-done` sweep cannot wait
  inside its reading budget, so it removes at most ONE closed seat's tree, under the same load gate, and leaves
  the rest to the hourly prune.
- **No count stops a removal pass; the deadline, the load and fseventsd do.** MEASURED: a cap of four
  trees per routine run, against a pool of 262 removable trees, was a drain of at least 65 hourly runs. A cap per routine run (`TREES_PER_RUN`) still bounds the maintenance passes, the
  kept trees' dependency drops and the mirror roots. Every delete STARTED counts, a failed one too, because each
  deleted part of a tree; a drop that deleted nothing (no `node_modules` left, say) counts for nothing
  (`pruneDeps.ts#deletedNothing`). Counted, 4 already-stripped trees held the head of the rotation and spent the
  whole cap on every run, while 13 trees were still owed. A batch holding a read-only directory gets one more
  governed pass, which gives each directory owner write as the walk reaches it.
- **The trash is emptied once, in the tail**, after the removals and the mirror pass, on every apply. A batch is a
  `node_modules` of hardlinks into yarn's store, so it frees inodes rather than bytes (the measurement is two
  bullets down), and emptying one after every removal spent nine minutes of a fifteen-minute window on 0.0004 GB.

**Under disk pressure the window goes to unique bytes, and every fseventsd brake stays.** While the state home's
volume reads under the prune floor (`worktreePruneFloorGb`, `src/worktree/pruneFloor.ts`: the higher of the owner's
100 GB and the floor `machine capacity` holds spawns at — 100 GB today — with `df` read afresh before every tree and
every phase), an apply changes two things and nothing else (`src/worktree/prunePressure.ts`). The `max` is a guard,
MEASURED when capacity's floor still scaled with live sessions: sixteen put it at 100.8 GB, so a disk at
100.4 GB held every spawn while a fixed 100 GB floor read it as no pressure at all.

- **The cap steps aside for the plugin-mirror pass**, so it runs to its own deadline.
- **A warning reading HOLDS the removal pass instead of ending it, pressure or not** (`removalGateDecision`):
  the load at `machine capacity`'s hold, fseventsd at 20% (released under 10%) and an fseventsd that could not be
  read each make it re-read every 15 s, and only the removal deadline ends the pass. The owner's ruling: back off until load is back in the acceptable range. MEASURED: a threshold run
  with 227 removals owed read fseventsd at 35.9% at its first gate and removed nothing. MEASURED: 21
  passes had ENDED on one warm reading (8 on a `ps` that timed out, 4 on load, 4 on fseventsd, 5 on the old
  cap; `grep -o "removals paused: .\{0,40\}" auto-prune.log | sort | uniq -c`). The trade, stated: the load
  holds the removals under disk pressure too, and MEASURED: eleven hourly runs at a load of 24 to 60
  removed nothing while the fleet booted onto a nearly full disk. What bounds it now is that the same pressure
  makes `machine capacity` hold every spawn, so the load it holds on falls and the back-off releases inside the
  window rather than at the next run. The mirror pass still stops between roots on a hot fseventsd.
- **No kept tree's dependencies are dropped.** A drop deletes a `node_modules`, and a `node_modules` is
  hardlinks into yarn's store: the trash batch one apply was
  emptying held 157,727 files and 0.0004 GB of unique bytes, against 33,222 files and 0.284 GB in a tree's tracked
  half and 14,508 files and 0.126 GB in a gone mirror root (`find <dir> -type f -ls`, field 4 the link count). At
  the governed rate (about 1,000 entries per 3.5 s) that one batch spent nine minutes of a fifteen-minute window,
  which is why five threshold runs that evening removed 7, 4, 0, 2 and 4 trees.

The order is removals, mirrors, then the trash in whatever the mirror window leaves, under pressure or not.
Background QoS, the delete lease, the gate before each tree and the governed delete's own fseventsd
hold stay exactly as they are. An unreadable volume is routine pacing. `session close-done` keeps the routine
brakes, and deletes no trash at all: it settles it and leaves the delete to the next apply
(`src/cli/commands/session/closeDoneTrash.ts`).

A drop puts the tree's mtime back right after its renames, before any delete starts, so the restore never
rewinds a file a session made in the root during a minutes-long background delete.

`worktrees.noindex` already keeps Spotlight out: the `.noindex` suffix is the exclusion (`worktree
noindex`). FSEvents has no per-directory opt-out. `.fseventsd/no_log` turns it off for the whole volume,
and Time Machine and every file watcher depend on it. So the delete RATE is the lever, and the pacing sets it.

**A ballooned fseventsd stands the whole apply down**, before its scan, when fseventsd's resident size OR its
`top` footprint is at or over 1 GiB: it prints one line naming the pid, the size, which of the two it was and
`sudo killall fseventsd`, deletes nothing, and exits `EXIT_EXPECTED_EMPTY` (`src/worktree/fseventsdBalloon.ts`).
Resident size alone missed a balloon as macOS paged it out: in one night it dipped under the line between
stand-downs, applies removed trees mid-balloon, and the balloon's footprint, which counts the compressed and
swapped pages resident size does not, kept growing. A balloon is a stuck FSEvents client whose queue grows
at the machine's whole event rate, and the prune does not start one: MEASURED across every
supervisor capacity tick, fseventsd sat at 4-16 MB bar two balloons (each climbing about 25 MB a minute to 31 and
36.5 GB), the apply before the first had removed
nothing, and some 45 applies after the killall removed trees with fseventsd flat. But a balloon drives the
prune: its swap holds the disk under the 100 GB floor, so the threshold trigger launched an apply every ten minutes
(30 in one five-hour stretch), each a full scan plus deletes feeding the stuck queue, against swap growing
faster than any run frees. That is the "every prune, fseventsd climbs" pattern the owner saw.

## Live state is a rail, not a nicety

`--apply` REFUSES outright when any live register cannot be read: the workspace list, the session ledger,
the process table, or the owner's open pull requests. A socket that failed to answer is not a list of zero workspaces,
a GitHub read that failed is not a list of zero pull requests, and a tree in use is indistinguishable from a
cold one without them. The pull requests are read so a WARM tree on an open pull request's branch is kept; a
cold one goes ([rule 16](classes.md)). The refusal names each read that failed. A plan still
prints, because a plan deletes nothing. Note that the workspace socket only answers processes started inside
cmux, so a detached run gets a dry run and nothing else — which is the intended failure.
