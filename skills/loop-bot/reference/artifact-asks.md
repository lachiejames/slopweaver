# An ask that names an ARTIFACT

Bundled reference for the `loop-bot` skill, linked from [dynamic-planning.md](dynamic-planning.md) § 1.

## The rule

**When the ask names an artifact — a file, a report, a PDF, an invoice, an export, a deck, a login, a meeting
transcript, a recording or meeting notes — the corpus is the FIRST leg and never the last.** The corpus
records what was SAID. A file somebody keeps in Drive or a mailbox has usually never been said anywhere, so an
empty corpus search is evidence about the corpus and about nothing else. `slopweaver route plan` offers
`drive`, `gmail`, `outlook`, `calendar` and `browser` as current-truth legs for exactly these words, and each
one is owed before any "it does not exist" reaches the thread.

**A transcript, recording or meeting notes opens the mail AND Drive doors before "none exists".** Meet mails
the notes and files the document in Drive; a notetaker mails a link. This machine's Claude session logs
(`transcripts sessions`) are a different thing that shares the word, and `route plan` gives them only the
qualified phrases — `session transcript`, `claude transcript` — so the bare word plans the doors.

## What it came from

MEASURED on one turn. The card's own _Consulted, found nothing_ line read:

```text
corpus search for a vendor report file: no pdf, attachment or drive doc
```

One corpus search, and a claim about a drive. All three doors were already connected, and between them they
held the vendor portal's invitation (`gmail list --query <vendor>`), a live session for the portal in the owner's
own Chrome (`browser cookies --origin https://portal.example.com`) and a derivative of the report in a shared
drive. None of it needed new access.

The same shape again, recorded in a keep export: asked for a meeting's transcript, a turn read local
disk and the store, found nothing, and said no transcript existed. The mail and Drive doors held three full
transcripts it never opened. `route plan` was half the cause — it gave the bare word `transcript` to the
session-log row alone, so the plan itself pointed at disk. `unit/route/sourcePlan.test.ts` § "an ask that
names an ARTIFACT" now holds that question to the Drive and mailbox legs.

## Three things that read as absence and are not

- **`drive list --query` takes a Drive query EXPRESSION**, not free text: `--query "pentest"` answers Google's
  `Invalid Value`. Compose `name contains 'x'` or `fullText contains 'x'` from the nouns of the ask.
- **A SHARED drive is a separate corpus.** A plain `drive list` never reaches one however much the browser
  makes it look like one Drive — `slopweaver drive drives` lists the ids, and `--drive <id>` searches one.
- **`gmail list --query` is Gmail's own syntax and ANDs every word**, so a whole question returns an empty
  page. One empty query is one query — for a transcript try the meeting's name, `subject:notes`, and the
  attendee who would have received it.

## What to say when it genuinely is not there

Name the surfaces you actually read, and what an empty one does and does not prove. A door this install never
connected arrives from `route plan` as `unavailable` carrying the verb that connects it — report that leg
rather than passing over it, per [route](../../route/SKILL.md). "Not in the store, and the mailbox is not
connected here" is an answer; "no transcript exists" is not, until the doors were read.
