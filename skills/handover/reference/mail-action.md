# A MAIL action — the email, previewed before it is a Gmail draft

Read beside [ask-shape.md](ask-shape.md) § `--action`, which this extends from a Slack post to an email.

The owner picked option A on the ISO concerns email: a mail-native preview on the console, and the Gmail
draft created only when the owner presses. So `--action` also takes a MAIL: `{"version": 2, "kind": "mail", "actor":
"me", "from": "<the owner's mailbox>", "form": {"to": [...], "cc": [...], "bcc": [...], "subject": "...", "body":
"..."}}`. The form is `gmail draft`'s own five fields, checked by the same validator, with a subject required,
`MAIL_MAX_RECIPIENTS` and `MAIL_BODY_MAX_CHARS` as the caps (`src/handover/askAction.ts`) — an email is
longer than a Slack post, so the word cap a card body carries is not its bound. That validator refuses a
body hard-wrapped inside a paragraph, so write each paragraph as one line
([drafting-and-sending.md](../../gmail/reference/drafting-and-sending.md)); a recorded mail that breaks it
reads as invalid, and is never drafted wrapped.

**A mail that answers one carries `"replyTo": {"messageId": "<gmail message id>"}`** — the MESSAGE being
answered (sixteen hex digits, as `gmail read` prints it), never a thread id. The owner's press then drafts it INSIDE
that thread, to the recipients the form names, and the card says so: its head reads as a reply, its press
"Save the reply to your Gmail drafts", and it draws that thread above the fold. Without it the press drafts a
NEW mail beside the conversation, which reads as a mess. A
card answering an email that offers a mail with no `replyTo` is that defect.

The options are derived exactly as a Slack action's are: "create this as a Gmail draft", then HOLD. `handover
list --json` publishes a `mailPreview` beside the action — a digest over the sender, the recipients, the
subject, the body, the slug and the reply target when there is one, and the `localhost:3000/queue/mail/<slug>/<digest>` page that draws the whole
mail (`src/handover/mailActionPreview.ts`). The card carries that URL. The owner's press runs `gmail draft --board
<slug> --expect <digest>`, which reads the mail off the row and refuses a digest that is no longer the row's:
[drafting-and-sending.md](../../gmail/reference/drafting-and-sending.md). Nothing sends; a draft waits in
the owner's mailbox.
