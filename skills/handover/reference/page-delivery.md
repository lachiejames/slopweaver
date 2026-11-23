# Page delivery — a published page is not a delivered one

A run whose deliverable is a page cannot close until that page reached the owner's Queue. Measured: nine briefings the
owner asked for were settled `answered` with `page:<slug>` as the witness and no question ever
asked, so no card was drawn and the owner never saw them (`src/handover/pageDelivery.ts`).

## What is checked

`page publish`, run by a session holding a run, records the page as that run's `artifact`. Then:

- `handover finish` and `handover close` when the row's artifact is a page, `handover settle` when its witness OR
  that artifact is one (a pull request witness does not hide a published page), `close --artifact` and, on a closed
  row, `handover artifact` when the new pointer is one, REFUSE until one of these holds for the page:
  - a current-cycle card was drawn for it: while the page is the artifact, any `question` (or a
    `question-corrected` while one waits) journalled AFTER it became so; otherwise one naming it. A withdrawal,
    post, offer or reconfirm draws no card;
  - the row carries a ruling, or the owner has ruled on `page:<slug>` in the lock-in ledger;
  - a hand step's note draws it (its sentence, addresses, prose, checklist or decision; never `postedBy`).
- A page is read only by its exact spellings: `page:<slug>`, its `file:` URL under this home, or
  `/api/page/<slug>/` (plain, as a URL path, or URL-encoded in a viewer's `src=`). Prose is never read.
- A registered ask's own card does not count, however whole its shape: its text is front matter no journal
  orders, so nothing proves the card showing the page was drawn. Ask a question instead.
- A register that will not read refuses rather than passing. No page candidate means no extra read at all.
- Settle, finish and close hold the row's closing lock from that read to their terminal write (settle's includes
  closing a released run behind the row), and `page publish` takes it BEFORE it writes the page and holds it through
  recording the artifact, so a publish never lands between them; a contended one writes nothing and asks for a re-run,
  and a held run already closed refuses the publish before anything is written
  (`src/cli/commands/handover/closingLock.ts`).

## How to end instead

```bash
slopweaver handover ask <slug> --question "<the decision> — http://localhost:3000/api/page/<page>/index.html" \
  --problem … --options … --lean … --risk … --blast-radius … --still-real … --example …
```

The refusal prints this line with the row and page filled in. Settle or finish after the owner answers.

## The hatch, and what catches a slip

`SLOPWEAVER_ALLOW_UNCARDED_PAGE=1` is for a page nobody reacts to: a regenerated proof page, an internal artifact.
It prints that it was forced. A closed ask whose page still never reached the owner reads `UNCARDED` on `sweep board`,
and the daily `sweep-board-daily` pass puts it on the owner's Queue ([sweep](../../sweep/SKILL.md)).

Code: `src/cli/commands/handover/uncardedPageGate.ts`, `src/cli/commands/handover/closeUnderLock.ts`,
`src/handover/pageDelivery.ts`.
