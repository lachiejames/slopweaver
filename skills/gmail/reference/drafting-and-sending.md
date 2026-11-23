# Drafting, and the one gate you cannot open

The form `gmail draft` takes, what `--reply-to` does and does not infer, and the four things to carry into
every send. The rule — a draft is always the right first move, and only the owner supplies the digest — is in
[SKILL.md](../SKILL.md).

`gmail draft --form -` composes and stores a draft in the owner's own mailbox. Nothing is delivered, so this
is the verb to reach for whenever a request is "write X" or "reply to that" — a draft is always the right
first move, and it is reversible by deleting it in Gmail.

## The Gmail draft IS the hand-off — never a card with text to paste

The owner's ruling, on a reply to an outside vendor drafted this way: the owner is pretty happy with this flow,
where the draft email shows up inside Gmail for them, everyone already tagged, everything written out, and all
they have to do is press send or make a few edits. So a mail the owner is going to send personally is finished
work when it sits in the owner's Drafts:

- **`to` and `cc` are set** — everyone who should be on it is already tagged, so the owner never adds a recipient.
- **The body is the whole message**, in the owner's voice (`slopweaver slack voice-rules`), ready to go unedited.
- **A reply is threaded** with `--reply-to <message-id>`, so it opens inside the conversation it answers.
- **Tell the owner it is there** — one line naming the draft and the recipients. Never paste the body into a
  card, a hand note or a DM for the owner to copy into a new email; that is the shape this replaces, and a session
  steering back toward it is re-litigating a settled ruling (`slopweaver knowledge recall "gmail draft"`).

Sending stays the owner's own press in Gmail, or `gmail send` with the owner's digest below — the draft never sends itself.

**Always pass the form on stdin.** A body written into a command line is a body the shell rewrites: backticks
are substituted and `$` is expanded, and that has already silently eaten text in this repository. The form is
five fields, and it is STRICT — a key it does not know is refused with the nearest real field named, rather
than dropped:

```bash
printf '%s' '{"to":["a@example.com"],"cc":[],"bcc":[],"subject":"…","body":"…"}' \
  | "${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" gmail draft --form -
```

**A paragraph is ONE line.** Never wrap a body yourself: the reader's mail client wraps, and a body broken
at eighty columns reads as a narrow column beside a thread of full-width replies. A
blank line separates paragraphs, and only a list item (`- `, `* `, `• `, `1. `, `1) `) or a quoted line
(`>`) may start straight after another line. A body with any other break is REFUSED, naming the lines, and
never reflowed — so a sign-off is `Cheers, the owner` or two paragraphs, not two lines, and a postal address,
a signature block or code goes on one line or as list items. No line-shaped block is inferred from prose
(`src/outbound/gmail/paragraphs.ts`). The rule sits in the form every draft path shares, so a mail ask
recorded with `handover ask --action` is refused the same way.

`--reply-to <message-id>` composes into an existing conversation, lifting the parent's threading headers and
inheriting `Re: <its subject>` when the form's subject is empty. A subject that is not the parent's, `Re:`,
`Fwd:` and case aside, is refused (`REPLY_SUBJECT_MISMATCH`): Gmail threads a draft only on a matching subject,
so it would land outside the conversation it answers. A reply Gmail still files in another thread is refused
after the store (`REPLY_DETACHED`), naming the stray draft to delete. **It does not infer the recipient** — you
still state `to` yourself, because "reply to whoever sent it" is a guess, and the sender of a message is
often a list, an alias, or somebody who should not receive the answer.

