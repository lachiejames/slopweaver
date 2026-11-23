# Finding a time — `calendar free`

```bash
slopweaver calendar free --minutes 30 --with tobias@example.com --days 5 --between 09:00-17:00
slopweaver calendar free --minutes 60 --from 2001-01-15 --to 2001-01-16 --json
```

`free` asks Google's `freebusy.query` about the owner's primary calendar and every `--with` address in one
call (at most fifty calendars), merges every busy block into one set, takes the gaps inside the window, clips
each gap to `--between` on each local day, and prints the gaps at least `--minutes` long. `--minutes` is
required: a slot list with no meeting length is a list of every gap, which answers nothing.

## The window is local days, not UTC days

`--from`/`--to`/`--days` name DATES, exactly as `calendar list` does — but a slot search reads them as local
days in the zone, so "the next three days" starts at local midnight rather than at UTC midnight (which is
mid-morning in Melbourne and would drop the first morning). The zone is the account's own, from `calendar.settings.readonly`,
unless `--zone <IANA>` overrides it; with neither, the read falls back to UTC and SAYS so in its residue.

`--between HH:MM-HH:MM` is wall-clock on each local day in that zone, across DST edges. Without it every hour
is a candidate, including the night — the door never invents the owner's working week, so pass the owner's hours
or ask.

## What a colleague's calendar reveals, and what a refusal means

Free/busy on a colleague works whenever Google Workspace shares availability inside the organisation, which
is the default — MEASURED: a colleague's calendar answered with 8 busy blocks and no titles.
That is ALL it reveals: the hour is taken, never by what. A calendar shared as free/busy only and one shared
in full read the same here.

A calendar Google will not answer for (not shared, not found, outside the organisation) comes back as an
error entry, and the read treats that as **common availability UNKNOWN**: the slot list is emptied rather
than computed over the calendars that did answer, and the residue names the calendar and Google's reason.
Report it as "I cannot see X's calendar", never as "X is free" — booking over a day you cannot see is the
one wrong answer this verb exists to prevent.

## Residue, in full

- a slot is an observation at read time, not a reservation — nothing here holds it
- ONE window across the calendars named; a person not named is not consulted
- whether `--between` applied, or that every hour was a candidate
- whether the zone was the account's own or a fallback
- which calendar refused, and why, when any did
- a busy interval says the hour is taken, never by what

`--json` emits the shared provider-read document; `data.slots` is `undefined` (not `[]`) when availability
could not be established, so a caller cannot read a refusal as a full diary.
