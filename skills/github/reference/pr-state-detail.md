# `github review-state --detail`: the granular state, and why nothing refuses on it

Bundled reference for the `github` skill. Loaded when a reader has to judge whether a pull request is worth
another person's time — never on every turn. The table and the Slack legs are in
[review-state.md](review-state.md).

## Why this exists

A review ask once went out as the owner on a pull request carrying seven unresolved threads. A schema refusal on
the ask is the wrong answer: a pull request may be a discussion piece where failed checks are expected, or the
point of the ask may be "why is something red here, can someone help", and a heavy-handed verdict rule causes more
problems than it solves. A bare `verdict = pass` is not enough information either, so this flag prints the
granular state.

**Never add a gate that refuses a review ask on any of the answers below.** The verb informs; the judgement
is the reader's. That is the rule, not a default. It governs what is READ before an ask, never whether one may be SENT: an ask the owner did not request is parked for the owner's yes (`slack draft record`, rule 10).

`--detail` prints, per pull request, in this order:

- **CodeRabbit approved, yes or no**, with the verdict word when it is no.
- **Unresolved comments, yes or no — from whom, and what they say.** Every open thread carries its path and
  line, who raised it, its opening line verbatim, and the reply line when somebody answered.
- **Whether we answered without resolving, or pushed back.** Reported as a DISPOSITION, never a sentiment
  read: `AWAITING US` (nobody answered), `we answered, still open`, `REVIEWER REPLIED, still open`, and
  `our own walkthrough note`. Answering and pushing back are the same STATE and differ only in the words, so
  the words are printed and the reader decides which it was — a classifier here is a heuristic this verb refuses.
- **Which check is failing, and whether it is REQUIRED.** Each non-passing check is marked `REQUIRED`,
  `advisory` or `required unknown` against what the base branch's protection and rulesets actually require
  (the same union `github enqueue` uses). `required unknown` is its own third answer on purpose: an unread
  protection must never print the same word as a base that genuinely requires nothing.

**A thread the pull request's OWN author opened is `our own walkthrough note` and never counts as a reviewer
waiting.** MEASURED across the owner's open pull requests on one repository: about one in five carry open threads
whose only author is the owner — the `--self-review` reviewer-wayfinding comments, unresolved by design. Counting
them makes the field wrong on one row in five, which is the rate at which a reader stops reading it.

**"The owner's own" is the thread the owner opened AND is still the only voice on.** A colleague who replies to a
walkthrough note is a colleague waiting, and the opener alone cannot tell you that. MEASURED over the
own-walkthrough threads on the owner's open pull requests on one repository: nearly all carried one comment
and a couple carried a reply. On one of the two a colleague had spoken last on a thread the owner opened, and reading it by its
opener made the colleague invisible to `waitingOn`, to `threads-clear` and to every judgement signal at once, while
the row printed `openThreads: []`. So the disposition is
`REVIEWER REPLIED, still open` whoever opened the thread, and `our own walkthrough note` is the single-comment
case only. The one-voice threads are the ones the fleet RESOLVES for itself, immediately before the press —
[self-review.md](self-review.md).

**Comment bodies are read only under `--detail`.** They are the expensive half by an order of magnitude — one
CodeRabbit opening comment runs to several kilobytes of collapsed script output, and a hundred of those across
twenty pull requests is a payload the fleet read does not survive. Without the flag the block would print
empty quotes, so it says so instead. `--number` reads through `repository.pullRequest` with the IDENTICAL node
selection the fleet pages, so a reader who names one pull request sees exactly what its table row was
computed from.

**A `--number` read never says the pull request has CLOSED.** The single-PR query selects no `state`, so on
a MERGED pull request it prints a plausible open row with a recommendation. MEASURED: a `--number` read
answered `undrafted=True ci=green rabbit=stale thr=1 rec=already-asked` a day after the pull request merged, and a
page nearly told the owner a colleague was blocked on the owner's review; the same check cleared three more asks
the owner had already approved. A number arriving from anywhere but a live open-PR search — a Slack mention, a handover doc,
an earlier page — is resolved with `github read <url>` (`"state": "MERGED"`) first. The whole-repo reads are
safe by construction: they enumerate open pull requests.

**`changes requested by:` sits under the CodeRabbit line on every block**, `none` included: CodeRabbit when its
verdict is changes-requested, then each human whose latest opinion still asks for changes, with the day it
landed, so the verbs say what does have changes requested. A CodeRabbit excerpt
joins its marker-only severity row to the bold finding title after it, and the CodeRabbit sentence names an
OUTDATED unresolved thread holding the verdict, or a flip still to land — [coderabbit.md](coderabbit.md).
