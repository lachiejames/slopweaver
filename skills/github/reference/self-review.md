# Inline self-review — a reviewer walkthrough, not author receipts

The strict form `--self-review` takes, the word budget, and how a round is posted and the previous one
resolved. The rule — leave them on every pull request, unprompted — is in [SKILL.md](../SKILL.md).

Leave inline self-review comments on every PR, unprompted. Their job is to make a cold review easier to enter:
walk the reviewer through what the current diff is doing in plain English, beside the code that matters. Do not
use them as author receipts, repeat the diff, or move a long implementation narrative out of the description.

Each comment is at most 50 words and should usually be much shorter. Apply the operator's full voice guidance
when composing it — run `slopweaver slack voice-rules` to get it, which is where that guidance actually lives:
the advisory response shape first, then the enforced vocabulary rules the CLI refuses configured private exact
matches against. Fill one strict form:

```json
{
  "comments": [
    {
      "kind": "behaviour-change",
      "path": "src/example.ts",
      "line": 42,
      "body": "Every write path now gets the same refusal, because the caller supplies the policy once in `policy.ts`."
    },
    {
      "kind": "moved-unchanged",
      "path": "src/example.ts",
      "line": 90,
      "body": "Moved from `legacy.ts` as is; nothing in the body changed."
    }
  ]
}
```

## The kind, and the emoji it renders

`kind` is required and closed. The CLI renders its emoji as the comment's first character, so a reviewer can
scan a round by it; a body that types one of these emoji itself is refused, which keeps a doubled prefix impossible.

| `kind`             | Renders | Use it for                                                   |
| ------------------ | ------- | ------------------------------------------------------------ |
| `behaviour-change` | ⚠️      | a line whose behaviour changed — what a reviewer must check  |
| `moved-unchanged`  | ♻️      | code moved or renamed without a change, so it can be skimmed |
| `risk`             | 🚩      | a known risk, an edge case, or a check that is missing       |
| `test`             | 🧪      | what a test proves, or why a case is the one that matters    |
| `explanation`      | 💡      | why a surprising line is there, when no other kind fits      |

## What the body may not carry

The form refuses each of these, naming the comment and the fix; none has an override:

- **A file name outside backticks.** Write `` `parse.ts` ``, never parse.ts; the comment already sits on its
  file, so name another one only to point at it. A product spelled like a file (Node.js) is not a file name.
- **A GitHub blob link pinned to a commit or a line** (`/blob/<sha>/…`, `…#L12`). It goes stale on the next
  rebase; name the file in backticks instead.
- **Anything the publication scan refuses** (`src/outbound/publicationScan.ts`), the same scan a pull request
  title, description and commit message pass: first person (I, me, my, we, our, us — say who acted, "the
  owner" or "an agent", or what the change does), `"this Mac"` (write "this machine"), installation state (a
  transcript or session id, an `observed by <session>` line, a home-directory path, `~/.slopweaver`), and every
  hygiene hit, the private denylist and private terms included. Code spans, fenced blocks, quoted text and link targets are not
  prose, so a quoted owner line or a pronoun inside backticks passes; installation state and hygiene are
  judged everywhere.

Pass `--self-review <json|->` to `stack push`, `pr update`, or `push`. A `pr update` may contain
only `--self-review`. `stack push` posts the round on whichever pull request its write produced, the open one it
updated included, even when the carry or the stack registration after that write failed; the run still exits
non-zero on that failure (`walkthroughAfterReport`, `src/cli/commands/github/stackPushReport.ts`). The authenticated account must own the pull request; the foreign-description
override never applies to self-review. When a diff changes, supply the replacement form. The write posts the
fresh round first, then uses its local ledger to resolve the previous self-review round. It never guesses at a
human thread. An ambiguous result is `UNCONFIRMED` and must be inspected before retrying. A round is bound to
its pull request's node id, not its `owner/repo#number`: a round at that address bound to another pull request
(a repository renamed away left it there) or to none is SET ASIDE, none of its threads resolved, and the output
says so in one line.

**A round answers to the description review.** Its rendered comments are bound beside the title and body, so
`stack push` and `pr update` refuse a round no CLEAN review covers and print the `review-prepare` command over it.
A `pr update` posting only `--self-review` is checked over the live description: [description review](description-review.md).
No verb edits a posted comment, so a wrong one is corrected by the next round: its review reads the previous round's
threads as `supersededByThisWrite`, history rather than a refutation of the corrected comment, and any resolved
thread as history too ([thread history](description-review-history.md)).

