# An open page has a shelf life, and the chair is the seat that sees every one

Linked from [SKILL.md](../SKILL.md) § 2. A session writing a page sees one page; the chair holds every page the owner
has open (`open-pages.json`, [open-page-cards.md](open-page-cards.md)), and the authors come and go while the
pages stay. So the duties that run AFTER a publish land here or nowhere. How to author a page whose claims
survive is the [page](../../page/SKILL.md) skill's half.

## Publishing starts the shelf life rather than ending it

A page whose claims come from a live command decays. MEASURED: a page saying the bot still could
not reach any atlas went false twenty minutes after publish when the change that gave it atlas access landed, and its author caught it only by
re-measuring. **A footer saying "these numbers move" is an obligation to go back and look, not a caveat that
excuses not looking** — every page that named its own volatility treated it as a disclaimer.

**Record the shelf life when a page reaches you, not "re-check everything after a landing wave"**, which does
not scale and decays into checking whichever page you remember. Most pages have none: one arguing a design,
recording a decision or describing a shape does not go false when `main` moves. Only a page carrying a claim a
COMMAND can falsify does — a count, a grade, a "still broken", a "not yet true". Note which one-line command
reproduces each such claim; a landing wave then means re-running a short list.

**The unit is the CLAIM, not the page.** A page naming one reproduction command can cover one claim family
and reach none of the others: the page that went false named `atlas doctor --json`, which reproduces its
estate counts and never touches the sentence that failed (that came from `turn brief --contracts`). So "does
the page name a reproduction" scores every page clean and means almost nothing; ask **whether every claim a
command could falsify is covered by a command the page names**. Look first at what a page says about something
OTHER than its subject — a ledger count, a secrets-store absence, another module's transport — which is what
escaped on all three pages measured.

**Staleness has two halves, and the one that matters is the finding.** "Is 138 still 138" is cheap and
visible. "Did any of the nine items the page found uncovered quietly gain coverage" is the real question, and a
reported drift is itself a claim: a peer once reported twenty-one changed files where `find -newermt` counted
four, and none of them touched the finding. Triage on the verdict, never on the denominator.

## An ASK page decays on the owner's rulings faster than on any landing

MEASURED on a "waiting on the owner" page the owner called largely stale: of its five open calls, four had
been answered by the owner's own turns and the fifth by rule 10 retiring the whole shape of the ask. Not one was a
number going stale. Before re-cutting a page that asks the owner something, check each open call against the
lock-in ledger and the owner's recorded turns (`supervisor owner-turn-show`), by the page's slug and by every address
it has had.

**On a re-cut, re-resolve every carried item against the provider.** The same re-cut asserted two Slack
replies were owed; read live, the owner had already approved three of the pull requests and the fourth had merged
24 minutes after the bump that named the owner. The page had re-read its own previous body. Say in the new version
which carried claims turned out wrong rather than dropping them silently.

**Correct in place; never delete the finding.** Stamp what was true when written, name the cause, add the
corrected measurement — `briefing corrections` marks where it changed ([corrections.md](corrections.md)). A
deleted finding leaves a page that looks as though it was always fine, a quieter lie than the false sentence.

## Before a page goes to the owner

- **Holding needs the justification, not shipping.** A seat that holds by default looks careful in every case
  and is wrong in aggregate: a page the owner is waiting for that is not there leaves no artefact anyone can point at.
  Hold when the page would be WRONG — a false claim, a self-contradiction, a position the owner has moved past. Ship
  when the missing page is worse than the defect, and report the defect with a tested fix in the same message.
- **An author's description of their page is a checkable fact.** Three times a peer's message
  disagreed with their own file, and the file was right every time. Diff the new bytes against the frozen
  previous version the store holds for `<slug>` (`page read`), never against the message.
- **Re-test a limitation before you write it down.** A limit that arrived as a tool message and was filed
  rather than probed is an assumption in disguise; ask what it actually forbids and whether a slot can be
  freed before reporting a check as impossible.
- **Before blaming a peer for not telling you, grep your own transcript** for their message id. MEASURED:
  the notice of a changed file was on the chair's own disk, unread. They cannot check that as easily as you.
