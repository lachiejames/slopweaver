# Booking, changing and cancelling — and the one gate you cannot open

The forms each write verb takes, what the hold covers, and the three outcomes a write can leave behind. The
rule — a write that reaches anyone but the owner stops for the owner's word, given as an anchor and never as a
digest they type — is in [SKILL.md](../SKILL.md).

## Every write goes to the owner's own calendar, and takes its form on stdin

`--form -` reads the form from stdin. Pass it that way: a body written into a command line is a body the
shell rewrites, since backticks are substituted and `$` is expanded. Each form is STRICT — a key it does not
know is refused with the nearest real field named, never dropped.

```bash
# book: a new event on the owner's primary calendar
{"title":"Tobias / the owner","start":"2001-01-17T15:00","end":"2001-01-17T15:30","zone":"Australia/Melbourne",
 "attendees":["tobias@example.com"],"description":"…","location":"…","meet":true,"allDay":false}

# edit <event-id>: only the fields present change; attendees is the WHOLE set afterwards
{"title":"…","description":"…","location":"…","attendees":["a@example.com"]}

# reschedule <event-id>: when, and nothing else
{"start":"2001-01-18T10:00","end":"2001-01-18T10:30","zone":"Australia/Melbourne"}

# respond <event-id>: the owner's own RSVP on somebody else's invitation
{"response":"accepted"|"declined"|"tentative","comment":"…"}

# cancel <event-id> takes no form at all
```

**Times are WALL-CLOCK plus a zone, never an offset.** `2001-01-17T15:00` in `zone` (the owner's account's, unless
the form names one) is exactly what Google's own `EventDateTime` takes, so nothing here computes an offset
and nothing can land a meeting on the wrong side of a daylight-saving edge. An all-day event is two bare
dates with `allDay: true`, and its `end` is the last day INCLUSIVE — the exclusive bound Google wants is
worked out once, in the planner.

`meet` defaults to true whenever anyone is invited and false otherwise. The owner's own address is dropped from
an attendee list rather than invited.

## The hold

A write is OUTWARD when, comparing the event before and after: anyone but the owner is on it afterwards,
anyone was REMOVED by it, a room or resource is on it, the organiser is not the owner, or Google returned the attendee
list incomplete. An RSVP is always outward — the organiser sees it. Anything else mails no guest and is
applied at once, journalled at the door.

**Inward is a claim about GUESTS and about nothing else.** It says Google mails no invitation, update or
cancellation. It does not say the event is unobserved: anyone the owner has already shared their calendar
with sees it, and a subscriber who turned on new-event mail is told by Google through a setting that is theirs rather
than this write's. Proving otherwise would need the calendar's ACL and every subscriber's preferences, which
is wider than the grant the owner chose — so say this when it matters instead of implying secrecy.

**"The owner" is whoever Google marks `self`, and only then whoever matches the bound address.** An organiser
or attendee entry carrying `self: true` IS the owner even when the address on it is an alias or a delegated
one; an address-only test read the owner's own solo event as organised by a stranger and held an inward write for an
approval nobody owed. `self` is CALENDAR-relative — it means "the owner of the calendar this copy was read
from", not an identity assertion — which is exactly why it is trusted here and nowhere else: every write
reads from and writes to the bound account's own `primary`, checked at prepare, at commit AND at apply
(`assertWriteTargetIsOwnPrimary`), because production resolves a fresh credential at each of the three. A
`self` a form supplied is never read; only a Google snapshot's.

**A participant this door cannot NAME holds the write.** An attendee or organiser Google returned with no
address at all is a hold reason of its own beside `attendeesOmitted`; dropping one would be fail-open, a
write that reached them applied as reaching nobody. A `self` entry with no address is still the owner, and holds nothing.

**An RSVP previews its comment verbatim**, because the comment goes to the organiser under the owner's name.

An outward write prints the preview, prints a digest, and refuses. **That IS the preview**, the same way
`gmail send` with no `--approve` is. Tell the owner what it does, wherever they are talking. The digest covers the account, the calendar, the
event id, the operation, the exact body that will reach Google, and the attendees before and after — so
changing the event or the form stops the old digest matching, and an approval can never be moved onto
something nobody read. There is no override: a hold carries no token, and `$SLOPWEAVER_DOOR_OVERRIDE`
cannot waive it.

## The owner's yes is an anchor

`calendar commit <intent-id> --anchor <where the owner said yes>` re-reads the event as Google holds it NOW, rebuilds
the plan and the digest, and sends only when that digest is the one the PREVIEW printed — stored on the intent
at prepare as `previewDigest`. Any drift holds again, naming both digests: tell the owner what changed, re-run
the verb, and commit on their new word. A committed intent cannot be committed twice.

