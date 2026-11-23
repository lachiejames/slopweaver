# A question asked after its row was settled

A child of [reading the board](reading-the-board.md). A settled ask row is in DONE or CLOSED, reconcile skips it and
`ownerWait` calls its run's question `settled`, so a question recorded on it AFTER the settlement is on no surface
either.

## The refusal

`handover ask` refuses a settled ask row before anything is journalled, routing a new question to a new row
(`src/handover/settledAsk.ts`). It asks at the top of the verb, and again of the row re-read just before the append
(`src/cli/commands/handover/appendUnlessRefused.ts`), and when that fresh row is an ask, once more under the row's lock
held through the append, the lock `handover settle` writes `settlement:` under. So a settle landing mid-ask is refused
too, on the ordinary ask and on the reshape of an unshaped held question alike. Any other kind takes no lock, since no
settle can land on it.

## The board-wide check

One a journal already holds — written by a checkout predating that refusal — is published under `settledThenAsked` on
`handover list --json`, never narrowed by `--tag`, and printed under the board as
`ASKED AFTER ITS ROW WAS SETTLED, ON NO SURFACE` with two routes: `handover withdraw` when it is moot, else withdraw and
register it on a new row.

The test is the question's ORIGINAL ask instant strictly after `settledIso:`; a question asked before the settlement is
the one that settlement answered. A row with no `settledIso:`, an instant that does not parse, or a question asked in
the settlement's own millisecond cannot be ordered, and `settle` journals nothing to order it by, so it is named with
`order: "unordered"` rather than dropped: its question may be one the settlement answered, and `withdraw` clears that.

The check reads the archived settled rows the journal sweep recovers too, which the board itself leaves out
(`recoveredRows`, `src/cli/commands/handover/listRecovery.ts`).
