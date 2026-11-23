# Which workspace's view draws a row

The console's context switcher draws each row in exactly ONE workspace, `team` or `self`, read off a stated,
checkable fact of the row: its `workspace:` line, a declared `context=`, the pull requests it names, the Slack
destinations its action sends to — never its `repo:`, which is only the checkout the seat ran in
(`boardRowPlacement`, `site/lib/registerPlacement.ts`).

**What a row states is the work's DESTINATION, never its origin.** Every card originates in the fleet, so what produced
it and which seat does the work decide nothing. A row is `team` when the work reaches a person at the organisation (a
message to a colleague, drafted or sent, a reply to their review) or happens in a company repository, even when the card
names this installation or its pull requests are this installation's own. It is `self` when the work ends in this
installation's own engineering or on the owner's own machine and accounts, a fix to this installation's code included
when a company pull request is what exposed the defect. Sending a message to a person at the organisation, or doing
things in its company repo, belongs in the organisation's context. A stated `team` over this installation's pull requests
keeps its "stated over a conflict" mark, naming the links it overrules.

**The one rule for a row none of those places, or whose facts name both workspaces: it is drawn in `self`, this
installation's own view, marked "placed by default", and never in the team's** (`DEFAULT_WORKSPACE`,
`site/lib/workspacePlacementContext.ts`). The mark is the workspace finding, and it names what the row rests on;
`handover set-workspace <slug> --workspace team|self --because "<why>"` settles it. The card's provenance glyph
reads the same placement (`queueProvenanceOf`, `site/lib/provenance.ts`), so a card and its glyph cannot disagree.

Why one view and not both: a team card drawn on the Slopweaver view and a stateless one drawn on both, where it read
as the team's, are one class of problem to fix, not two cards. A row drawn in both
contexts is claimed by both; one drawn in one, marked, is a claim the owner can correct.

Why `self` is the default and not `team`: a default places rows nobody stated, which are the fleet's own leftovers
far more often than a colleague's work, and the team's view is the one a stray row would put in front of someone
else. A producer that knows whose work a row is says so as it registers (`register --workspace`).

**The one exception** is a card stopping the owner's work, shown in both contexts on purpose
(`shownOnQueue`, [queue-focus](../../../docs/console/queue-focus.md)). On the view that is not its own, its row, its
open panel and the voice's item each say whose card it is and why it is here (`stoppingElsewhere`), so its glyph, mark
and deep link, which all name its own workspace, never read as that view's. A ranked row the board has not yet placed
is unplaced like any other, so the board's tiles fold it in `self` alone until the board reads (`AwaitingBoard`). A
hand step or act waits for the board in neither view (`placementWaits`): a wait, never a double draw. A relay over a finding states no workspace
of its own (`site/lib/relayWorkspace.ts`), so the dispatch row is placed by this same default rather than
inheriting a guess that would outlive the card's own fix.
