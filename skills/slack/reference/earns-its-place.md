# Every word in a parked draft earns its place

The owner strips figures, filler, alert detail and open questions off a parked draft, and will do so on future
cards too. The target is the shape of a cut the owner kept: three paragraphs, about seventy words, one figure, one
question, and the rest on an annotated chart.

So `slack draft record --as me` REFUSES a draft past that shape and parks nothing
(`src/outbound/slack/draftEarnsItsPlace.ts`). It never runs at release, so bytes the owner approved never stall, and never on
`--as bot`, whose card fields carry their own gates. `slack voice-rules` prints the caps before a word is drafted.

The talk console's running list holds a Slack message as the owner to the same shape: an `offer_copy` with `destination:
"slack"` runs `slack voice-rules --check-stdin --slack-draft`, and a refusal names each broken rule by its counts,
never a word of the draft, so the voice re-cuts and offers again. The tray adds one rule this shape does not have:
no authored paragraph past 70 words, since every cap here is on the whole message and one dense block passed them all
(a dense block needs more vertical white space; `src/outbound/voice/copyVerdict.ts`). A
parked draft is not held to it. A review comment, a script or talking points
(`destination: "other"`) keep the exact rules alone. The tray has no hatch: the owner edits a draft the owner pasted personally.

## What it counts

Every paragraph a reader sees: a `one-card`'s `lines`, a `one-list`'s `lead` and `trailing`, a drip's one message. A
`one-list`'s `bullets` are exempt from every rule, because a roster's list is its substance.

| Rule         | Cap                  | What counts                                                                                     |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `paragraphs` | 3                    | each counted paragraph                                                                          |
| `words`      | 100, the owner's own | text runs, code included, a link's label, one per mention                                       |
| `figures`    | 1                    | distinct numbers in authored prose: `$12k`, `38%`, `1,200`, `500ms`, `4.2k`, `111`              |
| `questions`  | 1                    | every `?` in authored prose                                                                     |
| `filler`     | none                 | a freeform close ("keen to hear what you reckon") or an attachment announced ("chart attached") |
| `trailing`   | none                 | a sentence after the ask in the paragraph that asks                                             |

An ask is a question that addresses the reader: a `?` sentence carrying "you" or "your", or a mention, group or
broadcast. A draft that ran one sentence past "Are you already chasing any of these up?" had already ended
where it should: the owner decides where a message ends. The rule binds the paragraph that asks and no other, so
context in a later paragraph stands. "no rush" and an emoji may follow the ask; a link or code may not, and neither makes one. A
question posed as the check to run ("would they have pinged when needed?") is not an ask, which is why a cut with that
shape passes with a sentence after it.

Dates, years, clock times, versions, `p95`, `INC-33`, `#<n>`, `PR <n>`, `4xx` and a long id are not figures
(`src/outbound/slack/draftFigures.ts`). One it misreads, `LB 503` say, goes in a code run, which no prose rule
reads. "no rush" is not filler: it is the close the owner asked for on a one-person ask, and neither is a reference that goes on to say something
("the graph above shows when it started"): only an announcement that ends its clause is.

## How the draft reads

State the expectation up front, and if it is only an FYI, say so. Open on the one-sentence finding and its number,
then the picture, then ONE clear, specific question to the person tagged, whose answer is obvious to them. Every
other number is drawn on the attached image (`--media`), never listed in prose; a ticket is one plain sentence with
its link. The gate does not require a question or fix where it sits: a reply or an FYI needs none.

## The hatch

`slopweaver hatch open earns-its-place --reason "<why>"`, then re-run the record: journalled, thirty minutes. Its
legitimate exceptions are the owner's own dictated words, numbers the person asked for, and two people each owning a
different open question in one thread the owner wants chased together. A draft parked under it carries an advisory
line naming what it broke, so the owner's card says it went past.
