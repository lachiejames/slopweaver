---
name: home
description: Take the obviously-junk bytes out of $SLOPWEAVER_HOME and read back every reclaim that has run. Reclaim has one declared root, one class — a FINISHED Codex pass's whole scratch workspace, never its record — and reports everything while writing nothing without --apply. Use when the home has grown, when asked "what is taking up space in the slopweaver home", "clean up node_modules", "why is there a node_modules in my home directory at all", or when you need to know what a previous reclaim already took and whether its witness held.
argument-hint: "reclaim [--root codex-scratch] [--apply] [--json] | reclaimed [--json]"
---

**The owner's ask**: of the bytes in the user-level home, delete what is obviously junk —
`node_modules`, build output — with **no retention policy**, and keep anything that could hold useful
information not re-derivable elsewhere.

So there is **no age anywhere in this verb**. Every criterion is a fact about what a directory IS.

## The verbs

```bash
slopweaver home reclaim [--root <name>] [--apply] [--home <dir>] [--json]
slopweaver home reclaimed [--home <dir>] [--json]
```

`reclaim` reports and deletes nothing. With `--apply` it removes, then proves it took only what it said, then
appends a ledger row. `reclaimed` reads that ledger back.

## What it reaches, and what it can never reach

One root, `codex-scratch` (the home's `orchestration/` directory), and one class inside it: the whole
`<passId>.scratch` workspace of a pass that has FINISHED — the clones, installs and builds it ran to check a claim.
The pass's output is its record directory, `<passId>/` (`record.json` and `artifact.md`, mirrored into the store as a
`codex_pass` row), and nothing opens the scratch once that exists: store import, the pass ledger and this verb skip
`.scratch` by name. Measured: `orchestration` at 56 GB, of which taking only package and build trees freed
4.2 GB; the rest was repository clones with their own object stores, caches under other names and a desktop build.

`src/home/reclaim/roots.ts` is an **allowlist**, and that is a design decision rather than caution.
`src/store/homeShare.ts` says in its own header that its register list cannot be complete, so under a
denylist a directory nobody has thought about yet defaults to deletable — and the first thing that would take
is `exec-store/`, the content-addressed store every checkout privatised before it moved to the cache root
(`src/cacheHome.ts`) is still hardlinked to. Large,
rebuildable, content-addressed: junk by every heuristic, and the dedup mechanism itself.

Never taken, each for its own reason:

- **A pass that has not finished.** A scratch is entered only where the sibling `<passId>/artifact.md`
  exists, which `src/codex/artifactStore.ts` writes LAST. That conservatism costs 21 directories and 2.9 MB,
  measured.
- **The pass's record.** `<passId>/` is never a candidate; it is what the witness re-checks. Nor is a
  `.scratch`-named directory holding a `record.json` or `artifact.md`: that is a record whose id ends so.
- **A kept file it cannot `lstat`.** Only a file that vanished mid-walk is passed over; any other failure
  stops the run before a removal, so the witness never says held over a path it did not see.
- **A scratch that is a symlink.** The walk never follows one, so it is never a candidate.
- **Anything outside `orchestration/`.** Naming a second root is a reviewed change to one array.

## The one rule that must survive every later edit

**Never add a content-identity class.** Under a scratch root the PATH is the state: a script opens a name,
not bytes, and no walk can know which names another module opens next.

This is a finding, not a preference. One reclaim took 553,910 byte-identical entries
out of `supervisor-scratch` while its `handoff-<n>` directory was the LIVE supervisor chair's, including
`handoff-<n>/shell.txt` and `handoff-<n>/autonomy-qualified.jsonl` — two files `src/supervisor/scratch/carry.ts`
and `src/cli/commands/supervisor/scratchRun.ts` open by name on every pass. The briefing publish refused to
render four minutes later. Identical content there is the ordinary case rather than the suspicious one:
That directory held `autonomy-raw-188.jsonl` through `autonomy-raw-197.jsonl` at exactly 440,746 bytes each,
because a reading that did not change between passes is a real reading.

