# Re-verifying Queue cards — the morning seat's second half

At any moment the Queue shows ranked priorities, accurate and up to date, within
reason because spend is finite. `sweep-board-daily` settles each morning what GitHub alone can answer
(`PR_ENDED`, [sweep](../../sweep/SKILL.md)). The `hygiene-sweep` seat, 15 minutes later, reads what no program can:
a card overtaken in prose, a briefing a later one replaced with no declaration, a reading a later action cleared.

**Nothing is dropped on age alone, and every drop names its evidence.** Age picks which card is read first.

## The list

Once the landing packet is worked:

```bash
slopweaver sweep recheck
```

It prints at most five asks waiting on the owner that nobody is on and nobody verified this UTC day, by priority,
then least recently verified, then oldest question (`src/sweep/recheck.ts`). It reads only local files. **A partial
board refuses**, because the card it could not read may outrank all five: say so in the ending and stop this half.

## One card

Read the whole card with `handover row --slug <slug> --json`, follow its subject through the verbs that reach it,
and end the card in exactly one of these:

| What the evidence shows                              | The act                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Later evidence answers the question or makes it moot | `handover settle <slug> --as answered --witness <permalink or anchor>`                                  |
| Another live row fully covers this exact decision    | correct the survivor if it needs to, then `handover settle <slug> --as filed --witness <survivor-slug>` |
| Still accurate, or the evidence is partial           | `handover reconfirm <slug> --still-real "<the check you just re-ran>"`                                  |
| Still live, but its text is wrong                    | `handover correct <slug> --question "…" --why "…" --still-real "…"`                                     |

Every kept card ends in `reconfirm` or `correct`: that stamps today on it, so tomorrow's five are different cards
rather than the same five forever. Every settle is followed at once by `autonomy record`, the row's slug as the
subject.

## The rails

- **A decline is the owner's alone** (`declineNeedsAnchor`). A card that merely looks unwanted is kept.
- **A witness answers the card's own question.** A citation, a shared noun or a similar slug is not supersession, and
  a peer's claim is a pointer to go and check, never the evidence. With no durable witness, keep the card.
- **Two cards are duplicates only when one decision answers both.** Overlap is not enough; keep both.
- **Re-read the row immediately before a settle** and compare the whole question: `handover settle` has no question
  precondition of its own, so a card edited since you read it would otherwise be settled on stale evidence.
- **Stop at the first verb or ledger failure** and report what was left. An unrecorded wave is worse than a short one.

End by adding to the seat's report: read, answered, filed as duplicates, corrected, reconfirmed, and left unread.
