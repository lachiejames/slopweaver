# Remote refs — `github tag create` and `github branch delete`

The two verbs that write a ref on GitHub without a clone push and without a click in the UI. Both are door-routed
external writes, both read the remote before and inside the door, and both confirm by reading back. Run each with
`--dry-run` first; the dry run makes every read the real run makes and writes nothing.

```bash
slopweaver github tag create --repo <owner/name> --tag <name> --sha <40-hex> [--message <text>] [--dry-run] [--json]
slopweaver github branch delete --repo <owner/name> --branch <name> [--keep-as-tag <name>] (--dry-run | --expect-tip <sha>) [--json]
```

## `tag create`

- `--sha` is a full 40-character commit sha. An abbreviation is refused, because the tag is a permanent address.
- `--message` makes an annotated tag (an annotation object, then the ref). Without it the tag is lightweight.
- **It writes a ref and pushes no objects.** A commit the remote does not hold is refused by name. A tag that exists
  only in your clone is published by naming the commit it points at, and the remote tag is a RECREATION of it: its
  annotation carries the message you give, not the local tag object's bytes.
- It is an idempotent ENSURE: the dry run describes the end state, tag at that commit. A tag already there is
  `already there:` and writes nothing; one that vanished between the dry run and the real run is made again at the
  same commit, which is the state the dry run described.
- A tag at a different commit is refused. A tag is never moved.
- If the annotation object is created but the ref write then fails, the error names the orphaned object's sha. The
  object is harmless and unreachable. Every outcome of an annotated create that
  wrote an annotation object names it, `created` included, so a ref another writer swaps afterwards cannot hide it.
- A failed write is read back before it is reported. A tag found at the commit reports `there now:`, never
  `created`: an errored write cannot say whether this run or another writer made it. The write's own error is still
  printed as a diagnostic, so an orphaned annotation object is named even when the tag is there. Every read-back reads the repository after the tag, since GitHub
  answers 404 for a tag the caller can no longer see.

## `branch delete`

**A real delete is bound to its dry run.** The dry run prints the tip, and the real run must pass it back as
`--expect-tip <sha>`. A branch that moved in between is refused ("dry-run again"), so the commit deleted is the one
that was read and shown. A keep-tag is the one thing allowed to differ between the two runs: if it vanished in
between, the real run makes it again at the same tip, which is the state the dry run described.

Refused before any write when:

- the branch is the repository's default branch;
- the branch does not exist ("nothing to delete");
- any OPEN pull request names it as base or head (deleting a base closes every PR stacked on it). This is read
  before the write, not part of it: a PR opened in the moment between that read and the write does not stop it;
- `--keep-as-tag` names a tag that already points somewhere other than the live tip.

`--keep-as-tag <t>` keeps the deleted work addressable. Choose a name that is free, or one already at that tip. A tag
you made earlier at an OLDER commit is refused, not moved.

**The write is one atomic compare-and-swap.** Inside the door the verb re-reads the whole plan, then sends ONE GraphQL
`updateRefs` call: create the keep-tag at the tip only if it is still absent, or, when it already exists there, hold it
with a no-op update naming its current ref oid; and delete the branch only if it is still at the tip. GitHub applies
it whole or not at all. So a push, or a keep-tag removed or moved, after the last read makes GitHub reject the update
and nothing changes: with `--keep-as-tag`, the branch is never deleted without its recovery tag at the tip in that
same write (the flag is optional, and nothing keeps the tag from a LATER delete), and no tag is left behind a refusal. REST's `git.deleteRef` is deliberately not
used: it takes no expected sha. After the write, the verb reads back that the branch is gone and the tag is at the tip. A write that
ERRORS is read back too before anything is reported: a branch found gone with the keep-tag at the tip reports
`gone:`, not `deleted`, because an errored write cannot say whose write removed it. That read-back reads the
repository after the refs, since GitHub answers 404 for a branch the caller can no longer see; any other failure says what each
ref reads now. One case is accepted, not fixed: access lost and RESTORED between the ref reads and the repository read
reads as absent, so an errored write can report `gone:` for a branch still there. No read proves access held for a
read before it, and the harm is a false success on a branch that still exists; a second `--dry-run` shows it.

**A read-back is a sequence of reads, not a snapshot.** It reads each ref once, in turn. Another writer changing
the same refs DURING the read-back can make it report a state that never held at one instant, such as `gone:` for a
branch recreated between the branch read and the tag read. This is accepted, not fixed: the WRITE is the atomic
part, and REST offers no multi-ref read at one instant. Nothing here writes on the strength of a read-back.

**Each write is sent once by the verb, and safe if the wire sends it twice.** Native fetch replays a request answered
HTTP 421 below every retry setting. A replayed tag create meets the tag it just made, a replayed `updateRefs` meets a
branch already gone, and both are refused by GitHub, then settled by the read-back; a replayed annotation write leaves
one unreachable object at most. The one case a replay can still act on is accepted, not fixed: a branch another
writer RECREATES at the same tip between the two deliveries is deleted again. That removes only a ref pointing at the
commit already approved for deletion, the keep-tag still holds it, and `updateRefs` offers no per-request token to
refuse it with.
