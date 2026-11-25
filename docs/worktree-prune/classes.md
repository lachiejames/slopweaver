# Why a verb and not another cleanup

Part of [Reclaiming worktrees](../worktree-prune.md).

Three manual passes had already run, each finding the same backlog and each leaving the mechanism unbuilt:

| Pass   | What ran                                                             | What it left                                                               |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| First  | a disk-cleanup pass, 66 worktrees removed                            | named the gap in writing: "closing a session does not remove its worktree" |
| Second | `legacy-superseded-prune-audit` — report only, no deletions          | a list, and the same gap                                                   |
| Third  | `worktree-strays-cleanup-20aug` — 16 strays and dangling directories | the blessed homes themselves, still unswept                                |

**No scheduled prune recipe existed before this verb.** The recipe registry it would have had to join was a
closed list, and no member of it had ever concerned worktrees or disk. What existed was three one-off passes, which is what the memory of "we made a
scheduled job for this" is actually a memory of. A `worktree-prune` recipe runs hourly and calls this
verb, declared in code so that deleting it is loud — see
[the hourly slot](operations.md#the-hourly-slot-and-what-it-took-to-make-it-keep-up) and
[the hole that left](operations.md#the-hole-that-left-and-the-declaration-that-closes-it). Every close reclaims its own
seat besides ([the close reclaims its own seat](seat-close.md)), which is where the cost
of a removal is one tree rather than a day's backlog.

## The classes

A worktree lands in exactly one class. `--apply` acts on `merged`, `interrupted`, `pushed`, `detached`,
`snapshot`, `lap` and `salvaged` — the first four under the owner's untouched-over-24h rule, `snapshot` past the
longest Codex pass, `lap` once the lap that minted it has stopped, the last under the owner's over-a-week one;
`--merged-only` narrows it to the first two;
nothing ever REMOVES a `hold` or `gone` tree. `--no-salvage` turns the waiver off, so no tree is `salvaged`
and the run pushes nothing: a tree carrying work no remote has stays `hold` under its own reason and still
drops its cold `node_modules`, for a checkout whose remote must never receive a salvage branch
(`src/worktree/pruneOptions.ts#salvageWaiverMs`). It refuses `--nuke-after` beside it. It is also the one thing
that admits an UNDECLARED checkout: `--repo <path> --no-salvage` sweeps a main checkout the profile never named,
provided its `.git` is a directory, with every hold above unchanged; declaring it instead would enrol it in the
hourly prune, salvage on, and every other `mainCheckouts` consumer
(`src/cli/commands/worktree/pruneScanPass.ts#admitPruneRepo`).

A Codex snapshot-pool slot is in NO class: it is never listed at all. A slot stays registered between passes
by design, so classing it would salvage a reused tree a running pass may hold the lease on
(`src/worktree/snapshotPoolPath.ts`). A one-off `<tmpdir>/slopweaver-snap-<6>/tree` snapshot left behind by a
pass that died is `snapshot` once untouched for 25 hours, the longest pass plus one: a frozen copy of another
tree, so it goes with nothing pushed. MEASURED, 31 of the hourly run's 87 held trees were these
(`src/worktree/freshSnapshotPath.ts`). The shape alone is not provenance, so its HEAD must also be the
snapshot code's own commit, `slopweaver: frozen tree for one Codex pass`: a tree a person made at that path, or
one committed onto since, is judged by the ordinary detached rules instead. A copy can still be the LAST copy: the
snapshot freezes its source's uncommitted and untracked files over a parent no ref may carry, so it is a `snapshot`
only when its tree equals its parent's and some branch, tag or remote-tracking ref contains that parent
(`snapshotWitnessed`) — never a per-worktree ref such as `refs/bisect/`, which lives in the tree's own gitdir and
goes with the removal; any other goes to the ordinary rules, held and past the waiver salvaged. Its removal goes only at the HEAD the
scan read, that exact commit's message re-read and still cold (`src/worktree/pruneRecheck.ts#pinSnapshot`), so a
commit made after the scan, or between the scan's own two reads, keeps it however it is dated. The witness is
evidence; what keeps the work is a local ref, `refs/slopweaver/pruned-snapshot/<sha>`, written before the removal,
so the branch that carried the parent can go between the read and the removal and nothing becomes unreachable.
The tree's own gitdir, which the removal deletes, may hold only the six files a snapshot's creation writes
(`HEAD`, `ORIG_HEAD`, `commondir`, `gitdir`, `index`, `logs/HEAD`, measured across all 31 live snapshots), and
every object id in them, both sides of each reflog line, must be that HEAD or an ancestor; the binary index
must carry no resolve-undo record, which keeps a resolved conflict's sides there alone. Any other file —
sequencer state, `FETCH_HEAD`, `MERGE_HEAD`, a per-worktree ref, `COMMIT_EDITMSG` — is work done in the tree. An
allowlist rather than a reader per format, because each narrow reader lost a commit, the last to an abbreviated
id (`src/worktree/snapshotPrivateHistory.ts`). The scan applies it too, so such a tree goes to the ordinary rules
instead of being declined as a snapshot every hour. The residue is a commit someone writes with that exact message by hand, and the one
read's width every class shares (below): a write into the tree — a commit, a ref — landing between its last read
and `git worktree remove`, which git offers no compare-and-remove to close. A snapshot's private gitdir is read
again in `changedSinceScan`, beside that last HEAD read, so the width is that instant and not the whole apply.

A `github lap` tree under the cache's `lap-trees/` directory, named `sw-lap-<6>`, is `lap` once the lap that
minted it is gone. A lap removes its own tree on every exit, a stop signal included
([teardown](../../skills/github/reference/lap-teardown.md)), so this is for one killed outright. Shape is not provenance: the lap writes a marker into the tree's
private gitdir naming its pid, that process's start stamp and the HEAD it minted
(`src/worktree/lapTreeProvenance.ts`), and the tree is `lap` only while that pid and start stamp name no running
process. A **marked** tree goes from the hourly run. An **unmarked** one — minted before the marker existed — is
held there under its own reason, and goes only under an explicit `worktree prune --include-unmarked-lap`, and
only when a kept ref contains its HEAD. Kept is an ALLOWLIST, so an unknown namespace never admits a tree:
`refs/remotes/`, `refs/tags/`, `refs/heads/` except the tree's own `salvage/<slug>-` branches,
`refs/slopweaver/pruned-lap/` and `refs/slopweaver/operator-lap/`. Scratch (`refs/tmp/`), the lap's own moving
`refs/slopweaver/lap/` and a stash are not. Every unmarked verdict prints the HEAD and the ref that admitted it,
or the line that none did; an operator admits one by writing `refs/slopweaver/operator-lap/<sha>` first. The
lap's own report directories are excused from the ignored-file hold for this class only, and every other hold —
dirty, stash, a hidden file, a live reference — still fires. The removal pins its HEAD at
`refs/slopweaver/pruned-lap/<sha>` first, after re-reading the marker, the minter, the HEAD and the private
gitdir (which may hold the marker beside a snapshot's six files), and runs without `--force`, so git's own dirty
check is the second opinion (`src/worktree/pruneLapPin.ts`).

| Class         | Membership                                                                                                              | What `--apply` does                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `merged`      | absorbed into the trunk, clean, unreferenced, and older than `--older-than`                                             | removes the tree, then deletes the branch only when the trunk carries its tip                                                                  |
| `interrupted` | every status entry a deletion, its work in the trunk or on its own remote branch, unreferenced, cold                    | finishes it with `--force`; deletes the branch only when the trunk holds it — [`--force`](decision-mechanics.md#the-one-place---force-is-used) |
| `pushed`      | clean and fully pushed, but NOT absorbed — the tree is recreatable, the branch is not disposable                        | removes the tree and KEEPS the branch; skipped by `--merged-only`                                                                              |
| `detached`    | no branch, but a remote ref still contains the HEAD commit                                                              | removes the tree; `git worktree add --detach <sha>` recreates it                                                                               |
| `snapshot`    | a one-off Codex snapshot under the OS temp directory, unreferenced and untouched for 25 hours                           | removes the tree; nothing is pushed, because it is a copy of another tree                                                                      |
| `lap`         | a `github lap` tree whose marked minter has stopped, or an unmarked one a kept ref holds under `--include-unmarked-lap` | pins its HEAD under `refs/slopweaver/pruned-lap/`, then removes the tree without `--force`                                                     |
| `salvaged`    | past `--nuke-after` and held only by work a push can carry — dirty, deletions, commits on no remote, or a detached HEAD | pushes the work to a remote branch, then removes the tree; never reached under `--no-salvage`                                                  |
| `gone`        | registered by git, absent from disk                                                                                     | `git worktree prune` clears the record; frees nothing                                                                                          |
| `hold`        | anything a safety rule stops                                                                                            | never removed; a cold, unreferenced one drops its `node_modules`                                                                               |

The hold rules, in the order they fire — the first match is the reason printed, so the list runs
most-alarming first. They live as one ordered list in `src/worktree/pruneClassify.ts#HOLD_RULES`:

1. the repository's own main checkout;
2. a live session, workspace or process whose working directory is at or under the path;
3. a working tree that could not be read;
4. which files it hides from status (`--assume-unchanged`, `--skip-worktree`) could not be read or compared;
5. its ignored files could not be listed;
6. its stashes could not be listed;
7. an ignored file no build writes again ([the owner's word](#the-owners-word-work-committed-nowhere-is-never-destroyed));
8. a stash made from the tree;
9. a hidden file whose bytes differ from its staged blob, or are missing;
10. uncommitted changes that are not purely deletions, an untracked file included;
11. an all-deletions tree whose work is in **neither** the trunk nor its own remote branch — a deletion to investigate;
12. a detached HEAD **no remote ref contains**, so nothing could recreate the tree;
13. an unbacked-commit count that could not be read at all, for a tree that HAS a branch;
14. commits on no remote, for a tree that HAS a branch;
15. no readable activity timestamp;
16. touched more recently than `--older-than`, **unless the board reports its run closed, or the tree is clean
    on its own pushed branch**. An open pull request of the owner's whose head is the branch the tree has out re-arms
    this rule past both of those: the tree holds while it is warm, with the pull request named, and goes once
    it is cold, because the branch on the remote recreates it. A branch the trunk has already absorbed is cold
    after `min(--older-than, 2h)` rather than the full window;
17. a merge state that could not be determined, for a tree that HAS a branch.

**Every `null` fact holds.** A scan that failed to read a working tree is not evidence the tree is clean.

**Rule 2 is read twice.** The scan reads the live registers once, and `--apply` reads them again before every
removal, because a bounded scan plus a bounded apply can leave the last removal well behind the census that chose
it, and `git worktree remove` deletes a directory a process is standing in and exits 0. There are four
registers. Three hold a tree by PATH, at any age: an open session in the ledger, a live cmux workspace, and any
live process whose working directory `lsof -a -d cwd -Fn` reports at or under it, which is what a background
agent or a shell working there leaves. The fourth reads by BRANCH: an open pull request of the owner's, read from GitHub's
`viewer.pullRequests(states: OPEN)`, whose head is the branch the tree has out, and it holds the tree only while
the tree is WARM (rule 16). A cold tree under an open pull request is removed and its `node_modules` dropped:
the pushed branch is the work, and a fresh `git worktree add` recreates the tree. The hourly apply
once removed one tree a background agent was working in and another whose pull request was open and touched
that hour; the process register and the warm pull-request hold are those two. A tree any path register took
since the scan is kept and printed with the reference that holds it (`live process 4242 (cwd …)`), and so is one
a reference stands BENEATH: a workspace in `<tree>/apps/web` holds `<tree>` exactly as one at its root does. A
tree whose branch gained an open pull request since the scan is re-judged on its activity at that moment, and
kept only when it is still warm (`taken since the scan — touched 1h ago, with open pull request
lachiejames/slopweaver#<number> on its branch`). A `merged` or `pushed` verdict carries the activity window
it was judged against, and the removal reads the tree's activity again against that window: a tree touched
since the scan, inside it, is kept (`taken since the scan — touched 0h ago`) and the next run judges it, so a
seat that went back into a merged tree after the census is never removed from under it.
The dependency pass reads them fresh the same way, once per tree, right before that tree loses its
`node_modules`. Any register unreadable — the workspace list, the session ledger or one ledger line that does
not parse, the process table, or a pull-request list that does not add up to GitHub's own count — reads as
incomplete, never as "no sessions" or "no open pull requests", and keeps every tree with the failed reads named. What remains is one read's width: a session opening in a cold tree between that read and the removal,
which only a lock every session launch shares would close.

**Five of those holds are WAIVED past `--nuke-after` (default 7d) — 9, 10, 11, 12 and 14, and only into
`salvaged`.** Each of the five says the same thing in different words: this tree carries work that exists nowhere
else, in a form a pushed branch can carry. Rules 7 and 8 never waive, because the capture commits with `add -A`,
which stages no ignored file, and a pushed branch carries no stash. `--no-salvage` waives none of the five, so
each stays a `hold` and a cold one still drops its `node_modules`.
The owner's rule is that a week-old worktree is regenerable and should go, provided the work on it is pushed
to a remote branch first — so the waiver and the capture are one rule, not two. **The capture always mints a
fresh `salvage/<slug>-<sha8>` branch**, including for a tree that already had a branch of its own: a
week-old feature worktree is often sitting on the head of an open pull request, and pushing its stale
working tree under that name would move the review and re-run its CI. **The name is PROBED free rather than
assumed free**, against the local repository and against the remote, walking `-2`, `-3` and so on until one
is unused, because `git push <name>:<name>` fast-forwards a ref that is already there and the read-back
would call that a success. A remote the probe cannot read keeps the tree.

**How the capture keeps every byte, and what its push may publish, is its own page:
[the salvage capture](salvage.md).** In short: both the index and the working tree are
committed, every hook and file monitor is off, hidden bits are cleared before measuring, ignored files that no
build writes again have already held the tree, and the push goes only after today's secrets scan reads every object
it would send.

The other twelve never waive
at any age. Rules 3, 4, 5, 6, 13, 15 and 17 are why the flag is per-rule rather than one age test around the loop: a
fact that could not be READ has not been shown to be a week old either, and the owner's rule is stated entirely in
"since touched". Rule 16 needs no waiver, because anything past a week is past 24 hours already.

## The three widenings, and the witness each rests on

The owner's driver: 80 of acme-admin's 90 worktrees were held and the run removed none of them. Measured
with `slopweaver worktree prune --repo ~/dev/acme-admin --json`, those 80 were 24 detached HEADs, 27
branches with commits on no remote, 12 dirty trees, 12 touched under 24 h, 2 interrupted removals whose work
is not in the trunk, 2 live-referenced, and the main checkout. **Every widening is a class with a witness,
never a looser age cut** — the 24-hour rule is untouched, and each new class holds exactly as before when its
witness is absent or unreadable.

- **A detached HEAD a remote carries is recreatable.** A removal asks whether the TREE can be brought
  back, not whether a branch's merge state can be checked, and `git branch --remotes --contains <sha>`
  answers it. The witness is the containing ref, printed
  in the reason with the exact `git worktree add --detach <sha>` that recreates the tree. No containing ref,
  or a git that could not be asked, still holds. A bare `origin` in that list is `refs/remotes/origin/HEAD`
  rendered short rather than a branch, so only a `<remote>/<branch>` spelling counts.
- **Commits on no remote hold the tree** ([the owner's word](#the-owners-word-work-committed-nowhere-is-never-destroyed)),
  and past the week the salvage pushes them to a remote branch first.
- **A closed board row is coldness, whatever the mtime says.** The one rule a closed run disarms is the age
  rule, and only for a row `slopweaver handover` reports `closed` whose recorded branch is this worktree's
  own branch. Both halves matter: a missing journal reads as closed on phase alone, and matching by branch
  rather than by directory basename is what keeps an unrelated run from disarming somebody's tree. A
  directory mtime is routinely this machine's own indexing or a sibling session's `du`, neither of which is
  somebody working there.

## The reclaims, and what the disk was actually holding

The owner expected hundreds of GB back, while only tens of GB remained free on an approximately terabyte
volume. Measured with `slopweaver worktree prune --json`: hundreds of registrations were held. **The
`hardlinks-local` monorepo is where the disk is**. Its yarn `nmMode: hardlinks-local` gives every worktree
real files: dozens of sampled trees averaged several GB, mostly `node_modules`. A `hardlinks-global`
repository's trees remain near-free. Four changes follow:

- **A hidden bit over unchanged bytes is not hidden work.** Many of those holds were acme-admin trees whose ONLY
  finding was `S` (skip-worktree) on `packages/web-ui/tsconfig.shared.json`. Every acme-admin checkout carries
  that bit, the main one included, and every one's `git hash-object` matched its staged blob. Rules 4 and 9
  compare content: a hidden file counts only when its raw bytes or its mode differ from the index, or it is not a regular file inside the tree (a symlinked parent directory counts). The read
  runs no filter (`hash-object --no-filters`), and `--apply` takes it again right before each removal,
  because `git worktree remove` does not look at a hidden file.
- **A clean tree on its own pushed branch is cold whatever its run's state, after a two-hour floor.** A run is
  resumable from its branch (the owner's rule). So `origin/<branch>` existing, with the local branch nothing
  ahead of it, narrows the coldness rule to the same two hours a merged branch gets, rather than disarming it
  as a closed board row does. The floor is measured: with no age test at all, the unattended apply removed one
  such tree four times in under forty minutes, the first 12 minutes after its newest commit, while a seat
  whose cwd was another worktree worked in it, so no live register could see it. `--apply` judges the tree's
  activity again against that window right before removing it. It must be the branch's OWN remote branch. A
  worktree cut from the trunk a second ago is contained by `origin/main` and has a session about to start in
  it. Live references still hold first.
- **A worktree `git worktree lock` locked is never removed**, at any age, closed row or not: the scan holds it
  and the removal reads git's list once more before it moves `node_modules` aside. Nor is it stripped: a locked
  tree keeps its `node_modules`, and the dependency pass reads the list again before it moves one. A seat working in a tree
  that is not its cwd takes that lock to protect it.
- **A kept tree gives up its `node_modules`.** See [below](decision-mechanics.md).
- **A dirty tree is asked its merge state.** 51 more holds read "merge state could not be determined", the
  same 51 in two censuses, and every one was dirty and over a week cold. The dirt hold waives past
  `--nuke-after`, so the classifier reads on into the merge question and the scan asks it of a dirty tree
  too; asked, they reach `salvaged` as the week-old rule intends.

## The owner's word: held only for uncommitted or unpushed work

The owner's ruling, on two acme-admin trees a seat removed by hand after this verb kept them: a worktree
lying around for parked work, untouched for a few days, is not earning its keep, and its branches are already
pushed to the remote anyway. Whatever is in a worktree is not something to hang on to unless it is uncommitted
or unpushed, and being more aggressive with the cleanup is preferable. Measured with `slopweaver worktree prune
--json`: of 46 holds, every one was live, a main checkout, warm, dirty, unreadable, or a detached Codex snapshot on
no remote. Two shapes that are neither uncommitted nor unpushed work do not hold:

- **A gutted tree on its own pushed branch is finished.** `anthropic-usage-limit-monitor`'s 130 changes were all
  deleted checkout files, and its one commit landed revised, so no patch id matched it in the trunk and rule
  11 would hold it — then, past a week, salvage a branch whose only content was deletions. Every deleted byte
  is in HEAD; `origin/<branch>` at or ahead of HEAD, nothing hidden, is the witness that HEAD is on a remote — read
  from the local remote-tracking ref, as for `pushed`, and the branch ref is kept either way. It
  classifies `interrupted` and its branch is KEPT (`src/worktree/pruneClassify.ts#headOnOwnRemote`).
- **Build output does not decline a salvage.** A `dist/` or `.turbo/` would keep a week-old dirty tree forever,
  retried hourly; see [the salvage capture](salvage.md). The owner's word on work committed nowhere narrows this to build output: an
  ignored file no build writes again, such as `.env.local`, holds the tree.

One hold is stricter, because a commit only a stale ref names IS unpushed work: **a `detached` removal asks the
remote itself.** The scan's witness is a remote-tracking ref, which outlives a branch GitHub deletes on merge,
and a detached tree keeps no local ref — so right before removing one, `--apply` runs `ls-remote` for the
branches those refs name and removes the tree only when a live tip here descends from HEAD
(`src/worktree/pruneRemote.ts#remoteStillCarries`). A deleted, force-moved or unreachable branch keeps the tree.
The remote can still drop the branch a moment later, so the removal first keeps HEAD under a local ref,
`refs/slopweaver/pruned-detached/<sha>`, and re-reads HEAD last (`src/worktree/pruneRecheck.ts#pinDetached`).
`git for-each-ref refs/slopweaver/pruned-detached/` lists them; `git update-ref -d <ref>` lets one go.

What stays: `--older-than 24h` and `--nuke-after 7d` (the owner's standing number, over a week), every `null` rule, the live reference and the main checkout. A tree a session removes by hand
under this word is recorded with `slopweaver autonomy record` as kind `remove-worktree-with-no-unique-work`,
which the owner's class steer
`worktree-prune-removals` settles, so it never raises a check-in card.

## The owner's word: work committed nowhere is never destroyed

The owner's ruling, relayed through the supervisor, has two requirements:

1. Scheduled pruning keeps running, because disk fills fast. When a tree is pruned the whole tree goes, its `.git`
   file or folder included. A half-pruned tree is a defect, and a removal that cannot finish is reported as a
   failure, never as a success.
2. Work or context committed nowhere is never destroyed: untracked files, ignored files that are not reproducible
   build output (such as path-keyed Codex plan and review records, or `.slopweaver` and agent state in the tree),
   stashes tied to the tree, and unpushed commits. Any of these holds the tree.

For the first:

- **A removal is judged from the directory afterwards, never from git's exit code alone**
  (`src/worktree/pruneRemoved.ts`). When `git worktree remove` cannot delete the working tree, it deletes the
  tree's registration anyway, so the residue is invisible to every later scan. A path that is gone is removed.
  A refusal is a decline only when git demonstrably stopped before deleting anything: the tree is still
  registered, its `.git` is present, and its status shows no deleted file. Everything else is FAILED.
- **An unregistered residue of build output is finished.** When everything left is a reproducible directory such
  as `node_modules/` or the dangling `.git`, it is deleted, because no later scan will see it. Anything else in it
  is left where it is and printed as FAILED with its path.
- **A failed removal fails the run.** `worktree prune --apply` exits non-zero when any removal failed. The hourly
  row keeps firing on the next hour regardless, and a seat close prints the failure in its reclaim line.

For the second:

- **Ignored files are read with `git ls-files --others --ignored --exclude-standard --directory`**
  (`src/worktree/pruneContext.ts`). The allowlist names what is reproducible, never what is precious: anything it
  does not recognise holds the tree, so a new kind of agent state is kept by default. Its entries were read off
  every registered worktree.
- **A stash is tied to a tree** when its subject names the tree's branch, or it was made on the tree's current
  HEAD. The stash list is the whole repository's, so a stash another tree made on the same commit holds this one
  too. That costs disk, never work.
- **Commits on no remote hold the tree.** Past `--nuke-after` the salvage
  pushes them to a fresh `salvage/*` branch and confirms them on the remote before the tree goes.
- **None of these is trusted from the scan alone.** `--apply` reads the ignored files, the stashes and a kept
  branch's commits on no remote again right before each removal
  (`src/worktree/pruneRecheck.ts#changedSinceScan`). A failed read is `null`, which holds at classify time and
  keeps the tree at apply time.
