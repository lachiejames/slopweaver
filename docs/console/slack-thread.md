# A row anchored in Slack draws the thread, and a card about one opens on it

Expanded rows of text are unreadable to the owner, so the panel shows the messages themselves in thread
context with a draft reply, the shape the archived console had. The parent page is
[queue-and-triage](queue-and-triage.md).

**Which rows.** An ask panel, a held-reply panel, and the workstreams page's board-row panel all mount
`SlackThread.tsx` when the row carries a Slack permalink. That is an ask or board row in its question, reason or
summary (MEASURED: 142 of 2656 board rows held one in `summary` against 48 in question or reason), an
ask in its own `anchor:` when that is a Slack permalink (`askThreadUrl`), and a held reply in its own channel and
thread.

**A card about a Slack thread SHOWS the thread, first.** A review card whose thread lived only in its anchor drew as
a sentence and an "asked at" link the owner had to click out to Slack; the owner wants the Slack messages themselves,
shown the way they would naturally come across the thread in Slack, rather than a description of them. So an ask
card, and a decision hand step floating one
(`drawnThreadOf`, `site/lib/cardLoading.ts`), pass the thread as `QueueCardBody`'s `thread`, drawn as the card's
first field ahead of the WHAT in every arrangement, never in the folded details. Each message is drawn through
`site/lib/slackMrkdwn.ts`, the draft preview's tokenizer, so bold, code, links and mentions read as Slack draws them
(TEXT spans only, never markup). Under the messages it draws the held reply when a draft is held for that thread, and nothing
when none is: the thread is read-only, because the console takes no typed words.

**An emoji reads as the emoji, not its shortcode**, because the owner wants emoji shown in their emoji form rather
than their text form. Every Slack preview on the console (this thread, a
draft's preview, a parked draft's lines and their link labels, the held reply, the running list and a Queue row's one-line
preview) draws a standard
`:thumbsup:` or `:wave::skin-tone-3:` as 👍 or 👋🏼, its shortcode on hover, through `site/lib/slackEmoji.ts` over a
committed snapshot of Slack's own name set (`emoji-datasource`, `site/lib/slackEmoji.json`). A rich-text emoji element
draws from the `unicode` Slack recorded on it first. The held reply renders through Streamdown, so its words take the
emoji pass before they are footnoted (`heldDraftMarkdown`). Three things keep the text as written: code (inline; fenced, across lines too, `fencedLines`; or any run in a preformatted block, `draftTextPieces`), what
the running list puts on the clipboard and what the console voice reads aloud, since Slack converts a pasted name itself.
**A workspace custom emoji stays exactly as written** (`:partyparrot:`), by decision rather than omission. No image
address for one reaches the console, and from text alone a custom name cannot be told from prose like `10:30:45`.
Drawing custom emoji means reading Slack's `emoji.list`, and that has not been built. A standard name newer than the
snapshot's release (the latest published) stays as written the same way, until the snapshot is retaken.

**The read.** The panel reads `app/api/thread?id=`, a second closed route beside `api/live` whose one slot is a
Slack permalink or a `<channel>:<ts>` pair and nothing else (`site/lib/threadVerb.ts` refuses any other shape). The
route runs `store around --mode thread --chars 4000 --json` and then `identity avatars --source slack --ids <the
distinct authorNativeIds>`, so every message shows its author's picture, name, time and the excerpt the corpus
holds, with the read's own limitations under the list. Pictures come from the member bronze, which is append-only,
so `avatarRoster` keeps the latest row per platform id.

**The held reply.** `HeldReply` reads the held-reply register when a held draft targets the thread: its badge, id
and reason, then the draft read as it will land, rendered by Streamdown with each `[n]` marker a GFM footnote whose
definition is the cited record's chip (`footnotedMarkdown`). A citation the body never marks (one only an `index`
row cites) sits on a closing "Also cited" line rather than being dropped. The page never writes a draft (rule 2: a
draft comes from a session's turn), and nothing on it sends: under the draft is the `slopweaver queue release <id>`
line with a button that copies it, and a note that changing the words is said in the call's chat with the card
open, never typed here.

An email-born row draws its mail instead: [mail-thread](mail-thread.md).
