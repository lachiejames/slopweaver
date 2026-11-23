# An email-born row draws its mail thread, live, with the owner's Gmail draft under it

An ask about an email shows the owner the actual email it refers to, the same way a Slack-born ask draws the thread
it replies in ([queue-and-triage](queue-and-triage.md)) — never nothing, not even a link to the mail.

**Which rows.** The ask panel, a decision hand step's places and the workstreams board-row panel read the row's
Gmail thread with `askMailThread` (`site/lib/mailAnchor.ts`): a `mail.google.com` address in its anchor, else
`thread <id>`, a Gmail address, or `gmail <id>` in its question, reason or summary — the shape the inbox lane
writes its ids in. A thread id is preferred to a message id, and either reads the whole thread.

**The chip.** The ask's record lines carry a `Gmail thread` chip, and the thread's own header carries an
`open in Gmail` chip into the mailbox the read was made from (`/mail/u/<account>/`), so the right account opens
even when it is not the browser's first.

**The read.** `MailThread.tsx` reads `app/api/mail-thread?id=`, a closed route whose one slot is a sixteen-hex
Gmail id (`site/lib/mailThreadVerb.ts`) and which runs `gmail read <id> --thread --json` — LIVE through the door,
because the corpus holds no drafts and no thread reader. `gmail read --thread` resolves a message id to its
thread, and every message carries `authored`, its body above the quoted history and signature. A read that
fails is a staleness mark whose hover carries the verb's reason, and so is one answering no message or counting
any in `unreadMessages` — never an empty or partial thread. A read in flight is a spinner.

**The shape is Gmail's** (`site/lib/mailThreadLayout.ts`, rule 7): the subject; the opener and the two messages
before the newest as one-line rows that open in place; everything between folded behind a count; the newest
received message open, its quoted history behind `⋯`; and every message Gmail labels `DRAFT` open beneath it
with Gmail's red `Draft`. With no draft on the thread it says so.
