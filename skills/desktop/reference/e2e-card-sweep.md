# The card sweep — `card-read`, `card-read-typed`, `card-reading-hold`, `card-next` and the fidelity judge

Part of [proving a desktop change on the real app](e2e.md); its safety rail is that page's, never repeated here.

**The card scenarios read cards of the OWNER'S console, so the keys are the owner's install's, never the repository's.** `--call-card`
takes `all` or a comma list of keys exactly as the console names them, `<kind>:<id>` (`src/talk/cardKey.ts`'s
`CARD_KEY`; an Alignment `act:` row or `align:` question too, never a `recipe:` or `candidate:`). `all` launches a
test instance first and reads every `data-card-key` its own `/queue` and `/alignment` pages draw once each fold is
open (`src/cli/commands/desktop/e2eCallCardInventory.ts`), so the cards asked about are the ones the owner would see. Each card
is asked on both surfaces, spoken (`card-read`) then typed (`card-read-typed`), in the same words
(`src/desktop/e2eCardReadPlan.ts`): the owner's ask, never assumed the same. The request names the
card by its id's words only and asks for it in the card's own terms; it never says to quote, read the briefing or name
what is unchecked, since making it do that unasked is what the console's lines (`src/talk/cardFidelityLines.ts`) are for.
The WAV says only the opening request, then a silence longer than the scenario's cap. The challenge is TYPED only once
the call file shows the card read or opened and a first answer; it names no tool and does not say to re-read. A card the owner
already ruled on is off the owner's Queue and read with `read_card` both times, by design.

**The witness passes or fails the scenario; the JUDGE never does.** The witness is the call file's ordered tool and
segment lines (`src/desktop/e2eCallCardRead.ts`). Each call is then judged for fidelity (`src/desktop/cardFidelity.ts`)
against exactly what the model was handed — the card tool's kept `answer`, never the card as it stands later: the card
read; its briefing (its board row and every file it links) read before answering; each question, problem or option
claim dropped; the question quoted; a figure no source holds; a handed word moved; the challenge re-read or answered
without one; a concession; and whether the challenged answer named what the card does not say and what was not
checked. Every failure is anchored `talk-call:<call>#<segment>`. Word-level findings are CANDIDATES; read, briefing
and re-read are exact. The judgement lands in `report.json` (`call.cardFidelity`) and as the sweep's table in
`card-fidelity.json` and `card-fidelity.html` beside it (`src/desktop/cardFidelityReport.ts`), the spoken and typed rows
compared only over the same card text. One call is read by hand with `slopweaver talk fidelity --call <id>` (its id
from `report.json`'s `call.transcriptCallIds`): each answer against the card answer its turn read, and what the voice
said against that answer, findings by kind and anchored, never a semantic pass or fail. A card leg waits up to 30 minutes for a call of the owner's to end before each scenario,
and holds its lock past the whole planned leg (`src/desktop/e2eCardInventory.ts`).

## `card-reading-hold` — the owner is still reading, so nothing moves them

```bash
slopweaver desktop e2e --call --call-card <kind>:<id> --only card-reading-hold
```

Only with `--call-card`, and only when `--only` names it: never in a whole card leg, whose sweep a third call per card
would push past its lock. The live call is asked to open the card, then hears the owner say they only just started reading it and ask to keep reading. It passes when a tracked call's file holds the card read or opened, a final
line of the owner's ENDING on "let me just keep reading", and then 45s (`READING_HOLD_WINDOW_MS`) with no unrefused `resume`, no
resume's, triage card's or next-card ask's `owed-start`, no `open_card` of another key and no `triage_next`. A move fails it as
`moved-off-card`, naming the line. A voice answer is allowed and never required. The witness reads structure only: a
different card named only in what the voice says, with no move line behind it, shows in the transcript, not here
(`src/desktop/e2eCallCardReadingHold.ts`).

## `card-next` — the owner asks for the next card, so the card they finished comes down

```bash
slopweaver desktop e2e --call --call-card <kind>:<id> --only card-next
```

Only with `--call-card` and named in `--only`, like `card-reading-hold`. The live call is asked to open the card, then,
after a 30s pause `say` renders inside the same saying, hears the owner ask for the next card.
It passes when a tracked call's file holds the card opened (only read never counts) and still up at a later final line
of the owner's words ENDING on "next card please", and then, within 25s (`CARD_NEXT_WINDOW_MS`), a `card-move` off that card or an unrefused
`open_card` whose card OPENED on another key. The pass names which path moved it: the voice's own hand-off, or the console's walk start (an
`owed-start` giving the next-card ask as its reason, between the owner's words and the move). A card still up past the window
fails it as `card-stuck`. A test instance's move never touches the owner's Queue (`src/talk/cardMove.ts`), and the witness
reads structure only (`src/desktop/e2eCallCardNext.ts`).
