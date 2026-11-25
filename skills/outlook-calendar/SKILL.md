---
name: outlook-calendar
description: Read a personal Microsoft account's calendar (outlook.com, hotmail.com, live.com) live through the slopweaver door, over its own consent, separate from the Outlook mailbox — which calendars exist, what is on in a window with recurring events expanded, and one event in full — with explicit bounds and stated residue. Use when the user asks what is on their Outlook or Hotmail calendar, what an Outlook meeting is, who is in it, which Outlook calendars slopweaver can see, or to connect the Outlook calendar. Phrases like "what's on my outlook calendar", "my hotmail calendar this week", "read that outlook meeting", "who's in that outlook invite", "which outlook calendars can you see", "connect my outlook calendar".
argument-hint: connect [--status|--disconnect] | calendars | list [--calendar <id>] [--from <YYYY-MM-DD|iso>] [--days <1-90>] [--limit <1-1000>] | read <event-id>
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" outlook-calendar $ARGUMENTS` and report the result.

## The door, and what is behind it

`calendars`, `list` and `read` are the whole Outlook calendar read surface, and all three only READ: nothing
here books, moves, cancels or answers an invite. They speak Microsoft Graph through the official Graph SDK over
the client `src/live/outlook/session.ts` binds to the calendar grant. Never reach for raw HTTP, `curl`, a
Microsoft MCP tool or a browser scrape to do something a verb does not: the absence is the answer.

**History lives in the corpus, as the `outlook-calendar` source.** `refresh --source outlook-calendar` reads
every calendar whole the first time, then only what changed since the last pass (a modified-time anchor per
calendar, overlapped five minutes). Each event is one private record, a series as its master. An event deleted
at Microsoft keeps its record until a full pass (`--all`). These three verbs read Outlook LIVE, never that
copy; say which one answered.

**The calendar has its own consent.** `outlook-calendar connect` asks for `User.Read` and `Calendars.Read` and
nothing of the mailbox, and stores its own grant beside the mail one, under the same app registration
(`outlook-client-id`; the `outlook` skill's `reference/connecting.md` sets it up). `--status` reads that grant
from the file alone; `--disconnect` removes it and leaves the mail grant alone. With no calendar grant stored, both
say when a held mail grant still serves the calendar's reads (`readsOverMailGrant` under `--json`). Which grant a read uses:

- a stored calendar grant always wins, and one missing `Calendars.Read` is refused by name, naming
  `outlook-calendar connect`;
- with none stored, a held mail grant that already carries `Calendars.Read` or `Calendars.ReadWrite` (one made
  before the calendar had its own consent) keeps working;
- otherwise the read refuses as not connected, naming `outlook-calendar connect`.

The integrations page judges the Outlook Calendar row by its own grant alone, so on that older mail grant alone
the row reads as available while these reads still work.

## Three reads

- **`calendars`** lists every calendar the account holds or was shared, default first, each with the id
  `list --calendar` takes.
- **`list`** reads ONE calendar's window — the default one unless `--calendar` names another — EXPANDED into
  occurrences, in start order: from `--from` (a bare day is that day's UTC midnight; absent, now) for `--days`
  (default 7, at most 90), at most `--limit` events (default 50, at most 1,000). Every page is followed up to the
  limit, and a link still standing there makes the answer `INCOMPLETE`, said in the residue, never a clean short
  list. **The residue is part of the answer**: an event on another calendar is unread, not absent.
- **`read <event-id>`** reads one event in full: body as text, attendees with their replies, the rule when it is
  a series master, the join link, and the calendar that holds it. That calendar id is spelled differently from
  the one `calendars` prints (Microsoft's immutable ids do not cover calendars), but `list --calendar` takes
  either.

Every time is printed as a UTC instant. An all-day event prints as its bare date marked `(all day)`, never a
midnight. An event with no subject is busy time with no detail, never an empty hour.

**The output is UNREDACTED**: bodies and attendee addresses enter this session and leave the machine with it.

## Never put diary content in a commit

Nothing read here goes into a fixture, a test, a commit message or a pull request: a meeting carries other
people's names, addresses and plans. Tests use `example.test` values over a plain fake seam.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In Codex
it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
