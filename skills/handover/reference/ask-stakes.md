# The stakes a recorded ask carries

**Risk, blast radius and trade-off are what the owner wants to know at a glance when reacting to something.** The
trade-off and the lean come with the options. The other three are `--risk`,
`--blast-radius` and `--still-real`. They are required on `ask`, `offer` and `register`, and they are
refused as a set: half the stakes is a partial shape, the same failure of FACT as half the options.

**The still-real check is text, and it is dated by the VERB.** A session writes how it confirmed the problem
still stands. No flag takes the date: a journal row is dated by the `question` or `question-offered` event's
own instant, and a registered row by the `stillRealIso` that `register` stamps from its own clock. The card
leads the row with that instant's age ("confirmed 3h ago"), because an ask confirmed an hour ago and one
confirmed a week ago are different decisions. An offer replaces the stakes along with the rest of the shape.
If the offer states no stakes, the held ones are dropped rather than carried beside a draft they never
described.

**A refresh pass re-confirms, it never re-asks.** `handover reconfirm <slug> --still-real "<the check you just
re-ran>"` journals a `question-reconfirmed` event bound to the open question. That instant, and that line,
become the row's `stillRealIso` and `stillReal`, even on a row recorded before stakes existed. The question's
text, its shape and its asked instant stay as they were, and nothing is posted. It needs no claim on the
run, like `handover rule`, because it moves no phase. A later offer replaces it, a correction keeps it, and a
new question never inherits it. Everything on the local console stays up to date, to minimise stale items the owner reads through. Before this verb, every ask a pass
had re-verified still read "never re-confirmed".

**A correction restates the check with the text.** `handover correct` keeps the shape, so the still-real line
would survive it word for word — once a question was corrected to name one draft and the card went on saying a
different one was held. So while the card prints a check, `correct`
REQUIRES `--still-real` (the same line if it still holds), refuses without it quoting the line it would leave,
and journals it as a `question-reconfirmed` bound to the corrected text, right after the correction.

**A check that stops being true is WITHDRAWN, never answered.** When the fact an ask waited on resolves
without the owner, the run's holder records `handover withdraw <slug> --why "<the check that shows it resolved>"`.
It journals a `question-withdrawn` event bound to the open question: the run is open again, the Queue card is
gone, and no `answered` line is written, so nothing reading answers as the owner's words (`src/handover/ruling.ts`,
`src/handover/rulingAudit.ts`) ever sees one. Unlike `reconfirm` it needs the claim, because it takes a card
off the owner's Queue. Measured: an Nx Cloud 401 ask went moot
when CI went green, and with no retraction verb the holder wrote `handover answer --answer "Premise dissolved,
not a ruling"`, an answer in the owner's name to a question the owner never saw.

**A registered ask no run has opened takes all three in its own file.** Its card reads the row's front matter,
not a journal, so `reconfirm`, `correct` and `withdraw` write there, need no claim (no run holds it) and open no
journal; a withdrawal is `status: cancelled` with its reason, never a settlement in the owner's name
([registered-ask-queue.md](registered-ask-queue.md)).

**A row recorded before stakes existed reads "not stated"**, greyed, in one row naming the flags to re-ask it
with. So does every non-ask card (hand, autonomy, landing, draft), and it says why: only a recorded ask states
stakes. The console composes none of them, because that would be a model writing in the owner's voice (`AGENTS.md`
rule 2).

The shape these sit beside, and the rest of its rules: [ask-shape.md](ask-shape.md).
