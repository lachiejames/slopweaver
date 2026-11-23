# Clearing Gemini meeting-notes mail — download the transcript, then archive

Bundled reference for the `gmail` skill. The Gemini meeting-notes mail is always archived, but only once the
transcripts are being pulled as they come: always download the transcript, and when there is none, just archive the
mail. So `slopweaver gmail clear-meeting-notes` archives a mail once its transcript is
PROVEN in the corpus, or once its notes document is READ and holds no transcript at all. The mail alone never
proves either.

## What one run does, in order

1. Reads every inbox mail from `gemini-notes@google.com` or `meetings-noreply@google.com` in full (`--limit`,
   default 100, at most 500; a read the bound stopped says `NOT every match was read` and exits 1). An id Gmail
   lists twice is read once; one answered under another id is named unparsed and never judged.
2. Proves each against gmail bronze: a `transcript` row under `<message-id>:meeting`, in `mail/meetings`, with
   non-empty text, whose `title` and `attrs.meetingDate` are the quoted title and date the mail's SUBJECT named.
3. For a mail bronze lacks, reads the linked Google Doc and projects it exactly as a refresh would, commits what
   projects under the gmail refresh slot (refused beside a running refresh), then proves AGAIN off bronze as it now
   stands — never off the commit's own word. A document read with Gemini's summary and no transcript is
   `no transcript`: nothing is written, because only the raw transcript is ever stored.
4. Checks the store retrieval reads holds every proven row AS bronze proved it — kind, title, body (md5, computed
   by the database), `attrs.meetingDate` and `visibility` — replaying all of gmail bronze once if one is missing or stale.
5. Archives every proven and every `no transcript` inbox mail through `gmail archive`, the one door write, one id per
   call so the report names exactly the mail that left the inbox.
6. Settles `answered` any open card under such a mail now out of the inbox — the corpus row, or the document read
   with no transcript, its witness; the line reads `card <slug> settled`.
7. Places ONE Queue card per kept mail the owner has to act on, slug `meeting-notes-mail-<message-id>`; a second
   run finds the first run's card rather than stacking another. A card archived or carrying a settlement is the
   owner's settled answer: never re-asked, the line reads `settled` and names the `gmail archive <id>` the owner's
   answer may leave for the fleet.

`--dry-run` stops before step 3's commit and changes nothing. A mail it would ingest reads
`a run would ingest it, then archive`; one it would archive reads `a run archives it`.

## Proving every transcript so far

```bash
slopweaver gmail clear-meeting-notes --audit --limit 500
```

`--audit` reads the WHOLE mailbox (`in:anywhere`), archived mail included, and changes nothing. Every line is one
meeting and reads `proven: gmail <id>:meeting`, `no transcript: <why>` or `kept: <why>`. It exits 0 only when every
mail is proven or never had a transcript. Any kept mail exits 1 and names itself.

## A meeting nobody transcribed is archived, not carded

Measured with `--audit --limit 500`: 78 meeting-notes mails, 55 proven, 22 whose notes document holds
only Gemini's summary, 1 kept. Every one of those 22 had been read again days to months after its mail arrived, and
none had grown a transcript since, so a summary-only document is a meeting nobody transcribed rather than one not
transcribed YET, and carding it would re-ask what the owner has already answered.

The trade, stated: if Google ever moves the transcript under a heading `src/corpus/gmail/transcriptBlock.ts` does not
recognise, those mails are archived as `no transcript` rather than carded. `--audit` names every one by id, the
archive is reversible, and the document itself is untouched.

## Why a mail stays

| Reason                     | Carded? | What it means                                                                     |
| -------------------------- | ------- | --------------------------------------------------------------------------------- |
| `subject-unparsed`         | yes     | the subject carries no quoted title and date, so nothing can be proven against it |
| `no-docs-grant`            | yes     | the Gmail grant lacks the Docs scope; `gmail connect --grant manage` restores it  |
| `provider-error`           | yes     | the doc could not be read — moved, or not shared with the owner                   |
| `no-link`/`malformed-link` | yes     | the mail links no readable notes document                                         |
| `undated`                  | yes     | the mail has no send time to file the transcript under                            |
| `bronze-mismatch`          | yes     | bronze holds a row under this mail's id that names another title or date          |
| `not-held-after-commit`    | yes     | committed, and bronze still lacks it — the install's sync denylist, most likely   |
| `not-in-store`             | no      | bronze holds it and the store does not after a replay; the next pass retries      |
| `capped`                   | no      | the document ceiling stopped the pass; the next pass reads it                     |

Each carded reason is one where the run cannot show a transcript was downloaded or that none exists. A carded mail
is a hand step placed, so a run exits 0 over it. An uncarded kept mail exits 1, which is what the standing row is
watched by.

**The title and date are matched strictly, on purpose.** An untitled ad-hoc call's subject
(`Notes: Meeting on 7 Sept 2001 at <time> <zone>`) carries no quoted title, so it is carded `subject-unparsed` even
when bronze holds its transcript. Loosening the match to the bare message id would let a wrong row prove a mail.

## Where it runs

An install that wants it scheduled writes its own `verb-run` definition for it
([declared rows](../../automation/reference/declared-rows.md)); none ships. When the install's triage policy declares
the `gmail-clear-meeting-notes` delegate, `gmail triage` holds this mail out of its groups and counts it in one line
([triage](triage.md)), so the inbox-triage seat never cards it; without that delegate the mail is carded.