**A reply that OPENS by quoting back the whole parent is refused** (`REDUNDANT_OPENING_QUOTE`). The owner's
rule: quote the line you answer only when they said more than one thing, because the quote earns its
place by picking which one; a reply to a single-point message opens on the answer. `--reply-to` is the one
path that knows the exact message answered, so it is the one that checks: the parent's authored text (quoted
history and a `-- ` signature stripped) against the draft's opening `>` block, whitespace and Unicode
compatibility forms (NFKC) normalised, nothing else. A bare greeting (a listed opener such as "Hi" and a
name, or a set pleasantry) before the parent's point and a bare sign-off after it do not count as a second
point; an unlisted greeting such as "Yo" is content. A sign-off is a closer then only signature-shaped words:
title-case, product-name ("iOS") or short-acronym name and title words, a `|`-style separator, an email, a run of digits. So a
second point written in that shape where a name may stand is the one false refusal class: after a closer
("Thanks, ETA TBD") or, as up to three name-shaped words or "and", straight after a greeting's opener ("Hi
Review and Approve."). A
parent Gmail returns with no message id is refused (`INVALID_ADDRESS`); anything else the check cannot read
passes rather than refuses: a PARTIAL quote of a one-point message, a signature carrying other words, an
HTML-only parent whose history the strip cannot see, a parent that is all quoted history, a body Gmail did
not inline. The module header lists each case that passes
(`src/outbound/voice/redundantOpeningQuote.ts`); the no-id refusal is `src/live/gmail/outbox.ts`'s. For a legitimate exception, `slopweaver hatch open
redundant-quote --reason "<why>"`.

**Four things to carry into every send**, when the owner asks for one through Slopweaver rather than pressing Send:

- **Run `gmail send <draft-id>` with no `--approve` and show the owner the output.** That IS the preview: the
  recipients field by field, the subject, the body, and the digest. It refuses, exits non-zero and sends
  nothing, and the refusal is recorded at the door.
- **The digest covers content, not the draft.** Edit the draft and the old digest stops matching, so an
  approval cannot be moved onto a message the owner did not read. A non-matching `--approve` is refused with
  which failure it was — never approved, or approved and then changed.
- **`$SLOPWEAVER_DOOR_OVERRIDE` cannot waive this.** It is a `hold`, and a hold carries no override token by
  the door's own type-level contract. If a send is refused, the fix is an approval, never an environment
  variable — and there is no other route to the same effect.
- **An accepted send is not a delivered mail, and nothing here can recall one.** Report what the mailbox
  reported. Gmail's undo window lives in its interface, not its API.

**The outbound privacy check runs on every write, under the verb's `--home`, a send's after its approval.** A draft is
judged on its decoded message (subject, addresses and names, headers, text and HTML bodies, attachment names, types
and text-like bytes), strict: a private term, a denylist word or a forbidden identifier refuses it, naming the locus
and the class but never the term, and nothing reaches Gmail. A send re-reads the draft as Gmail holds it, judges that,
and sends nothing if the re-read fails — so a draft edited in Gmail to carry a term is refused even with a valid
`--approve`. The fix is a reworded draft and a fresh approval, never a hatch: the check has none. Its edges and
residues: [write transports](../../../docs/security/write-transports.md).

Two limits worth knowing before you promise something. A message `gmail draft` writes is plain text — no
attachments, no HTML alternative — and a non-ASCII address is refused rather than mangled, because nothing on
this path speaks SMTPUTF8. Punycode the domain and it passes. The one multipart message in the repository is
`spend forward`'s receipt draft (`src/live/gmail/forward.ts`), and the approval digest above does NOT cover
its attachment — which is why that draft is the owner's to send in Gmail, never through `gmail send`.

## Drafting a board row's mail — `--board <slug> --expect <digest>`

The owner's ruling (option A): a mail the owner is being asked about is previewed on the console first, and
its Gmail draft is created only when the owner presses. So the form can also come off a board row instead of stdin:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" gmail draft --board <slug> --expect <digest> --dry-run   # compose, store nothing
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" gmail draft --board <slug> --expect <digest>             # store the draft
```

The row is an ask recorded with a MAIL action (`handover ask --action`,
[ask-shape.md](../../handover/reference/ask-shape.md)), and `handover list --json` publishes its
`mailPreview` — the digest and the `localhost:3000/queue/mail/<slug>/<digest>` page that draws it. The verb
reads the mail off the row itself, never off the caller, so the only mail this path drafts is one a visible
session recorded. `--expect` is refused unless it is the digest of the mail the row holds NOW, so a mail
changed after the owner read it is never drafted under the owner's old read. A sender that is not the mailbox the grant
belongs to is refused, and a second press of the same mail is refused naming the draft the first one made
(`src/cli/commands/gmail/boardDraft.ts`). Two presses that OVERLAP are one draft too: each takes an exclusive claim
on the mail before Gmail is called, so the second is refused while the first is in flight. The row is read
again once the claim is held, so a row answered while the draft was being planned drafts nothing. Gmail gets
ONE attempt, never a retry of a lost response, and an API failure KEEPS the claim, since Gmail may have stored
the draft before failing — bar a privacy refusal, which provably sent nothing and releases this press's own claim
so a reworded row drafts on the next press; a claim left that way, or by a press that died, is refused as abandoned rather
than taken over — look in Gmail's drafts before removing the file it names (`boardDraftClaim.ts`). `--form` and
`--reply-to` are refused beside `--board`: the row is the only source, so a row whose mail records a `replyTo`
drafts a threaded reply to that message, and one that records none drafts a new mail
([mail-action.md](../../handover/reference/mail-action.md)).

Sending stays `gmail send`'s own act, with its own approval digest, exactly as above.
