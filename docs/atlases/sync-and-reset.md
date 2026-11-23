# A sync is a SOFT RECONCILE; `reset` is the hard one, and it is reversible

Part of [Atlases](../atlases.md).

Owner ruling: a sync does not erase everything locally and pull from scratch — that is a hard sync. A sync,
or soft sync, pulls what changed to reconcile local state with remote state, and should not even be capable
of wiping an atlas's local holdings. Two verbs, and the split is
mechanical rather than a convention.

**`sync` cannot empty a kind it read as non-empty.** `src/atlas/kit/evidenceLoss.ts` judges two rules at every publish, and every
one of the atlases goes through it because `publishAtlas` is the single seam — nothing outside `atlas/kit/`
writes a kind file. `degraded` is the older rule: a run whose attempt FAILED may not publish fewer entities
or artifacts than the store holds. `emptied` is the ruling above: a kind going from non-zero entities to zero
is refused **whatever the attempt claims about itself**. It reads counts and no verdict, deliberately —
`lastAttempt.outcome` means different things on different atlases (42 failing tests when it was lifted into
the kit), while a count means the same thing on all of them. A provider that genuinely dropped every row is
real, so the way through is the `atlas-evidence-loss` escape hatch rather than an exception.

**What it compares against is what a walk may still PRODUCE, which is the voluminous ruling meeting this guard.** Rows a
whole-kind `shape-index` verdict retired leave the comparison entirely (`volume.ts`'s `shapeIndexedDropped`);
rows an OPERATION-scoped verdict retired leave BOTH sides of it (`evidenceLoss.ts`'s
`keptRows`) while the kind itself stays judged, because that kind keeps its entity half and emptying THAT
half is still a loss — including when retired rows ride in to pad the count. Without
the second half the two declarations deadlock, and it was measured rather than reasoned: JumpCloud declared
`v2-policyresults-list` and `v2-list-device-asset-history` shape-indexed while large retired observation populations
from before the declaration sat on disk, so no run whose attempt at those kinds failed could
ever publish. MEASURED: a scheduled resync walked its full fan-out and was refused
`degraded` because the replacement populations were materially smaller, leaving the atlas clock stale. A generation that republished a
retired operation's rows is still caught by `refuseVoluminousRows`, which reads the files rather than this
comparison.

**That guard is about ONE writer, and the second half is what makes it hold against two.** A Codex review
pass produced the counterexample: with the hatch closed, writer A reads a kind at 0 entities and is admitted
0 → 0, is descheduled before the swap installs anything, writer B publishes one entity and completes, and A
resumes and installs its already-approved empty file over B's — 1 → 0 with no hatch open. The owner's ruling
names that case in the same breath as the wipe (two processes running at once), so `publishAtlas` takes
`src/atlas/kit/mutationLock.ts`'s lock and **compare-and-swaps against the whole manifest a candidate was
derived from**, on every publish, with no way to opt out. Two consequences are the rule rather than notes:

- **Correctness is not a call anybody can forget.** A lock each store takes voluntarily lets a NEW atlas that
  omits it lose an update silently. The operation lock (`acquireOperationLock`, `src/admit/operationLock.ts`)
  that `publishGuard.ts` and the atlas modules take is a **cost control** — an atlas whose channels each spend minutes with a provider wraps the whole pass in
  it so the loser waits instead of working — and it keeps its own key, because `acquireOperationLock` is not
  reentrant and sharing one would deadlock the wrapper.
- **`updatedAt` is not a generation identity**, so the swap compares the manifest's whole stable
  serialisation. The clock is DERIVED from the kind files a generation vouches for, so two candidates built
  from the same evidence in the same second legitimately carry the same one.

Every publisher therefore passes a real `derivedFrom` — the manifest it read and built ON — and `null` means
"the store held nothing", which is refused the moment a generation exists. A compiled publisher that derives
its generation from a committed table rather than from the store reads the manifest for exactly this reason;
`reset` and `restore` rename the live generation away first, so their `null` is true rather than excused, and
they hold the lock across the whole transaction through a branded lease `publishAtlas` accepts instead of
acquiring. The two-writer witness is `src/__tests__/unit/atlas/kit/publicationCorrectness.test.ts`.

**The critical section itself is kit-owned, on all four families**, and that is what the compare-and-swap
finished rather than started: with each atlas's own pre-publish guard gone, the lines that still differed
between two publishers were the ones naming that guard, and the clone ratchet saw functions that had always
been one function. `kit/compiledPublish.ts` owns a compiled sync's compile-then-publish order,
`kit/frontierPublish.ts`'s `publishWalkedGeneration` a frontier walk's, `kit/walkPublish.ts`'s
`publishPageWalk` a driven two-kind page walk's (Notion, Xero), and `kit/walkSurface.ts`'s
`publishWalkedPageKind` a briefed one-kind walk's (GraphQL Hive, WorkOS). Each is every-step-a-seam, so a
platform keeps its store, schemas, file shapes, coverage cells and gap conditions; what the kit keeps is the
ORDER — read the generation ONCE so the manifest the swap compares is the one the merge folded onto, verify a
walk's artifacts against the bytes on disk before any seam grades them, and abort on the first failed merge
with nothing written. The unit witnesses are `kit/publishPageWalk.test.ts` and
`kit/publishWalkedPageKind.test.ts`.

The gap was PROVEN before it was closed, not argued: published 500 entities through the real kit,
republished the same kind with `entities: []` and `lastAttempt: null`, and `publishAtlas` returned `ok` with
the store then holding nothing. `src/__tests__/unit/atlas/kit/evidenceLossRoundTrip.test.ts` is that case,
inverted, plus the hatch-open case that proves the witness can fire.

**`reset` is the hard sync, says so, and prints its own undo.** It archives the live generation whole into
`atlas/_superseded/<platform>/<iso>/` and installs an empty one; nothing is deleted, and it works precisely
because it renames BEFORE it publishes, so the emptied rule finds nothing to compare against. Its
confirmation refusal names itself a HARD reset, and its success line carries the exact restore command.

**`restore` is what was missing, and its absence is what made one reset unrecoverable.** MEASURED:
`atlas vanta reset --confirm archive` archived a populated generation, every
sync after it failed on a 401 or a held token-mint lock, and the store's guards correctly refused all of them
— so the archive was intact and unreachable at the same time. Across the home there were **many archived
generations across many platforms and no verb that could read one**. Count it:
`find ~/.slopweaver/atlas/_superseded -maxdepth 2 -mindepth 2 -type d | wc -l`.

```bash
slopweaver atlas <platform> restore                      # list every archive, newest first
slopweaver atlas <platform> restore --archive <id> --confirm archive-current
```

It is generic over every registered platform, including the one with no reset module of its own, because a
restore is a DIRECTORY transaction and needs no platform schema — `src/atlas/kit/archiveManifest.ts` reads only the
manifest fields every atlas carries. Three refusals happen before anything moves: an archive whose manifest
cannot be read, one written at a schema version this build does not write, and one whose kind files
disagree with their own recorded digests.

The version check is two-sided on purpose. `archive.ts` compares the archive against the LIVE manifest, and
the verb first asks the platform's own reader whether this build can read the installed generation at all —
because the live manifest is only "what this build writes" if this build wrote it, and a home is written by
whichever build ran last. Described by the change rather than by versions that move: while the change
bumping `VANTA_ATLAS_SCHEMA_VERSION` from 5 to 6 was in flight, a home written by that branch carried a
schema-6 manifest under a build declaring 5, and an archive-versus-live check alone passed on 6 == 6 and would
have installed an unparseable generation. That change has landed and the numbers agree, so the mismatch is no
longer one a reader can grep for — which is why the case is stated, not pointed at.

**A NEWER generation is never told to reset.** Every platform's `supersedeRemedy` names its own
`reset --confirm archive`, and printed for a mismatch in either direction it advises an older binary to
archive about ten thousand entities it merely cannot parse yet (measured). `supersedeAdvice` in
`src/atlas/kit/supersedeAdvice.ts` branches on direction: an older generation still gets the platform's line, a
newer one is told to use a newer build — and told where one comes from, because a checkout current on its
upstream cannot act on "newer" otherwise: the writer is an unmerged branch's worktree session, and the move
is to retry after it lands (measured on the Datadog schema 1→2 change, a four-hour gap in which the
`main` scheduler filed a finding card instead of waiting) — and, if a reset already happened, to `restore`. The generation it displaces is itself archived, never
deleted, and a failed second rename puts it straight back. The one instant it cannot remove is the gap
between the two renames, where neither directory holds the live name.
