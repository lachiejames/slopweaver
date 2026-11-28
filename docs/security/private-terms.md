# Private terms: the owner's meaning, the hold, and the hands-free list

The child page of the [hygiene gate](./hygiene-gate.md)'s private-terms bullets. That page owns the check; this one
owns the file's two forms, what happens on a match, and how a row is edited. Per-door residue is in
[write transports](./write-transports.md).

## The file's two forms

`$SLOPWEAVER_HOME/hygiene/private-terms.tsv` opens, after `#` comments and blank lines, on one of two exact headers.

- **Seven cells**, `id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source`, is the form the
  `slopweaver private-terms` verbs write: a random `pt-` id, the owner's meaning, and where the owner said the
  term is fine (empty for nowhere).
- **Four cells**, `class<TAB>flags<TAB>pattern<TAB>source`, is the older form. Its rows carry no meaning, are
  named `line-<n>`, and the whole file moves to seven cells on the first verb edit.

## A match on a meant row HOLDS the write for a review in context

A write the check finds private terms in, and nothing else, with every matched row carrying a meaning, is held
rather than refused (`src/outbound/privateTermReview/`).

- The hold keeps the exact bytes owner-only under `$SLOPWEAVER_HOME/hygiene/private-term-reviews/`.
- `private-terms review-prepare` commits a packet of the matched meanings and each match in context, never a
  pattern. The meanings, where each is fine and the destination stay at the packet's base commit, outside the
  review diff, because that diff is copied whole into a pass's `review-packet.md` and a Claude fallback's temp
  packet; the property tells the reviewer to read them in the packet repository first. Only the matches in
  context and the sent strings ride the diff. Any packet file holding a NUL byte refuses as `FILE_NOT_TEXT`,
  naming its packet path and never its text, and every file is staged with `--force`, so a global excludes file
  cannot drop one; the repository is initialised with no template, so an init template's attributes cannot turn
  one binary.
- A Codex pass over the packet judges it. A Claude fallback receipt records no session id, so nothing could
  prove it came from a session other than the one that held the write; `review-record` refuses one, a release
  spends only a Codex receipt, and a write held while Codex is capped stays held.
- `private-terms review-record` stores the receipt. A CLEAN receipt releases exactly that write, once; a BROKEN
  one keeps it held. Its `--json` line omits the reviewer's summary, which may quote a term.
- The hold key covers the whole request the door would send, its target ids included, and the account where an
  id is per account, so a receipt for one channel, issue or calendar never releases the same words bound for
  another.
- Every line a `private-terms` verb prints, its help and usage included, is judged first against the current terms
  of every home its argv could name, a home path included, and one a term matches prints as the withheld stand-in.

What still refuses outright:

- a credential, a denylisted term, installation state or a forbidden identifier;
- a matched row with no meaning (the refusal names `private-terms narrow <id> --meaning`);
- every door that cannot hold a write: a Linear or Notion upload, and the Gmail unsubscribe POST.

## The list is hands-free

The owner never edits the file by hand.

- `private-terms add`, `narrow` and `remove` PROPOSE an edit and write nothing. Each takes a meaning, probes that
  must match and miss (`--matches`, `--misses`), and a pattern read from `--pattern-file`, so a term need never
  sit on a command line.
- The read-back names the class, meaning and probe results, never the pattern, and is read back to the owner.
- `private-terms confirm <proposal>` lands it at `0600` under a lock, refusing if the file's raw bytes moved since.
- `private-terms retire <proposal>` removes a waiting proposal WITHOUT applying it, under the same lock, and never
  writes the file: one the owner did not take, or one a later edit left stale. Confirm and retire both re-read the
  proposal under the lock, so the two cannot both succeed on one proposal.
- `private-terms list` names rows by id, never a pattern, and marks each waiting proposal `current` or `stale`
  against the one read it made: stale means a confirm would refuse it now, not forever, since the file can return
  to the exact bytes it recorded.

## The repository scan

The pre-push `hygiene` gate (`src/hygiene/repoScan.ts`) runs the same rows over every text file of the working tree.

- **Absent** (every CI runner, a fresh checkout) passes on the leak classes alone and says `not applied`; unreadable
  or malformed fails before the tree is read.
- **A match fails**, printed as path, line and class, never the matched text. A path a term matches prints as
  `(working-tree file N)`, and every report line a term matches prints as the withheld stand-in.
- **The fresh cut's forgiveness applies** (`cutExemptionOf`): the repository's own address, the code-owner row, the
  README's owner link and a documentation address, so a line the cut publishes is forgiven in the tree alike.
- **An accepted entry of the reviewed-residue list sets its line aside** by its path and exact bytes, as
  [fresh-cut residue](./fresh-cut-residue.md) binds it, owner-anchored ones included:
  what the repository held at its public cut is accepted, so only a new line fails. An unreadable list sets nothing
  aside.

## The landing sweep

The pre-push scan runs the BRANCH's own hook, so a branch cut before that scan learned the terms pushes unscanned,
and CI holds no terms file. `github merge --admin` (`github lap --land` lands through it) therefore runs the rows
itself, in the build running the verb (`src/outbound/github/privateTermsSweep.ts`): over every file the merge of the
pinned head into the base it just fetched would add or change, as the merged tree's exact bytes, before any GitHub
request and on `--dry-run` too.

- **A match, or a terms file that will not read, is a hold.** Path, line and class only, a path a term matches as
  `(changed file N)`; `--acknowledge` and `--acknowledge-all` do not reach it. Reword, push, land again.
- **Absent, or a change set that cannot be read whole** (no fetched base, a merge that does not apply, a submodule
  entry) is `private-terms-unchecked`, landed only by naming it with `--acknowledge` and a `--reason`, which the door
  ledger records. `--acknowledge-all` never reaches it: that flag waives findings a caller has read, and this one
  says no read happened. A reason a loaded term matches waives nothing, since the ledger keeps it verbatim.
- **The reviewed-residue list sets a line aside** exactly as in the repository scan.
- **The residue, stated:** the base can still move between the sweep and GitHub's merge, which pins the head and
  never the base; and local git is not GitHub's merge implementation, so a custom merge driver could make the two
  trees differ.

`github enqueue` runs the same sweep as a **prospective-tree preflight** (`src/cli/commands/github/enqueuePrivateTerms.ts`):
the pinned head merged into the landing branch as just fetched, once the queue verdict would press, on `--dry-run`
too, and never for `--dequeue` or a pull request already queued. Same hold, same own-name-only waiver. Every arm that
fetched no landing base is unchecked, never clean: a fork head, no checkout of the repository, no local branch, a
failed fetch, and a fetched branch that is not the landing branch (the fetch follows the remote's default). The
queue adds a residue on top of merge's: the merge group GitHub builds later carries every entry ahead of this one
and a base that moved since the fetch, and that tree is never swept.
