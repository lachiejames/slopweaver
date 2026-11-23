# Triage — the inbox grouped by sender

Bundled reference for the `gmail` skill. `gmail triage` is the worklist the daily inbox-triage seat cards from
([inbox-triage](../../automation/reference/inbox-triage.md)); it changes nothing in the mailbox.

It reads the whole INBOX as `metadata` — headers only, never a body or a snippet — and prints one group per
sender: how many, how many unread, the span, whether EVERY message is automated, and what way out its headers offer
(`one-click`, a `link`, `mailto`, or none — only `one-click` can be performed, by `gmail unsubscribe`:
[unsubscribing](unsubscribing.md)). `--json` adds `ruleable`: automated, and nothing from the owner's own domain or
through a discussion list (`List-Post`) — the only groups a knowledge-row rule or a card's rule option may cover —
and `archiveRule`, set when a sender row of this install's own policy names the key. The policy is the store's
`gmail-triage-rules` row (`gmail triage-rules` prints it, `--set <path>` replaces it; a row that is not the declared
shape, or a store that cannot be reached, fails the reading, exit 1, before the mailbox is read), and the code ships
none of it: with none declared, no group is ruled, nothing is held out, and every group is carded. A `from:` row applies when
nothing in the group came from the owner's own domain or a discussion list, automated or not, and every message's subject
carries the row's phrase when it has one (so other mail from the same address stays carded); a `relay:` row when every
message's subject carries the row's phrase — and the text reading lists those last, apart, as archived and never
carded. Each group has a `key`, which is what a card, a standing rule and
`--key` all name: `from:<address>`, or for a Google Group relay (`'Sender' via Group`) `relay:<group
address>:<sender>`, because a relay rewrites `From` to the group and names the real sender only in the display
name. Unsubscribing from a relayed sender leaves the GROUP.

