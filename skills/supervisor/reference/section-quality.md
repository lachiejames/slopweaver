# Every section of the briefing reads the way a gated card does

The card-quality gate's writing is much easier to read, so the whole briefing is aligned with it.

The four rules of card framing ([card-framing](card-framing.md)) are written for a react-now card. Three of them
run over every other section the page emits too, and one LENGTH holds the lede. `src/briefing/sectionQuality.ts` is the
rule, `src/outbound/briefing/sectionQuality.ts` projects the form into it and
`src/briefing/sectionQualityHtml.ts` projects the rendered page — both doors, one rule.

## What applies to every section, and what does not

**A fleet word is refused wherever the fleet composed it.** Same registry, same gloss test: say what the word
means in the same breath, or write the line without it. The refusal names the word and the plain phrase that
replaces it.

**The lede is held to a card `what`'s caps** — 60 words, 4 sentences.

**A ranked open page's `ask` is held to a card question's framing** — no asking permission for what doctrine
already settles, no asking the owner to choose between implementations — and each line prints the page's AGE
beside its landing stamp ([one-index](one-index.md)).

**Option pickability does NOT apply.** A pointer band exists to send the owner to a page, which is the exact shape
that rule refuses in an option.

**No length cap applies inside a fold.** A fold is a fold: blocks are still
counted, prose is left alone. The card-framing rules are about framing and vocabulary; the fold rule is about
length, and the two do not collide.

**THE OWNER'S OWN LIST is skipped entirely, every field.** The session-start verb supplied those words, not the
fleet, and refusing a projection means rewriting what the owner actually said.

**A QUOTED note's FOLD is skipped for the same reason, and only the fold.** A note carrying `lane: "quoted"`
holds recorded text nobody here composed — one of the owner's own turns, or another verb's own line — so the
plain-wording rule has no composer to instruct and the only way to clear it would be to edit the record.
Measured: rendering the live tick ledger produced thirteen refusals, every one a fleet word
inside a string some other verb or work item had already written. Its HEADLINE and its fold's own SUMMARY are
composed by the projection and stay judged, so what the owner meets before opening anything is still held to the card-framing rules.
The renderer marks the fold `data-section="quoted"` so the page reader and the form reader agree about which
folds those are. See [derived-narrative.md](derived-narrative.md).

**`awaiting` is untouched**, because it renders nothing.

## The gloss scope is one DISCLOSURE LEVEL

A section's own visible prose is one level; each fold inside it is another. A gloss counts from that level or
from any level enclosing it — never from a sibling fold, a descendant fold the owner has not opened, or another
section. That is the card rule's own principle — a term explained only inside a `details` body is a term the owner
meets unexplained — pointed downwards rather than abandoned.

Cells within one level are joined by `·` before the vocabulary read, so two adjacent notes can never
combine into a fleet phrase or a definition neither of them wrote.

## The page's own furniture is held to the same rule

The eyebrow is the one line nobody can fold away, so it carries no fleet word either. `src/__tests__/unit/outbound/briefing/rendererVoice.test.ts` reads the whole rendered page, so a line
added to the renderer later is covered without anyone remembering.

## The measurement

```
yarn tsx src/measurement/briefingSectionQuality.entry.ts \
  --forms '~/.slopweaver/supervisor-scratch/handoff-*/form.json'
```

Over the 156 forms this install had rendered, per cell:

| cell                   |    n | median words | max | over 60w     | unglossed fleet word   |
| ---------------------- | ---: | -----------: | --: | ------------ | ---------------------- |
| card `what` (gated)    |  726 |           52 |  60 | 0            | 42, every one pre-gate |
| header lede            |  156 |           64 | 155 | 79 (51%)     | 50 (32%)               |
| recent note headline   |  627 |           93 | 157 | 589 (94%)    | 292 (47%)              |
| earlier-today headline | 2867 |           95 | 162 | 2857 (99.7%) | 1844 (64%)             |
| history note headline  | 2432 |           12 |  29 | 0            | 0                      |
| alignment headline     |  156 |           38 |  50 | 0            | 0                      |

The gated cell is the control: `what` is capped at 60 and its measured maximum is 60, while the two cells
with no cap ran to 157 and 162.

Run the shipped projection over the same forms and count the disclosure LEVELS it refuses: `recent` 601 of
735 (82%), `earlier today` 2,771 of 4,488 (62%), `history` 294 of 882 (33%), the lede 50 of 147 (34%) and the
alignment line 31 of 441 (7%). That cost is real and it is stated rather than buried — what makes it payable
is that each refusal names ONE word, so the fix is a substitution rather than a re-composition.

## The break-glass

`SLOPWEAVER_ALLOW_CARD_FRAMING=1` lifts every vocabulary, ask-framing and pointer finding for
`slopweaver briefing check` alone, so an archive still reads. `briefing render` never honours it. A LENGTH —
the lede's cap included — is never lifted by it, exactly as every other cap on this page is not.