**Omission WARNS, never refuses.** `stack push` without `--self-review` prints `⚠ opened #N with no self-review
walkthrough` and the exact `pr update` that posts one (`⚠ would open …` under `--dry-run`), and `github landing
--author @me` names every pull request of the owner's with no author-opened thread. A refusal would have the schema
invent prose or block an otherwise valid write, and GitHub state cannot tell a walkthrough from an
author-started discussion — so the warning is the mechanism, and posting the round is yours.

## Every walkthrough is resolved before the pull request lands

All self-review comments are self-resolved before merging a pull request; that is the designed behaviour,
because otherwise the pull request stays stuck open on comments that are not actually callouts. A walkthrough round
is unresolved by design and nobody is waiting on one, but GitHub's
conversation-resolution rule holds the pull request on exactly these. MEASURED: about a quarter of the owner's open
`acme/acme-admin` pull requests carried them, several apiece, and one sat four hours with two approvals and
every check green while a seat reported it as waiting on a reviewer.

So both landing doors resolve them: `github enqueue` immediately before its press, and `github merge --admin`
immediately before its merge (`src/cli/commands/github/walkthroughStep.ts`). `github landing --press` and
`bump-drive` inherit it through their child `enqueue`. Five properties are the rule:

- **BEFORE the queue entry, after every other check, at the landing's own head.** `acme/acme-admin`'s
  `staging` queue refuses the ENTRY, not only the merge: `enqueuePullRequest` once
  answered _"A conversation must be resolved before this pull request can be merged"_ with three of the owner's notes
  open. So the step runs after the verb's own findings and the pairing floor's re-read, and the only refusal
  left to come is GitHub's. A thread read at any other head resolves nothing and stops the landing.
- **Only threads the owner opened where the owner's is the last word, on the owner's own pull request.** A note
  carrying the owner's own follow-up, or a question the owner answered without resolving, is resolved like a one-voice note, since open it
  holds the queue and the admin door merges over it. A thread whose last word is a colleague's is a colleague
  waiting ([pr-state-detail.md](pr-state-detail.md)) and is never resolved; a pull request the pressing token
  did not author keeps its notes, and the verb says so.
- **A thread that will not resolve stops the landing.** Pressing into it is that same refusal again. A
  re-read after the resolves stops it too when a thread reads back open, or gained a reply: GitHub's resolve
  has no precondition, so a reply racing the first read is resolved with it. The verb REOPENS that thread
  (`github thread reopen`) before stopping.
- **The landing remembers its own resolves.** GitHub records the fleet's resolve and the owner's under the same login,
  so every thread is written to `ledgers/walkthrough-threads.jsonl` BEFORE its resolve is sent. On every run, a
  remembered thread resolved under somebody else's last word is reopened (and recorded as surfaced) and the
  landing stops; an open thread, remembered or one the owner opened, holding a colleague's unanswered reply stops it
  too, on both doors. Every such refusal, the re-read's included, prints each reply (where it sits, who wrote it, its text) and the exact
  `github thread reply … --resolve` that answers it in the landing's own home. The owner's answer is the last word both
  guards read; a bare resolve is reopened, because GitHub cannot tell it from the landing's own. After the
  landing's own reopen, the owner's resolve stands; a colleague's NEWER reply under it is reopened, because the surfaced
  row records the comment count and last reply the reopen exposed. A thread a re-read shows still open after its
  resolve is recorded `released`, so the owner's own later
  resolve is not taken for the landing's. An unparseable torn final row is skipped on read and trimmed by the
  next write, so it never wedges a landing.
- **Both doors fail closed on an unseen thread.** A thread read that fails, or carries only a first page —
  the first read or the confirming one — stops `enqueue` and `merge --admin` alike: an unseen thread may be a
  reply collapsed under a resolve, and GitHub's conversation rule reads that as settled.
  `SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS=1` is the hatch.
- **Resolved, not deleted, and ledgered.** The thread stays readable; resolving only collapses it. Each act is
  an autonomy-ledger row, `resolve-own-threads`, keyed by repository, number, head and a digest of the threads
  it resolved, so a retry after a partial round is its own row. `--dry-run` says `would first resolve N`
  without writing.

Residue, stated: a reply or reopen arriving after the re-read and before the mutation is not seen by the
verb. The queue door is covered by GitHub's own refusal; the admin door depends on the base's rules.
