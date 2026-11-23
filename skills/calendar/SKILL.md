---
name: calendar
description: Authorise a Google Calendar once by browser consent, then read which calendars exist, what is on in a window, one event in full, and when the owner and the people they name are free — and book, change, reschedule, cancel and RSVP to meetings on the owner's own calendar, where anything reaching another person holds for the owner's approval. Use when the user asks what is on their calendar, what a meeting is, who is attending, when they or a colleague are free, when to book something, which calendars slopweaver can see, or to connect Google Calendar in the first place. Phrases like "what's on today", "what's my week look like", "who's in that meeting", "when is the sync", "read that event", "when am I free", "find a time with", "when can I meet X", "book a meeting with", "set up a call with", "move that meeting", "cancel that", "accept that invite", "decline that", "which calendars can you see", "connect my calendar", "am I connected to calendar".
argument-hint: connect [--grant read|events|meetings] | calendars | list | read <id> | free --minutes 30 [--with <email>]... | prep-due [--hours 4] [--dry-run] | book --form - | edit <id> --form - | reschedule <id> --form - | cancel <id> | respond <id> --form - | commit <intent-id> --anchor <where the owner said yes>
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" calendar $ARGUMENTS` and report the result.

## The door, and what is behind it

`connect`, `calendars`, `list`, `read`, `free`, `prep-due`, `book`, `edit`, `reschedule`, `cancel`, `respond` and
`commit` are the whole of the Calendar surface. Never reach
for raw HTTP, `curl`, a Google MCP tool, a browser scrape or a second client to do something a verb does
not: the absence is the answer, not an obstacle. Use the world model for history and discovery; it cannot
establish current calendar state.

**This door writes, and every write that reaches another person HOLDS for the owner's word.** `book`, `edit`,
`reschedule`, `cancel` and `respond` prepare a change on the owner's PRIMARY calendar and print it; if it
reaches anyone but the owner they stop there and change nothing. **The owner's word is an ANCHOR, never a
digest they type** — `calendar commit <intent-id> --anchor <where the owner said yes>` is the second step. The owner
steers on the voice and does not give digests, so never draw a note or a card asking the
owner for one, and never pass `--approve` with a digest you printed yourself. One scope backs all of it,
`calendar.events.owned` under `connect --grant meetings`, chosen by the owner: calendars the owner OWNS,
never a colleague's, never a secondary one.

## The one thing to get right when you report a time

**A timed event and an all-day event are different kinds of thing, and the verbs never flatten them.** A
timed event carries an instant and the zone it was authored in, and is rendered `2001-01-08T09:00:00+10:00
[Australia/Sydney]`. An all-day event carries a bare date and NO instant, and is rendered `2001-01-09 (all
day)`. Report them the way the verb does. Never turn a date into a time — "the offsite starts at midnight"
is a sentence this door will never produce and you should not either.

`calendar calendars` reports the account's own default time zone, which is what an all-day day is read
against. When the grant lacks `calendar.settings.readonly`, that line says **not established**, and the
honest thing to say about a day is which date Google called it.

## Bounds and residue — what a listing is NOT

Every read prints a `residue:` block, and the lines in it are the ones a reader will otherwise assume away.
Carry them into what you say:

- **A listing is ONE window, on the calendars it was ASKED for.** An event outside the window, or on a
  calendar not named, is _unread_, not absent. Default is the next seven days on `primary`.
- **Recurring events are EXPANDED into instances by `list`.** What you see is what Google computed for that
  window, not what the owner authored — the rule itself lives on the master, and `calendar read <master-id>`
  is what shows it.
- **A titleless event is not an empty hour.** Either the grant sees that calendar as free/busy only, or the
  owner marked the event private. Say "busy, no detail", never "nothing on".
- **A CANCELLED event is reported, not hidden.** It says so, and it did not happen.
- **A cap can bite.** `--limit` defaults to 50 and the residue says when more matched than was read.

## When is the owner free — `calendar free`

`calendar free --minutes 30 --with <email> --days 5 --between 09:00-17:00` asks Google's free/busy about
the owner's primary calendar and every `--with` address, merges the busy blocks, and prints the open stretches
at least `--minutes` long, clipped to `--between` on each local day in the owner's zone. Three things to carry:

- **A slot is an observation, not a reservation.** It can be gone before a booking is proposed; say so.
- **A calendar Google refused makes the answer UNKNOWN, never free.** The slot list is emptied and the
  residue names the calendar — read it back to the owner as "I can't see X's calendar", not "X is free".
- **Hours are the owner's to state.** With no `--between`, 03:00 is a candidate. Ask, or pass working hours.

Details, the zone, and what a colleague's calendar does and does not reveal:
[scheduling.md](reference/scheduling.md).

## Booking, changing and cancelling — and the one gate you cannot open

Every write goes to the owner's PRIMARY calendar and takes its form on stdin, so a shell never rewrites a title:

```bash
printf '%s' '{"title":"Tobias / the owner","start":"2001-01-17T15:00","end":"2001-01-17T15:30","attendees":["tobias@example.com"]}' \
  | "${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" calendar book --form -
```

