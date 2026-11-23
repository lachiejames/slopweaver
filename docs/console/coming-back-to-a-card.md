# Coming back to a card

**Come back to it** steps a Queue card aside without settling it: a card the owner cannot look at right now, such as a
policy approval sitting at the top of the Queue, should not block the cards below it, and the owner comes back to it
later.

## What one press does

`components/console/CardDefer.tsx` sits in the header of every Queue panel except an act's, which is the Alignment
page's and never on the owner's Queue. One press runs `slopweaver queue defer --kind <kind> --id <id> --by-session
work-console`, which appends one row to `$SLOPWEAVER_HOME/queue/card-deferrals.jsonl` (`src/queueDefer/`). The press
never settles the row: the panel closes and the card is drawn again, lower down.

The page reads `slopweaver queue deferred --json` on the fast lane and draws every deferred card in a last section,
**You said you'd come back to these**, below every card the owner has not deferred, oldest deferral first
(`site/lib/cardDeferrals.ts`). A triage pass walks them in the same place, last. A card stopping
the owner's work is the one exception: it keeps its place under **Blocking your priorities** or **Stopped automations** however
often it is put off, because a blocker on the owner's priorities or a stopped automation is never buried (an owner P0,
[the owner's priorities](queue-focus.md)).

On a deferred card the same control reads **Bring it back up** and writes a `restore` row. The newest press per card
wins, so a card deferred again after a restore sorts by its new press.

## Saying it on a call

On a call, moving on from a card takes it off the owner's Queue ([card landing](card-landing.md) § the Queue walk), but
saying to come back to it defers it, as a press would. The voice passes `open_card`'s `come_back_to_previous` when the owner
says it, and `talk transcript` appends one `defer` row whose `bySession` is the move's anchor
(`call:<callId>#move:<requestId>`), so a batch posted again never defers twice (`voiceDeferralRow`,
`src/queueDefer/cardDeferral.ts`). **Bring it back up** undoes it like any other deferral.

## What it does not change

- There is no deadline and no reminder.
- The card keeps its tier, so the sidebar badge and `queueCounts` are unchanged. It stays in the answered-or-not
  accounting until the owner answers it or brings it back up. A section's heading counts the cards drawn under it, so the
  card is counted under **You said you'd come back to these** rather than its tier's heading.
- The order is derived from the ledger on every read, never a rank somebody set.

## When the ledger does not read

A line that does not parse is counted, never dropped, and the page says one may be back in its own place. A ledger
that cannot be read at all leaves every card where it would be anyway and says so in one line under the list. It is
deliberately not one of the Queue's missing registers, because a deferral moves no count and a failed read of it
must never take the badge's number away.
