# Description review — a fresh reader checks the description before GitHub does

**A pull-request description reaches GitHub only over a CLEAN review of its exact bytes**, bar one carried case
([below](#an-unchanged-description-is-not-reviewed-again-over-an-immaterial-change)). `github stack push` and
`github pr update` call `requireCleanDescriptionReview` (`src/outbound/github/descriptionReviewGate.ts`) immediately
before they mutate, and refuse without a receipt for the exact title, body, inline comments, images, written rules
and change set they are about to send, and for every comment already on the pull request. There is no escape hatch: the refusal says so, and names what changed since the last
review. The check lives in those write verbs alone — no receipt is committed and hosted CI checks none, because a
committed one would change the very change set it binds.

## The publication scan comes first

`src/outbound/publicationScan.ts` is the one deterministic check over every text a pull request publishes: its
title, description, self-review comments, commit messages, and each image's proves and alt lines and captured frame
text. It refuses I/we/me/my/our/us in authored prose, installation state (session or transcript ids,
`transcript:` pointers, home paths), "this Mac" where "this machine" belongs, and the hygiene gate's own findings.
Frame text quotes a screen, so only the last two apply to it. The description write gate
(`src/cli/commands/github/prRenderGate.ts`), `github attach upload`, self-review, and the commit-message gate before
`push`, `stack push` and `stack submit` all call it. Whether an act credited to the owner has a record behind it is
judgement, so it is the review's to check, not the scan's.

## The loop

```bash
slopweaver github pr review-prepare --repo acme/widgets --base main --title "<exact title>" --body-file ./body.md \
  --comments ./comments.json --number 7 --images ./images.json --evidence ./owner-words.md
# run the `codex review` it prints; Codex capped or unregistered → the `codex review-fallback` pair it prints,
# from a SEPARATE visible Claude session
slopweaver github pr review-record --review <artifact-or-receipt-id>
```

**Run the write verb first; its refusal is the packet.** With no receipt, `stack push` (before the amend and push,
so a missing review costs no hosted CI run) and `pr update` (before the PATCH) write the exact body they would
send to `$SLOPWEAVER_HOME/pr-description-reviews/pending/`, the comments and the image list beside it, then print the one
`review-prepare` command over those files with the head, branch and checkout filled in (`src/cli/commands/github/descriptionReviewCheck.ts`).
Add `--evidence` to it and run it. A write that would change nothing sends nothing and owes no review.

## The comments are part of the description

A reviewer judging the body alone misses what the same write posts beside it, and what is already being said on
the pull request. So `--comments` is required: a JSON array of `{ path, line, body }`, the inline comments exactly as
GitHub receives them, `[]` for none. A create posts its walkthrough round; a `pr update` posts its `--self-review`
round, and a round posted with no description change answers to the same review over the live description
(`postSelfReview`, `src/cli/commands/github/selfReviewFlow.ts`). Exactly one of `--new` (a pull request not yet
opened, so none exist) or `--number <n>` names which; for an open one every conversation comment and every inline
review comment is read whole (`src/outbound/github/descriptionReviewComments.ts`) and bound, and the write verb reads
them again immediately before its mutation. A comment that arrives or is edited in between moves the digest and the
write is refused, naming "the pull request's existing comments changed".

**Residues, stated.** The read is one GraphQL page of 100 nodes per connection; a pull request past that is refused
rather than reviewed in part. A review's own summary body is not read, only its inline comments. A comment landing
between the write's re-read and its mutation is not seen. `stack push` posts its round after the create without a
second check, so a comment arriving in that gap is the same race. A receipt written before the comments were bound
(schema 1) is not decoded: it reads as no review, and the write asks for a new one.
`--images` is a JSON array of `{ file, url, sha256, proves, receiptId }`, one per image the body shows. The verb
derives it: each screenshot slot's address must match an upload receipt `github attach upload` wrote
([attachments](attachments.md)); an address none names is refused, so a picture reaches a description only through
the image check. `--evidence` files are the records an act credited to the owner rests on.

`--branch` names the head branch. When a fleet-finding row claims it (the finding gate's three exact matches),
`evidence/` opens with `01-fleet-finding.json` (`src/outbound/github/descriptionFindingEvidence.ts`): the origin, an
agent as observer, the registered day and how many records the row cites. That record is sufficient evidence that
the observing agent saw and registered the problem on `registeredOn`: for that problem it supports `by: agent` with
`on` equal to `registeredOn`, which is what an agent's seen day means on such a branch
([badges](pr-badges.md#what-each-derived-phrase-claims)). It supports no other day and nothing else the body says
about the run. It carries fixed fields only, never a string the row's author wrote, so no session id or state-home
path reaches the packet.

## What the reviewer reads

`review-prepare` commits a packet repository under `$SLOPWEAVER_HOME/pr-description-reviews/preparations/<id>/`.
Its BASE commit holds the evidence: `rules/` (the six written rule files below), `change/diff.patch` and
`change/delta.txt`, `images/` by digest, `evidence/`, and a `README.md` stating the five questions. Its HEAD commit
adds only the description: `description/title.txt`, `description/body.md`, `description/comments.json`,
`description/images.json`. The comments already on the pull request are evidence, at `evidence/pull-request-comments.json`. A review
diff carries text alone, which is why the images sit in the base.

The five questions, one property (`pr-description-review`) the review must answer exactly:

1. Does every claim match the change set and the image it cites?
2. Is any act credited to the owner without a record in `evidence/`, or is any prose written as I or we?
3. Does anything in the text or an image identify a person, an account, this machine or a secret?
4. Is anything a reader could disagree with hidden below the fold?
5. Is any ruling in `rules/` broken?

**A BROKEN answer lists every violation, never the first.** The property and the packet README both carry
`DESCRIPTION_REVIEW_EVERY_VIOLATION` (`src/outbound/github/descriptionReviewTypes.ts`): read the whole title, body
and image set against all five, then number every violation in `evidence` and `counterexample`, each with its line
or image entry and the check or ruling it breaks. The shared review prompt asks for one counterexample, which suits
a code property; a description breaks many small rules at once, and one pull request went BROKEN nine times when
each pass named only its first hit. So fix every numbered item before preparing again.

The written rules are `pull-requests.md`, `composing-a-body.md`, `pr-badges.md`, `self-review.md` and
`attachments.md` in this directory, plus `.claude/rules/area-outbound.md`, hashed as `rulesSha256`. On this source
repository they are read at the head under review, by the commit the change digest resolved, so a pull request
that edits a rule is judged against the edited text; any other repository reads the installed build's copies. A
rule absent at that head (deleted or renamed) refuses as `RULE_ABSENT_AT_HEAD`, never falling back to the installed
copy, and the packet README names which tree `rules/` came from
(`src/outbound/github/descriptionReviewRules.ts`). `pr-badges.md` is there because the badges are derived: the README tells the reviewer to read each
derived phrase by the meaning that file gives it and judge the typed field behind it. `unrecorded` is honest,
never an attribution failure, and whether more proof should have been gathered is the landing grade's question,
never a description violation.

**When `github attach upload` is closed on the preparing install** ([attachments](attachments.md#attach-upload-is-closed-until-the-owners-ruling-permits-it)),
the README adds a section saying no picture can be attached, that proof saying its picture stays local is an honest
reading, and never to ask the author for one (`ATTACH_UPLOAD_CLOSED_SECTION`,
`src/outbound/github/descriptionReviewTypes.ts`). A reviewer told by `attachments.md` alone to attach a
terminal-shot picture is how a seat uploaded one against the owner's rule. The README is not in `rulesSha256`; the
packet's base commit holds it, and a review is bound to that commit.

## What a receipt binds

`review-record` resolves the id (a Codex pass first, then a Claude fallback receipt), proves the review judged
this packet — its base and head commits, a diff that reproduces from them, the exact property — and stores ONE
receipt under the digest of the manifest: repository, base branch, title, body and both comment-set digests (the inline comments the write posts, and every comment already on the pull
request, so an update of an open pull request owes a fresh pass even when its body was cleared before it opened), every image's
`{ url, sha256, proves, receiptId }`, `rulesSha256`, and `changeDigest`.

`changeDigest` is the sha256 of the ordered tree delta between the merge base and the head
(`src/outbound/github/descriptionChangeDigest.ts`): status, both modes, both blob ids and the path of every
entry, binaries included, renames counted as a delete plus an add. A pure rebase onto a base that moved
elsewhere keeps it; a content edit, a rename, a mode-only change, a swapped binary, or a base change to a path
the branch also touches moves it. Real-git witnesses:
`src/__tests__/subprocess/outbound/github/descriptionChangeDigest.test.ts`.

## An unchanged description is not reviewed again over an immaterial change

A write with no receipt for its exact manifest may ride the NEWEST receipt over the same description: every input
but `changeDigest` byte-identical. It does only when that receipt is CLEAN and the change set it reviewed, read back
from its packet's `change/delta.txt` at the base commit and re-hashed to its `changeDigest`, differs from the
current one in nothing but content, and only in files that:

- end in `.md`;
- sit outside `skills/` and `.claude/rules/`, the trees a description is judged against;
- are named, by path or file name in any case, nowhere in the title, body, outgoing comments or proves lines.

The same paths, statuses, modes and base-side blobs are required. A receipt over the exact bytes still decides
first, a BROKEN newest receipt refuses without reaching behind it, and a stored receipt that does not read, or a
packet that is gone or does not re-hash, asks for a fresh review. The refusal names each path that forced it
(`src/outbound/github/descriptionReviewMateriality.ts`, `src/outbound/github/descriptionReviewCarry.ts`).

**The blind spot, chosen:** a claim about prose in a changed Markdown file the description never names can ride
the earlier review unread. The write prints one line naming the receipt it rode, the paths that moved and that
blind spot. Whether the reviewer holds to its own earlier CLEAN on unchanged text when a review is asked is a
separate open question.

**The residue: a force-push mid-write.** `pr update` checks the receipt against the head it just re-read, but
GitHub has no PATCH conditional on the head, so a push landing between that check and the PATCH cannot be
refused. It is SEEN: the PATCH response carries the head it landed on, and a different one prints a warning
naming both commits (`src/cli/commands/github/performWrite.ts`, `patchAndConfirm`). Review the description again.

## A fresh reviewer, and what that proves

- **Codex** is fresh by construction: it runs its own thread and writes the verdict; recording copies it.
- **A Claude fallback review is recorded by the session that took it**, so `review-record` refuses one when
  that session is the one that prepared the packet, or when either session cannot be named
  (`CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`). Residue: a session id is read from the environment and
  compared as an opaque value, so this catches a writer reviewing its own description, not a process that sets
  another session's id.

## Counting — its own lane

**One review per distinct packet.** A second `review-record`, or a second `review-prepare`, over a packet that
already has a receipt is refused, CLEAN or BROKEN; a new pass is owed only when the title, body, comments (its own or the pull request's existing ones), images,
rules or change set changes, and a change set moving only as the carried case allows owes none. The packet is its own repository, so these passes never touch the PR branch's
`codex-review-pass-cap` count or the code review floor `codex status --check` reads: the code's two Codex passes
are unaffected, and neither lane spends the other's budget.

A BROKEN receipt keeps the write shut: fix the description, prepare again, review again.
