---
name: private-terms
description: Keep the owner's private words hands-free — record a word the owner says or types into $SLOPWEAVER_HOME/hygiene/private-terms.tsv with the owner's meaning and where it is fine, read the edit back before it counts, and clear a write a meant word held with a fresh review in context. Use when the owner names a word, person, place or topic as private, says where one is fine, asks what is on the list, or when an outbound write printed "held before sending" with a hold id. Phrases like "make that a private word", "that name is fine in our Slack", "drop that private term", "what private words do we have", "this write is held for review".
argument-hint: "list | add --class <c> --case <c> --pattern-file <path> --meaning <words> --allowed-where <words> --source <ref> [--matches <text>] [--misses <text>] | narrow <term-id> | remove <term-id> | answer <proposal-id> --as yes|no --via console|word --by-session <who> | confirm <proposal-id> | review-prepare --hold <id> | review-record --review <id>"
---

**The owner never edits the list by hand, and an edit counts only once it is read back to the owner.** Each
row carries what the owner said the term means and where the owner said it is fine. A match on such a row HOLDS
the write for a review in context; a row with no meaning refuses outright. The mechanism and its residue are
[the hygiene gate](../../docs/security/hygiene-gate.md#private-terms-on-outbound-writes) and
[write transports](../../docs/security/write-transports.md).

**Never print a term's value**: not in a message, a card's text, a page, a commit, a pull request body or a test. A
term reaches a verb only through `--pattern-file`; the verbs print ids, classes and counts, never a pattern, a
source or a probe's text. The one place a word is drawn is the open Queue card that names its proposal by id: the
console reads it from the store on the owner's machine, through a loopback-only route, into that card alone
(`site/lib/privateTermProposalRead.ts`). It never enters the row, a reading or a log.

## Recording a word the owner gave

```bash
slopweaver private-terms add --class <class> --case insensitive --pattern-file <file> \
  --meaning "<what the owner said it is>" --allowed-where "<where the owner said it is fine, or nowhere>" \
  --source "<the anchor the owner's words sit at>" --matches "<text it must catch>" --misses "<text it must not>"
slopweaver private-terms list                      # each waiting proposal and the owner's answer to it
slopweaver private-terms confirm <proposal-id>     # only on the owner's yes
```

`add`, `narrow` and `remove` PROPOSE and write nothing. The read-back names the row by id, class and case, its
meaning and where it is fine (each withheld if it itself carries a term), and the probe counts. A probe that
comes out the other way proposes nothing: the row does not mean what it was said to.

**The owner answers on the Queue, per word, never by typing a command.** Put the proposal ids in a Queue card's
text (`pp-` and twelve hex digits, nothing else). The open card draws each word with its own Yes and No, and a
press runs `private-terms answer <proposal-id> --as yes|no`, which records the answer beside the proposal.
`list` then names each one `owner yes`, `owner no`, `owner unanswered` or `owner unreadable`. The fleet runs
`confirm` on each yes. It lands the edit at `0600` under a lock, refuses if the file moved since (propose
again), and refuses a proposal answered no or one whose answer does not read. The pattern file sits in the
scratchpad and is deleted after the proposal.

`narrow <term-id>` changes only the cells it names (`--meaning`, `--allowed-where`, `--case`, a new pattern).
A four-cell row is named `line-<n>` until the first edit gives every row an id. `list` prints every row and
every waiting proposal.

## Clearing a held write

A held write prints its hold id and one step:

```bash
slopweaver private-terms review-prepare --hold <hold-id>
```

That commits a packet (the matched meanings, each match in context, never a pattern) and prints the review
command for a fresh Codex pass and the record step. A Claude fallback receipt records no session id, so it is
refused, and a write held while Codex is capped stays held:

```bash
slopweaver private-terms review-record --review <artifact-id>
```

CLEAN stores a receipt that releases exactly those bytes once: run the original write again, unchanged. BROKEN
keeps it held; reword it, which is a new hold. A credential, a denylisted term, installation state or a
forbidden identifier never reaches a review.
