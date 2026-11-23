# A page's own claims: totals, counts, citations and shelf life

A page that reports state is held to the standard the work holds the system to: **state asserted rather than
derived goes stale silently.** Every rule here applies that to the page itself.

## A total is an invariant, not a string

When a page says its figures are one consistent snapshot, that claim is machine-checked or it is not made. A
grep for superseded values cannot see a stale SUM. Measured once: twelve figures re-measured in one pass,
all twelve old literals grepped and gone — and a ten-cell disposition table still summed to the old 1,317 under
a sentence reading "every figure on this page is one consistent snapshot". Two earlier holds on the same page
were also arithmetic a reader would do and find broken.

- **Re-measure every figure in ONE pass and name the instant on the page.** A page whose standard is that its
  numbers reproduce cannot be assembled from more than one instant.
- **Parse every numeric cell and assert the total against the headline** before publishing.
- **Reconcile populations that appear together, exactly.** Where they differ, state why (`190 tracked, five of
which no longer exist on disk, leaving 1,395`) rather than warning the reader off the subtraction.
- **One column, one unit.** A `0.59` GiB reading in an otherwise decimal-GB column made every figure true of
  something and none wrong alone; only the column failing to sum surfaced it — the argument for summing
  mechanically rather than checking harder.

## Assert what the check COVERS, not what it returned

**A claim reads as verified because a machine printed something next to it.** One script ran two regexes over
a table: one matched ten numeric cells for the sum, the other nine rows for the ordering, because the catch-all
row held `&mdash;` where a word was expected. The `True` from the nine-row check was reported as covering ten.
Count the rows a check matched and compare that to the population the sentence claims. Beware a
strict-descending assertion over a table whose last row is an "everything else" remainder.

**Name the ref a claim measured, in the claim.** `git log` in a worktree answers "what is my branch head",
never "what does origin know", and returns a good commit either way. "My checkout is behind" and "I cannot
verify from here" differ by one unstated assumption; writing the ref into the sentence makes it visible. A
green check measuring the wrong thing is worse than a red one, because red gets investigated.

## Never write a number that counts something else on the page

A number counting a list is a second copy of that list's length, correct only by coincidence of maintenance.
"The four answers, first" over a strip grown to five cards; "the five things that need a word" in a standfirst
over six decisions — four pages in one day. The heading is where it keeps surfacing, not the class: the class
is duplicated state, in any position. **Drop the number** — "the things that need a word" cannot go stale when
a seventh arrives. Writing this rule onto one page and breaking it in the first sentence of the next is the
evidence that it is not fixed by remembering.

**Re-read every header against what its cells hold**, not against what the column is for. "Keyword index" over
a column that also held B-tree indexes had a correct total and a quietly false label.

## A citation is an assertion: dereference it

Two sessions cited one pattern in an archived repository as ADR-003 and ADR-0004, corrected each other, and
were both wrong: the repository had no ADR documents at all, and all 22 ADR references in it dangled. Cite by
something that resolves — a file and line, the implementing module — and check it resolves:
`find . -ipath '*adr*'` and `grep -rhoE "ADR-[0-9]+" | sort | uniq -c` settled that one.

## A page whose claims come from a command has a shelf life

Publishing starts it rather than ending it. A page reporting 12 of 31 atlases answering nothing was true when
published and told the owner something false within the hour, because a peer's pull request fixed the defect it
named as open. **A footer saying "these numbers move" is an obligation to look again, not a caveat that excuses
not looking.** Most pages have none — one arguing a design or recording a decision does not go false when
`main` moves. Only a claim a COMMAND can falsify does: a count, a grade, a "still broken", a "not yet true".

So the author does three things at publish time:

- **Cite the command, not the value, wherever a reader can run it.** A named command _demonstrates_ the point
  where a pasted value only asserts it — `identity resolve "<name>"` printing "no colleague in the member set"
  IS the section's finding happening in front of the reader. It also has to render at 320
  ([narrow-width.md](narrow-width.md)). The same rule binds a code comment (`.claude/rules/typescript-patterns.md`)
  and a handover doc (`src/handover/check.ts` refuses a doc that "states a count").
- **The unit is the CLAIM, not the page.** One page named `atlas doctor --json`, which reproduced its estate
  counts and never touched the sentence that went false — that came from `turn brief --contracts`. A second
  page named one command against six falsifiable claims and reached one. Ask whether every claim a command
  could falsify is covered by a command the page names; where one is not, the page carries the second command
  or stops making the claim in a form that decays.
- **Check the OFF-SUBJECT claims first.** On three pages measured, the page's own subject-command covered its
  subject claims; what escaped was a sentence about a neighbouring system — a ledger count, a secrets-store
  absence, another module's transport — reached for from memory rather than from the command in hand.

## Re-cutting a page

- **Re-resolve every carried item against the provider**, never against the page's previous body. A re-cut
  asserted two Slack replies were owed; read live, the owner had approved the pull requests and one had merged, so the
  true count was zero. Say in the new version which carried claims turned out wrong.
- **A page that asks the owner something also decays on the owner's own rulings.** Of one ask page's five open
  calls, four had been answered by the owner's own turns and the fifth retired by rule 10 — none a number going stale. Before
  re-cutting, read the lock-in ledger for the page's identity (`page:<slug>`, see
  [local-addresses.md](local-addresses.md)) and drop what the owner has already answered.
- **Triage a reported drift on the VERDICT, not the count.** A drift report is itself a claim: one said
  twenty-one files had changed since a page's watermark; `find <dir> -newermt '<watermark>'` found four. What
  mattered was whether any changed file now covered one of the nine gaps the page reported — grep for their
  subjects, zero hits — never whether the denominator moved.
- **Correct in place; never delete the finding.** Stamp what was true when written, name the cause, add the
  corrected measurement, and republish so `briefing corrections` marks where it changed. A deleted finding
  leaves a page that looks as though it was always fine, which is a quieter lie than the false sentence.