The anchor is a call stretch `talk-call:<call>#<segment>`, a relay `talk:<turn>` or a typed turn
`transcript:<session>#<turn>`, read through the same resolver `profile words` uses. It refuses, before the door,
a record holding only PART of what the owner said (a cut head or tail may hide the "no, wait"), a relay that predates
recording whether its head was cut, a card landing `call:<call>#<segment>` (its words are the card's copy, which
an overtaken batch can land before the rest reached the call — name that call's own `talk-call:` stretch), a
stretch any line of which a console that is not the owner's recorded (a seat's witness speech, `src/talk/callOrigin.ts`) or
whose console a line that does not parse leaves unknown, an undated record, and an intent prepared before `previewDigest` was stored. On a send, the applied intent records
`approvedBy: { anchor, atIso }` — where and when, never the owner's words — so an over-read is findable afterwards.

What it proves and what it does not: the record holds the owner's own whole words, and the change sent is byte
for byte the one previewed. A call stretch names no intent, so whether the owner's words mean yes to THIS change
is the committing session's judgement, and the door checks no meaning. A yes the owner gave before `book` ran is
the ordinary case, because the preview's digest is still what the send is checked against.

**Which anchor is the owner's yes — the rule, because the code cannot check it.** Pass the anchor only when all four hold:

- **It is about this change**: the people, the time and the event the preview printed, not a yes to another card,
  another meeting or the conversation in general.
- **It is the owner's latest word on it**: nothing the owner said after it, in that call or anywhere else, says no,
  wait or change it. A "no" or a question is never a yes, however whole the record.
- **The preview the owner would see is the one they agreed to**: a drifted or refused commit means the change moved,
  so tell the owner what is different and commit only on a word given AFTER that. Never reuse an earlier anchor on a fresh preview
  of a different change.
- **You read the words yourself** (`profile words <anchor>`) before committing, rather than trusting a relay's
  summary of them.

When any of these is unclear, do not commit: tell the owner what the preview does and take their answer.

**`--approve <digest>` is the other spelling**, for a digest the owner hands you personally. Never pass one you
printed yourself, and never ask the owner for one. `--anchor` and `--approve` together are refused.

**A commit ALWAYS needs an approval, even when the rebuilt plan now reaches nobody.** The hold and the
commit answer different questions. The hold asks whether a write reaches another person; the commit asks
whether this is the change that was approved. So an intent prepared while a guest was on the event still
demands the owner's yes after that guest leaves, because the approval was given over a version the event no longer
has. Only a FIRST call that reaches nobody applies with no approval at all.

Neither spelling authenticates a human: an anchor is attributable, never proof
([cross-session-messages](../../../.claude/rules/cross-session-messages.md) § Anchoring an authority). What
binds is that the change cannot move underneath the yes, and that the yes is on the record.

## After the send

Draw a note only once the event exists, saying what was created and who it reached — the `applied` read-back
is the source. Never a note asking for a step the owner has already taken on the voice.

## Three outcomes, and the one that needs a human

- **applied** — Google accepted the change, and what is printed is the event read back from it.
- **uncertain** — the mutation was sent and no readable event came back. Reconcile by the event id before
  doing anything else; do NOT re-run the write, which is the one path that could mint a second invitation.
- **refused** — nothing was sent. A version conflict (`the event changed since it was previewed`) means
  exactly that: re-run the verb for a fresh preview, never fetch a newer version and send the approved act
  against it. A privacy hold (`refused before sending: the outbound privacy check stopped it`) is judged at
  the commit, on the exact body, with the private terms read afresh, and has no override: the intent stays
  pending, so repair a broken terms file and re-run the same commit, or reword the change and prepare it again.
  A private term on a row carrying the owner's meaning is HELD instead (`held before sending`): run the
  `private-terms review-prepare` step it prints, and once a fresh reviewer's receipt is CLEAN re-run the same
  commit, which sends those exact bytes once ([write transports](../../../docs/security/write-transports.md)).

A booking carries an id this door chooses, so a repeat lands on Google's own 409 rather than a twin event.
A patch and a cancellation carry the ETag the preview was taken over as `If-Match`, so Google refuses a
change to an event that moved underneath it.

## What it will not do

Sharing or ACL changes, moving an event between calendars (Google's `events.move`), attachments, creating
out-of-office and other special event types, and writing to any calendar but the owner's own. None of these
is missing by oversight — each is a scope or a semantic the owner has not asked for, and the absence is the answer.

**A recurring SERIES is refused; one occurrence is written.** Hand a verb the master's id and it refuses by
name, because a write there applies to every occurrence and a cancel removes the whole series from every
invitee's calendar — while the exceptions inside it can carry guests the master's own attendee list never
names, so who the write reaches cannot be established from one read. `calendar list` expands the series and
prints each occurrence's own id; that is the id to pass. "This and following" is not offered at all.

**An existing block that AUTO-DECLINES is refused outright, not held.** An out-of-office or focus-time event
carrying `autoDeclineMode` other than `declineNone` declines overlapping invitations on the owner's behalf and sends
each organiser a message Google composes — so moving one onto somebody's meeting reaches a person through
words this door never wrote and cannot preview. A hold shows what will be sent; nothing here can show that,
so the write is refused by name and the answer is to change it in Google Calendar itself.
