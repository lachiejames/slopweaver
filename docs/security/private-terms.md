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
  pattern.
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
