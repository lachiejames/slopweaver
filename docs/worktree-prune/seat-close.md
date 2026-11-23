# The close reclaims its own seat

The hourly row is the backstop, not the mechanism ([operations](operations.md)). Each firing runs under a
fifteen-minute budget at one removal a minute for slopweaver and one every several for acme-admin, so a fleet that
closes thirty seats in an afternoon hands it a backlog it clears over hours rather than as they close.
`slopweaver session close-done` therefore reclaims the worktree of each seat it has just closed, where the cost is
one tree and the evidence is at its best: the run is done and the workspace is gone, which is exactly what the
hourly row's age threshold stands in for.

**What a slopweaver removal actually frees is its tracked tree, not its `node_modules`.** MEASURED: one
of this repository's trees, outside `node_modules`, is about 0.29 GB (`du -sk -I node_modules <worktree>`: 299,236 and
290,548 KiB on two trees), and its `node_modules` files are hardlinks into yarn's store (`stat -f %l
<worktree>/node_modules/typescript/lib/typescript.js` read 355 links), so a dry run's per-tree `du` figure of
about 3 GB is the shared store counted again. The hourly row's own lines agree: a four-tree run freed 1.0 to 1.3
GB. Every apply runs its removals to its budget, never to a count, and spends its window on
unique bytes: removals, then mirrors, then the trash. Below the prune floor (`src/worktree/pruneFloor.ts`) the
load gate no longer stops it and a hot fseventsd holds it rather than ending it
([decision mechanics](decision-mechanics.md#paced-so-a-reclaim-never-takes-the-machine-down)).
That hold is the CPU brake. A BALLOONED fseventsd, 1 GiB resident or more, stands the whole apply down before
its scan instead, because its swap is what holds the disk under the floor.

- **The age rule is waived, and it is the only one.** `src/sessions/closeDonePrune.ts` passes
  `olderThanMs: 0`; every other hold in `HOLD_RULES` survives untouched, and every `null` fact still holds.
  Unpushed commits, a dirty tree, an untracked file, an ignored file no build writes again, a stash made from
  the tree, an unreadable one, a live reference and an undecidable merge state each keep their worktree
  exactly as they do in the hourly row.
- **Three classes, not six.** `merged`, `pushed` and `detached` are acted on. `salvaged` is the hourly row's
  alone — a seat closes at the end of the run that made the tree, so nothing it sees is a week old, and a
  capture needs the budget and the remote that the hourly row has. The criterion is RECREATABILITY rather
  than how much of the work a remote already carries: `merged` deletes the branch only at a tip the trunk holds and the trunk rebuilds the
  tree, `pushed` keeps its branch and a remote carries every commit on it, and `detached` is only ever removed
  once the remote itself, asked with `ls-remote`, carries the sha, and with that sha kept under
  `refs/slopweaver/pruned-detached/`. `interrupted` forces a removal git is refusing and `gone` frees no disk;
  both stay the hourly row's, which has the whole picture and prints an audit.
- **A removal that did not finish is printed as one.** The seat's reclaim line is judged the same way as the
  hourly row's ([the owner's word](classes.md#the-owners-word-work-committed-nowhere-is-never-destroyed)):
  a path still there after git answered reads `the removal FAILED part-way`, never `git declined`.
- **The bulk is moved aside, then deleted under a budget.** The supervisor tick reads `close-done` with a
  120s budget, and a seat's removal alone ran 55–119s for slopweaver and minutes for acme-admin, so the tick
  killed the sweep on about half its passes — losing the report after the close had landed, and
  able to land mid `git worktree remove`. So each wholly ignored `node_modules` is first RENAMED into
  `<checkout>/.claude/worktrees.noindex/.reclaim-trash/` (same volume, ignored), git removes what is left
  without `--force`, and a refusal renames it back. The sweep then SETTLES the trash and deletes none of it:
  one batch is a whole `node_modules`, which the sweep's reading budget could not finish, so a delete per sweep
  left 325 batches standing. The delete is `worktree prune --apply`'s, in its tail. A batch
  stays PENDING until git has removed its tree and is never emptied while pending: a sweep killed between the
  move and git's refusal leaves one whose writer is dead, and the next sweep renames it back into the tree.
  `src/worktree/reclaimTrash.ts` carries the criterion and why nothing but `node_modules` moves. The hourly
  row moves the bulk aside the same way and empties the whole trash in the window the mirror pass did not use
  ([decision mechanics](decision-mechanics.md#paced-so-a-reclaim-never-takes-the-machine-down)).
- **The root `node_modules` goes to the recycle pool when a slot is free.** After git has removed the tree and
  BEFORE the batch is committed — while no emptier of any vintage will touch it — an eligible root tree is
  renamed into `<checkout>/.claude/worktrees.noindex/.recycle-pool/<slot>/`, for the next provision to start
  from. Eligibility is read before the move, while the tree's `package.json` still exists: its
  `.yarn-state.yml` must name that package's root workspace. Four fixed slots, each taken by a `mkdir`; a full
  pool, another volume or an ineligible tree leaves it in the batch, deleted with it. No emptier reads the
  pool and an entry leaves it only by rename, so a crash anywhere leaves either a whole entry or none. Trees
  already in the trash are never harvested: a committed batch may be mid `rm -rf` by an older checkout's sweep.
- **`--keep-worktrees` narrows the sweep back to closing chats.** It is a switch, not a refusal — there is no
  escape hatch here because nothing is being blocked.