That prints the proposed event, says who it reaches, prints a digest, and REFUSES. Tell the owner what it does
— on the voice is fine — and once they say yes, run `calendar commit <intent-id> --anchor <talk-call:…#seg |
talk:… | transcript:…#…>`. It reads the owner's whole words there, re-reads the event, rebuilds the digest,
sends only when it matches the one the preview printed, and records the anchor on the applied intent. Whether
the owner's words mean yes to THIS change is your judgement, and the door checks no meaning: the anchor must be
the owner's latest word, about these people and this time, read by you — never a yes to something else, never
an earlier anchor reused after the change moved
([which anchor](reference/writing.md#the-owners-yes-is-an-anchor)). A yes the owner gave BEFORE `book` ran counts. The note, if
any, comes AFTER the event exists and says what was created and who it reached; an `uncertain` result is
reported as uncertain with its event id, never as created. Things to carry:

- **A booking that reaches nobody but the owner is applied at once** — a focus block, a private appointment — and
  journalled at the door. A write reaching anyone else always holds, and a commit with no anchor still holds.
- **Every write goes to the owner's own `primary` and nowhere else**, re-checked at prepare, at commit and at apply;
  an intent prepared under one account is refused by a session bound to another rather than written to the
  wrong diary.
- **"Reaches someone" is decided from before AND after.** Removing the last guest still reaches them; an
  organiser who is not the owner, a room, an attendee list Google would not return in full, and a participant
  with no address this door can read all hold too. "The owner" is whoever Google marks `self`, then whoever
  matches the bound address — an alias on the owner's own calendar is still the owner.
- **Editing the event invalidates the digest**, so the owner's yes cannot be moved onto a change nobody read:
  tell the owner what changed and commit on their new word. There is no override: `$SLOPWEAVER_DOOR_OVERRIDE` cannot waive
  this hold.
- **An accepted write is not a delivered invitation.** Report what Google reported; it mails attendees on
  its own schedule, and a Meet link can arrive after the write returns.

Forms, recurrence, RSVPs and what an uncertain write means: [writing.md](reference/writing.md).

## Which grant, and which verbs it unlocks

| verb        | capability    | scope                                                                                   |
| ----------- | ------------- | --------------------------------------------------------------------------------------- |
| `connect`   | —             | requests the union below, plus `userinfo.email` so it can record which account it bound |
| `calendars` | `calendars`   | `calendar.readonly` (and `calendar.settings.readonly` for the time zone)                |
| `list`      | `events`      | `calendar.events.readonly`, satisfied also by `calendar.readonly`                       |
| `read`      | `events`      | `calendar.events.readonly`, satisfied also by `calendar.readonly`                       |
| `free`      | `freebusy`    | `calendar.freebusy`, satisfied also by `calendar.readonly` — never by `events.readonly` |
| every write | `ownedEvents` | `calendar.events.owned`, plus `events` to read the target back — `--grant meetings`     |

`--grant read` (the default) asks for the three read scopes, which also answer `free`. `--grant events`
asks for the narrow event scope only, and on it `calendar calendars` and `calendar free` refuse BY NAME
rather than returning an empty answer. `--grant meetings` is `read` plus the one write scope, and it is what every write verb needs. A verb
missing its scope refuses before the call and names exactly what to approve; see
[connecting.md](reference/connecting.md).

## Meeting prep — `calendar prep-due`

The standing row `meeting-prep-hourly` runs `calendar prep-due` each hour. It reads the next four hours
(`--hours`, 1–24) of the owner's primary calendar and registers ONE `--dispatch` board row, `meeting-brief-<instance id>`,
for each meeting the owner will talk in that has no row and no tagged page yet: at most ten people, the owner included, an outside
attendee or not; never declined, cancelled, all-day or already started. It writes no brief; the visible seat that
takes the row briefs, `page publish`es and `page tag`s it ([page](../page/SKILL.md)). `--dry-run` registers nothing. Exit 3 is an empty window; exit 1 is a tag ledger with an
unparseable line, an incomplete listing, no declared checkout, or a failed row.

## Calendar in the corpus

`slopweaver refresh --source calendar` ingests events into the local corpus, so `store read` and `store cite`
can answer from the diary the way they answer from Slack or Linear. Four things follow:

- **It is opt-in by NAMING.** `--all-sources` does not include the calendar, exactly as it does not include
  the mailbox. So "the corpus has no calendar" and "it has calendar up to the last `--source calendar`
  run" are both live possibilities, and `slopweaver audit` is what distinguishes them. Do not assume either.
- **The corpus does NOT expand recurrences.** Bronze stores the recurring MASTER with its rule, plus any
  instance that was individually changed. That is the lossless capture; expansion is a projection. So "what
  is on next Tuesday" is a `calendar list` question, and "what did we agree in the architecture review" is
  a `store read` question.
- **A stored record is thinner than the live event.** The title, the description, the location and the
  attendee list with their replies — and every email address scrubbed to `[email]` on write, so who was in
  the room survives and how to reach them does not. A corpus answer can therefore be thinner than the live
  event, and `calendar read <id> --calendar <id>` is how you get the whole thing back.
- **Every record is private by source.** A diary is one person's, and its attendees never joined this
  workspace, so calendar records are treated exactly as the mailbox's are and can never be served to a
  non-owner. See `docs/security/calendar-boundary.md` § "The calendar boundary".

## Reading it well

- Lead with **what is on**, not with how you found it. A window with nothing in it says so in one line.
- **Name the calendar** whenever more than one was read — an event's id is only unique within its calendar,
  and `calendar read` takes `--calendar` for exactly that reason.
- **Quote the residue that changes the answer**, not all of it. "Only `primary` was read" matters when the
  owner has three calendars; "attachments were not read" rarely does.
- `--json` emits the shared provider-read document (freshness, coverage, residue, payload) for a caller that
  is going to compute rather than read.

## References

- [connecting.md](reference/connecting.md) — the one-time browser consent, what the grant is, and revoking it
- [reading.md](reference/reading.md) — windows, calendar ids, recurrence, and the residue lines in full
- [scheduling.md](reference/scheduling.md) — `free`: the zone, `--between`, and what a refusal means
- [writing.md](reference/writing.md) — the forms, the hold, the digest, and an uncertain write
