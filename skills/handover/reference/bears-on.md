# Why the card is in front of the owner — `--bears-on`

**The owner's lean** (option C of `queue-card-head-options`): an ask card quoting a long run of the owner's
words pushed its own question off the screen, and nothing said why the quote was there. **The owner's word**:
the quote first, then every further steer of the owner's in time order, then why the card is in front of the owner.

```bash
slopweaver handover register <slug> --anchor transcript:<session>#<uuid> \
  --bears-on "you said you cannot see the evidence in the drafts, so this asks whether the mirror should carry the files" \
  ...
```

`--bears-on` says, in one line, how the words at the row's `--anchor` bear on the question. The card's source block
reads top to bottom: the owner's quote, folded shut when it runs long with its summary saying about how many
characters; then the owner's further steers on it, shut under one summary ("2 more times you steered this, oldest
first"); then this line under _why this is in front of you_.

**Further steers** are more anchors of the owner's words related to the same row, each quoted off its record by the
same resolver as the row's own: `handover quote <slug> --add-steer <anchor> --apply` relates one, a console call
landing on an ask's card relates the words it lands, and `handover quote --apply` refreshes them all. They are stored
as numbered groups (`ownerWordsSteer<n>Anchor` and the rest, `src/handover/hisWordsSteers.ts`), so a broken one is that
one steer's defect, which the card says rather than dropping.

- **One sentence**, capped like every other field of the [ask shape](ask-shape.md); a second sentence is refused
  naming the count.
- **Refused on a row that quotes none of the owner's words** — an anchor that is not `talk:`, `call:`, `talk-call:`
  or `transcript:` — since there is nothing for it to bear on.
- **Withheld from the board while a run parked on the owner asks its own question** off the journal: the line was
  written for the question the row was registered with, and would otherwise sit beside one it never saw.
- **The session writes it, never the owner's word.** It is drawn as plain text, never matched for names, so no
  identity chip can land inside it.

Code: `bearsOnFor` in `src/cli/commands/handover/askRowBearsOn.ts`; the card's copy in `site/lib/sourceBlock.ts`.