**A group an open card already stands for says so.** The whole reading and `--key` scan the pins under
`live/gmail/triage-cards/` and read each card row off the board: `--json` sets a group's `carded` to `{ slug,
filedInto }` while that card is unanswered, or while it was settled `filed` into a row still open (`filedInto`
names it, followed one step), and `null` otherwise; the text appends `already carded as <slug>` to the key line.
Only a live row PROVEN open marks a group: an archived row is closed, and a pin or card row that is missing or will
not read is named on stderr and the group stays unmarked, so it is carded again rather than hidden. `--key <k> --pin
<slug>` on a marked group pins and captures nothing and exits 3, naming the open card: settle it first. It is read at print time and never persisted — `--write` stores
the mailbox's document alone — and `--card` and `--ruled` never scan (`src/live/gmail/triageCarded.ts`).

Each lane below is off unless the install's policy declares it, and an off lane leaves its mail in its sender's
group, carded like any other. The document's `structuralRules` (schema 6) names the structural rules the reading ran
under.

**Under the `fathom-clear-inbox` delegate, Fathom's mail is never a group.** Mail from
`no-reply@fathom.video` is held out before grouping — no key, no subject — and only its ids are kept, in the
document's `fathom` field; the text prints one line counting them. They belong to `slopweaver fathom clear-inbox`
([fathom](../../fathom/SKILL.md)), which ingests each meeting through the Fathom integration and only then
archives the mail. A card's pin still finds a held-out id, so a pin made before the delegate was declared resolves.

**Under the `gmail-clear-meeting-notes` delegate, Gemini's meeting-notes mail is held out the same way.** Mail from
`gemini-notes@google.com` or `meetings-noreply@google.com` is never grouped or carded here; its ids sit in the
document's `meetingNotes` field (schema 3) and the text prints one line counting them. They belong to
`slopweaver gmail clear-meeting-notes` ([clear-meeting-notes](clear-meeting-notes.md)), which archives each one once
its transcript is proven in the corpus, or once its notes document is read and holds no transcript.

**Under the `last-reply` structural rule, a thread the owner answered last is never a group**: nobody is waiting on
the owner there. The reading also lists the owner's SENT mail to the same `--limit` — ids only — and reads, as
`metadata`, each inbox thread that listing names; a thread whose single newest message carries `SENT` is held out
into the document's `replied` field (schema 4) and listed under the ruled section as `thread:<threadId>`, so `--ruled` prints
its inbox ids too. A tie for newest, a message with no usable time, a forward (`Fwd:`/`Fw:`), or a message the owner
sent to themselves that also sits in their INBOX is not the owner's reply, and the thread stays carded. A reply of
the owner's past the SENT cap is simply not seen, so the cap can only make this archive less. With the rule off,
neither listing is read.

**Under the `passed-invite` structural rule, nor is an invite to a meeting that already happened**: once the meeting
has happened its invite email is junk. An invite comes from its organiser, so it
is held out one MESSAGE at a time into the document's `passedInvites` field (schema 5), each with the instant its
meeting was over by, and `--ruled` prints it under key `invite:<id>`. Only a message Gmail's own
`filename:invite.ics` search names is judged — one more ids-only INBOX listing to the same cap — so a mail merely
titled like an invite stays with its sender. The time is read off the subject Google Calendar
writes (`Invitation: <title> @ Mon 1 Jan 2001 <start> - <end> (<zone>) (<invitee>)`; also `Updated invitation`, `with
note`, `Accepted`, `Tentatively accepted`, `Declined`, `Cancelled event`), and only a subject that parses whole is
judged: a recurring meeting, a `Re:` or `Fwd:`, or any other shape stays with its sender's group. Over means the
reading is at or past noon UTC the day after the meeting's last day — midnight at UTC-12, so no zone is read and
none can archive early. `src/live/gmail/triagePassedInvite.ts` carries the grammar. With the rule off, the
`invite.ics` listing is not read.

| Flag                | What it does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `--key <group-key>` | print ONE group and its message ids                                                  |
| `--pin <card-slug>` | with `--key`, store the newest 20 in full, then pin those ids — once, never replaced |
| `--card <slug>`     | print the ids that card pinned which are STILL in the inbox — what an answer acts on |
| `--ruled`           | print every inbox id a declared archive rule covers — archived unasked, never carded |
| `--limit <n>`       | the most inbox messages to read, default 500, at most 2000                           |
| `--write`           | also replace `live/gmail/triage.json`, owner-only                                    |
| `--json`            | the reading (or the one group, or the card's set, with `ids`) as one document        |

It exits 3 when the inbox (every held-out lane included), the named group or the card's remaining set is empty. A reading that hit `--limit` says
`STOPPED at the message cap`; never describe it as the whole inbox, and never card from it — the inbox-triage seat
cards every group, so it reads again at `--limit 2000` first ([no card cap](../../automation/reference/inbox-triage.md#the-order-is-the-contract)). `--card` over one that misses a pinned id
refuses (exit 1) rather than calling it gone — re-run with a higher `--limit`; so does `--key` naming a group the
capped reading lacks. Archive a card's set with the ids `--card
<slug> --json` prints: `gmail archive <id>...` ([organising](organising.md)) — never a fresh `--key` reading, which
holds mail that arrived after the owner saw the card. Pins live in `live/gmail/triage-cards/`, ids only, owner-only.

## The mail a card shows the owner

A card is about mail the owner has not read, so its Queue card draws that mail under the problem line, one folded
row per message (the owner's ruling: if the owner does not know exactly what is in the email, there is a chance the
owner gives a steer that is wrong). `--pin` therefore reads each pinned message in `full` BEFORE it pins — the HTML and plain-text
alternatives, a body Gmail returns as an attachment id included — and stores them in `live/gmail/card-mail/<slug>.json`,
owner-only, and classed scratch, so the store never imports it and its backup never carries it. A pin is capped at the newest 20 ids so the card acts on exactly
what it shows; the older ones stay in the inbox for the next reading, which the pinned line says. A read that fails
pins NOTHING. The whole step holds a per-slug lock, so a second run pinning the same slug refuses with nothing
stored. A pin write that fails is settled on what the pin then reads back as, never on its error: no pin discards
the copy, so a stored copy never outlives a pin that was not made; its own pin, written whole, keeps it; another run's
pin has the copy read against it — already its mail, untouched; otherwise stored again for ITS ids, and when that read
fails the run names `card-mail <slug> --fetch`. Every discard first reads the copy back as THIS run's mail, because a
stale-lock takeover can overlap two runs; only the instant between that read and the removal stays open.

`slopweaver gmail card-mail <slug> [--message <id>] [--json]` reads that copy back from this machine alone — the
headers of every stored message, or one message's body sanitised for drawing: no script, no form, no remote fetch,
remote images replaced by a dashed box, and the page's own CSP allowing nothing but inline style and `data:` images
([mail boundary](../../../docs/security/mail-boundary.md#the-copy-a-card-stores)). It exits 3 when the card stored
no mail. A row whose slug starts `inbox-triage-` with no pin behind it (a finding named that way) also exits 3, and
with `--json` and no `--message` it prints `{"pinned": false, "schemaVersion": 1, "slug": …}`, so the Queue draws
no mail on it rather than a failed read; a pinned card with no stored copy prints nothing and stays a visible gap
for `--fetch`. `--fetch` is the one mode that reaches Gmail: it re-reads the card's pinned ids and replaces the copy, for a
card pinned before cards stored mail, or a copy the content check refuses; a failed `--fetch` leaves the old copy as
it was. A message Gmail no longer has (404) is stored as `gone` and drawn as such, never as an empty body.

A key names a sender and never authenticates one: `From` is the sender's claim, and a relay key's second half is a
display name. That is why an act is on pinned ids, why a knowledge-row rule never covers a `relay:` key, and why a
declared `relay:` row is narrowed by a subject phrase too
([inbox-triage](../../automation/reference/inbox-triage.md#standing-rules)).