No safe residue narrows such a class, so none exists, and `supervisor-scratch` is not a declared root at all. `roots.ts`'s header carries the whole finding;
`src/__tests__/unit/home/reclaimRoots.test.ts` reddens if either is re-declared.

## Why a `node_modules` is in a user-level home at all

The other half of the owner's ask, and it is a rail rather than an oversight.

Codex runs under a `workspace-write` sandbox: the repository is deliberately NOT writable and deliberately
NOT in `additionalDirectories`, which is the only reason a pass can run arbitrary commands while the checkout
stays safe from it. The one directory a pass may write is the scratch this home mints for it,
`createPassScratch` in `src/codex/artifactStore.ts`. So a pass that installs a dependency, builds a mutant or
reproduces a bug has exactly one place to put the result: `$SLOPWEAVER_HOME/orchestration/<passId>.scratch`.

The `node_modules` in the home is the shadow of the repo-unwritable rail. The scratch is the bench a pass
worked at, and what the work showed is in its artifact, so once that exists the whole bench goes.

`supervisor-scratch` is the other large tree, and nothing grows it: `carry.ts` carries a seat forward on a
three-file allowlist. This verb cannot touch it.

## The witness, and why its DIMENSION is the whole point

A delete has no undo, so "it was safe" is a CHECKED claim rather than an argument. After the removal,
`src/home/reclaim/run.ts` re-`lstat`s every path the walk KEPT — every top-level entry it did not take, by
name, and every regular file outside the spent workspaces, so every pass record and unfinished scratch, an
empty one included — and a run that cannot show that returns `WITNESS_FAILED` naming what went missing. An
empty directory or a link deeper than the top level is not re-checked.

Content reachability is not a witness: both files the damaging run deleted were byte-duplicates whose content
survived elsewhere, so a content check held on the run that broke the chair. Proving bytes exist somewhere is
not proving a path a reader opens still resolves.

## The ledger

Every applied run appends a row to `ledgers/home-reclaim.jsonl`: the root, the class, the entries, the bytes,
whether the witness held, and the session that ran it. A wrong act is found afterwards by somebody who was
not there, which is the only recourse left once the bytes are gone.

Every row prints, the damaging one included. `survivingDigests` is an optional field on the row type, and
its column renders only for a content-identity row: the `build-tree` run carries a `0` it never
computed, which printed would read as a claim nothing survived.

## The modules

| Module                                | What it is                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `src/home/reclaim/roots.ts`           | the allowlist, and the finding above it                                       |
| `src/home/reclaim/finishedScratch.ts` | the pure rule: is this scratch finished                                       |
| `src/home/reclaim/scan.ts`            | the effectful half — walk, remove, re-stat; `lstat` never `stat`              |
| `src/home/reclaim/run.ts`             | one root's reclaim, and the witness                                           |
| `src/home/reclaim/journalRow.ts`      | the ledger row's shape and how it renders                                     |
| `src/home/reclaim/journalStore.ts`    | reading and appending it; an unreadable ledger is a failure, not an empty one |
| `src/cli/commands/home/`              | the thin verb shell, usage text and flag specs                                |

## What is NOT in scope, and why it is a question for the owner

`supervisor-scratch` is the largest thing in the home and 582,363 of its 582,413 files are tracked in the
home's own git, whose object store is 3.0 GB (measured; repro: `cd $SLOPWEAVER_HOME && git
ls-files supervisor-scratch | wc -l && du -sh .git`). So the working copy is re-derivable on the same disk.

Deleting it is not this verb's call. "Tracked and unmodified" is a real criterion, but a file restored by
hand is not there at the moment a script opens it, and taking it would be a retention decision the owner
declined. It is put to the owner on `page:home-junk-257-3`; act on the owner's answer, never ahead of it.
