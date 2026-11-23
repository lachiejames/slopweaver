# Settling a relay row says what happens to its hand card

**A row a talk relay registered over an open HAND card also says what happens to the card**: whoever settles the
answer must also say whether it is done, re-cut, or kept with the reason. The relay is found only by the row's exact `talk:<turnId>` anchor, and a turn that is there but
unreadable, or disagrees with the row, refuses the settle rather than reading as "no card". A `talk:` anchor over a
console CALL id (no turn file, and listed in `talk/call-index.txt` or a regular call file) names no relay, so it
settles as the call anchor it is and the receipt says so; an index that will not read is decided by the same row
check below, its receipt naming the index's failure. A turn file that
was never written, a turn naming no card (`about` empty), or one naming a card that is not a hand card, names no
hand card it was spoken over, so the hand
register is asked by the ROW: any open step posted `--row <slug>` refuses `ROW_CARD_OPEN` naming it (`hand done` it,
then settle), none settles with a receipt saying so (`settleRowCard.ts`); a call anchor passes the same row check. `register` refuses a call id outright,
naming `talk-call:<callId>#<segmentId>` instead (`src/talk/relayAnchorCall.ts`). A doc cut FROM a relay carries its
anchor while the turn names the relay row: `handover register --anchor talk:<turnId>` files the open relay row into
the new row itself, and the doc then settles over that anchor. A turn that owes NO card — none named, or
its card already settled, re-cut or never posted — waives the slug check, so such a cut row settles whatever became of
the relay (over a re-cut card, still with `--card recut`). The card's fate still
decides: `done` owes nothing, `kept` must be answered again:

```bash
slopweaver handover settle <slug> --as answered --witness <permalink> --card done
slopweaver handover settle <slug> --as answered --witness <permalink> --card kept --card-why "<why it stays up>"
slopweaver handover settle <slug> --as answered --witness <permalink> --card recut --card-new <new step id>
```

`done` settles the card naming this row and its witness; `kept` leaves it on the owner's queue and records why, which
`hand list` and the console card show, lifting only this relay's own landings (a transcript landing written before its row existed stays, `docs/console/card-landing.md`); `recut` is verified against the re-cut's own `settles` edge
(`hand post --supersedes`). The card is written FIRST, under the hand register's lock and fsynced (a retry that finds it already written flushes it again), then the row, re-read and
written inside the one board-row lock every row writer takes (`boardRowLock.ts`), the whole settle under a per-slug
lock; neither goes stale while its holder lives, so a retry converges: it knows its own `done` by the row it names, whatever witness either attempt carried, and one that forgot `--card` still records it. The row records `cardDisposition:` and the card in its front matter. A row
with no card, another kind of card, or a card closed some other way takes no `--card`, and one passed is
refused. `src/handover/settleCard.ts` carries the decision; `src/cli/commands/handover/settleCardRun.ts` the effect.
