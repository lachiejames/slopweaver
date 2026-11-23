# The gold anchor: the commit a proof was gathered on

The detail behind [pull-requests](pull-requests.md) § proof grades.

**A C3 description carries no anchor.** No grade or anchor is published anywhere in a C3 body (`AGENTS.md` rule 7),
so the form refuses a `goldAnchor` field and the authoring file a `gold-anchor:` key, each by name, and CI's body
gate compares no `proof-commit:` line with the head.

**`github push` still prints one, for the session's own record** (`src/cli/commands/github/pushGoldAnchor.ts`): the
head it just sent and, where it can be measured, the `patchId` of what the branch contributes over its base
(`git diff $(git merge-base origin/main HEAD)...HEAD | git patch-id --verbatim`). Record both beside the proof, in
the run's journal or a `gold owe` entry, so a later reader can tell whether the proof still describes the head:

- **A rebase onto a base the branch does not overlap leaves the patch id alone.** Measured: such a rebase changes
  the head SHA, the tree object AND the raw diff text, and leaves `git patch-id --verbatim` alone, so the proof
  still stands.
- **A change to the branch's own diff invalidates it**, a rebase whose conflicts were resolved by hand included.
  Re-gather the proof and re-take the screenshot; the description's proof slots are what change.

A gate change on `main` (lowering the file-size ratchet, say) is not the proof's job either: every rebase push re-runs
the CI lanes against the new base, so a ratchet `main` lowered is re-measured rather than carried.
