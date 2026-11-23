# Reading a calendar

## Which calendars exist

```bash
slopweaver calendar calendars          # name, the ID the API takes, access role, zone, ticked or not
slopweaver calendar calendars --json
```

Google's API addresses calendars by **ID** and its interface shows **names**; this is how you see both. The
account's own is `primary`, and every other id is usually an email address.

Two columns carry meaning a reader will otherwise miss:

- **`access`** is what THIS GRANT can do with that calendar. A `freeBusyReader` sees times and no titles, so
  every event on it will come back titleless — that is the grant, not an empty diary.
- **`ticked` / `unticked`** is whether the owner has it selected in the Google Calendar interface. An
  unticked calendar still holds events and `calendar list --calendar <id>` still reads them.

It also reports the account's **default time zone**, or `(not established)` when the grant does not carry
`calendar.settings.readonly`.

## What is on

```bash
slopweaver calendar list                                   # the next 7 days on `primary`
slopweaver calendar list --days 14
slopweaver calendar list --from 2001-01-01 --to 2001-01-30  # --to is INCLUSIVE
slopweaver calendar list --calendar primary --calendar team@example.test
slopweaver calendar list --limit 200 --json
```

`--calendar` repeats and the results are re-sorted by start ACROSS calendars — Google orders within one
calendar only, so an unsorted concatenation would read as chronological while not being.

`--to` is inclusive to a reader and exclusive to Google, and the parser adds the day. That is the one
silently-wrong outcome in this door: get it wrong and the last day of every window vanishes without anything
failing.

## One event in full

```bash
slopweaver calendar read 6h1s9r0k4p2m8n3q
slopweaver calendar read 6h1s9r0k4p2m8n3q --calendar team@example.test
```

An event id is only unique **within one calendar**, which is why `--calendar` exists and why the document's
address is `<calendar>/<event>`. The read carries attendees and their replies (rooms and optional attendees
included, never filtered out), the recurrence rule when it is a master, the Meet/Zoom/Teams join URL, the
description, and whether the event shows as busy or free.

## The residue, in full

| line                                                          | when it appears                     | what it means                                           |
| ------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `stopped at the N-event cap`                                  | more matched than `--limit` allowed | the window is not fully read; raise `--limit`           |
| `this is ONE window across N calendar(s)`                     | always, on a listing                | an event outside it is unread, not absent               |
| `recurring events are EXPANDED into instances`                | always, on a listing                | the rule lives on the master, not here                  |
| `N event(s) carried no title`                                 | any titleless event                 | free/busy-only access, or a private event — a busy hour |
| `this is the recurring MASTER`                                | reading a master                    | its instances are computed and not listed               |
| `this is one INSTANCE of …`                                   | reading a changed instance          | the rule lives on the named master                      |
| `this event is CANCELLED`                                     | a cancelled event                   | reported rather than hidden; it did not happen          |
| `attachments and the event's own change history are not read` | always, on a read                   | this is the event as it stands now                      |
| `the account's own default time zone was NOT established`     | no settings scope                   | an all-day day cannot be tied to a zone                 |
