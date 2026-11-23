/**
 * Lazy manifest for the `calendar` noun — the diary door.
 *
 * ## Two contracts, and the narrow one governs the reads
 *
 * `connect` writes a credential under `$SLOPWEAVER_HOME` and touches no calendar; `calendars`, `list`,
 * `read` and `free` change nothing anywhere, so none of them is `doorRouted` or `requiresApproval`. `prep-due`
 * reads the calendar the same way and writes only board rows on this machine, so it is not door-routed either.
 *
 * The six WRITE verbs — `book`, `edit`, `reschedule`, `cancel`, `respond` and `commit` — are the other
 * contract, and they matter more on a calendar than on most surfaces: creating, moving or cancelling an
 * event mails every attendee, which makes it an outward action aimed at other people. They go through the
 * door with their approval gate, in the shape `gmail send` already proved — a write that reaches anyone but
 * the owner HOLDS for the owner's yes, and there is no override. The credential is the outer rail: they ask for
 * `ownedEvents` (`calendar.events.owned`, granted by `connect --grant meetings`, the owner's
 * choice) and the read verbs never do, so a read-only install cannot reach a write by accident. The
 * per-verb capability table in `src/live/calendar/scopes.ts` is what makes that true, and the unit lane
 * asserts it.
 *
 * `dryParseSafe` is true of `calendars`, `list`, `read` and `free` in the narrow sense the field means: a bad flag
 * is refused by the pure parser in `../commands/calendar/core.js` before a credential is read. `list` and
 * `calendars` are ALSO valid with no arguments at all — a bare `calendar list` means "the next seven days on
 * my primary calendar" — so they are not no-args-safe and say so.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const CONNECT_USAGE =
  "usage: slopweaver calendar connect [--grant <read|events|meetings>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only (0600)\n" +
  "  --grant   which capabilities to request (default read)\n" +
  "            read   = calendar.readonly + calendar.events.readonly + calendar.settings.readonly\n" +
  "            events = calendar.events.readonly only — cannot list WHICH calendars exist\n" +
  "            meetings = read + calendar.events.owned, the ONE write scope: book, change and cancel on\n" +
  "                       calendars you own. Nothing wider, and never another person's calendar\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket, no network\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document\n" +
  "  Needs the USER-DATA Desktop-app OAuth client with the Calendar API enabled: `slopweaver secrets\n" +
  "  set google-client-id` and `slopweaver secrets set google-client-secret` — shared by the mail, Drive\n" +
  "  and calendar doors, and NOT by the Google Admin door. The grant records the scopes Google ACTUALLY\n" +
  "  approved, and is stored separately from Gmail's";

const CALENDARS_USAGE =
  "usage: slopweaver calendar calendars [--json] [--home <dir>]\n" +
  "  Lists every calendar this grant can see — display name, the ID the API takes, and the access role\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue\n" +
  "  Google's API takes calendar IDs and its interface shows NAMES; this is how you see both. It also\n" +
  "  reports the account's own default time zone, which is what an all-day event's day is read against";

const LIST_USAGE =
  "usage: slopweaver calendar list [--calendar <id>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\n" +
  "                                [--days <1..1100>] [--limit <1..500>] [--json] [--home <dir>]\n" +
  "  Lists the events in one window, ordered by start, with explicit bounds and stated residue\n" +
  "  --calendar a calendar ID (repeatable); defaults to `primary`, the account's own\n" +
  "  --from     the window's first day, inclusive (default today)\n" +
  "  --to       the window's last day, INCLUSIVE; overrides --days\n" +
  "  --days     how many days forward from --from (default 7)\n" +
  "  --limit    how many events to gather in total (default 50, maximum 500)\n" +
  "  --json     emit one machine-readable document with freshness, coverage and residue\n" +
  "  Recurring events are EXPANDED into instances here, because a human asking what is on means instances.\n" +
  "  `calendar read <master-id>` is what shows the rule itself, which lives on the master";

const READ_USAGE =
  "usage: slopweaver calendar read <event-id> [--calendar <id>] [--json] [--home <dir>]\n" +
  "  Reads one event in full — attendees and their replies, recurrence, conferencing, description\n" +
  "  --calendar which calendar holds it (default `primary`); an event ID is only unique within one\n" +
  "  --json     emit one machine-readable document with freshness, coverage and residue\n" +
  "  A CANCELLED event is reported rather than hidden, and says so. An event with no title is one the\n" +
  "  grant can only see as free/busy, or one the owner marked private — a blank hour is still a busy one";

/** `calendar free` usage. */
const FREE_USAGE =
  "usage: slopweaver calendar free --minutes <1..480> [--with <email>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\n" +
  "         [--days <1..1100>] [--between <HH:MM-HH:MM>] [--zone <IANA>] [--json] [--home <dir>]\n" +
  "  Finds the open stretches of at least --minutes across your own calendar and the people named,\n" +
  "  from Google's free/busy answer — a slot is an observation at read time, never a reservation\n" +
  "  --minutes  the meeting length a slot must fit (required)\n" +
  "  --with     a colleague's address (repeatable); your own primary calendar is always consulted\n" +
  "  --from     the window's first day, inclusive (default today)\n" +
  "  --to       the window's last day, inclusive; overrides --days\n" +
  "  --days     how many days forward from --from (default 7)\n" +
  "  --between  clip slots to these hours on each local day, e.g. 09:00-17:00 (default: whole day)\n" +
  "  --zone     the IANA zone --between and the rendering use (default: the account's own)\n" +
  "  --json     emit one machine-readable document with freshness, coverage and residue\n" +
  "  A calendar Google will not answer for makes common availability UNKNOWN, never free: the slot list\n" +
  "  is emptied and the residue names it. Needs the read grant; the narrow events grant refuses by name";

/** `calendar prep-due` usage. */
const PREP_DUE_USAGE =
  "usage: slopweaver calendar prep-due [--hours <1..24>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Reads the next --hours of your primary calendar and registers ONE board row per meeting you will talk in\n" +
  "  that has no brief yet: at most 10 people, outside attendees included. A town hall is not one. A seat\n" +
  "  briefs it, publishes the page and `page tag`s it, so the meeting-prep-due note floats it\n" +
  "  --hours    how far ahead to look (default 4); a meeting already started is never registered\n" +
  "  --dry-run  say which meetings would be registered, and register nothing\n" +
  "  --json     emit one machine-readable document: what was registered and why every other event was skipped\n" +
  "  A meeting with a row under its slug (meeting-brief-<instance id>) or a page tagged to it is skipped, so the\n" +
  "  hourly pass registers each meeting once. Exits 3 when nothing in the window is owed a brief, 1 when the\n" +
  "  tag ledger has a line it cannot parse, the listing is incomplete, no checkout is declared, or a row failed";

/** The write verbs' usage — one string each, so the manifest never imports the command module. */
const BOOK_USAGE =
  "usage: slopweaver calendar book --form <json|-> [--json] [--home <dir>]\n" +
  "  Proposes an event on your primary calendar: title, start/end as YYYY-MM-DDTHH:MM in a zone, attendees,\n" +
  "  a description, a location, and a Google Meet link by default when anyone is invited\n" +
  '  --form   {"title","start","end","zone"?,"attendees"?,"description"?,"location"?,"meet"?,"allDay"?} — `-` reads stdin\n' +
  "  With anyone but you on it the write HOLDS: the preview and its digest are printed, nothing is sent, and\n" +
  "  `calendar commit` is the second step (see its own help). With nobody else it is applied at once";
const EDIT_USAGE =
  "usage: slopweaver calendar edit <event-id> --form <json|-> [--json] [--home <dir>]\n" +
  "  Changes the named fields of one event on your primary calendar; the others are left exactly as they are\n" +
  '  --form   {"title"?,"description"?,"location"?,"attendees"?} — attendees is the WHOLE set after; `-` reads stdin\n' +
  "  Holds whenever the change reaches anyone but you, removing someone included";
const RESCHEDULE_USAGE =
  "usage: slopweaver calendar reschedule <event-id> --form <json|-> [--json] [--home <dir>]\n" +
  "  Moves one event's time on your primary calendar (a patch of start/end, never a transfer to another calendar)\n" +
  '  --form   {"start":"YYYY-MM-DDTHH:MM","end","zone"?,"allDay"?} — `-` reads stdin\n' +
  "  Holds whenever anyone but you is on the event";
const CANCEL_USAGE =
  "usage: slopweaver calendar cancel <event-id> [--json] [--home <dir>]\n" +
  "  Cancels one event on your primary calendar; the preview names who is told. Holds whenever it has attendees";
const RESPOND_USAGE =
  "usage: slopweaver calendar respond <event-id> --form <json|-> [--json] [--home <dir>]\n" +
  "  Sets your own RSVP on an invitation. The organiser sees it, so this ALWAYS holds for your yes\n" +
  '  --form   {"response":"accepted"|"declined"|"tentative","comment"?} — `-` reads stdin';
const COMMIT_USAGE =
  "usage: slopweaver calendar commit <intent-id> --anchor <where they said yes> | --approve <digest> [--json] [--home <dir>]\n" +
  "  The second step for a held write: re-reads the event as Google holds it NOW, rebuilds the preview and its\n" +
  "  digest, and sends only on an exact match. --anchor (talk-call:, talk:, transcript:) reads the owner's whole\n" +
  "  words there, matches the digest the preview printed, and journals the anchor; --approve matches the digest\n" +
  "  given. A changed event or form stops the old digest matching, so an approval never carries over a change\n" +
  "  nobody read. With neither it holds. Not waivable by $SLOPWEAVER_DOOR_OVERRIDE";

/** The meta every write verb shares: an external write through the door, refused before any I/O on a bad tail. */
function writeMeta({
  example,
  summary,
  usage,
  dryParseSafe,
}: {
  example: string;
  summary: string;
  usage: string;
  dryParseSafe: boolean;
}): VerbManifestEntry["meta"] {
  return {
    createsWorkItem: false,
    diagnostic: false,
    doorRouted: true,
    dryParseSafe,
    effect: "external-write",
    example,
    // Approval is a property of the REQUEST, decided per write by whether it reaches anyone but the owner;
    // the shell sets `requiresApproval` on the door request from that verdict and carries the branded gate.
    parseRejectIsIoFree: true,
    summary,
    usage,
  };
}

export const calendarManifest: Readonly<Record<string, VerbManifestEntry>> = {
  book: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarBookCommand),
    // `--form` is required, so a bare `calendar book` refuses on the pure parser, having read nothing.
    meta: writeMeta({
      dryParseSafe: true,
      example:
        'printf %s \'{"title":"Sync","start":"2026-09-17T15:00","end":"2026-09-17T15:30","attendees":["a@example.com"]}\' | slopweaver calendar book --form -',
      summary:
        "Propose an event on your primary calendar, inviting the people named with a Meet link; holds for your yes when it reaches anyone",
      usage: BOOK_USAGE,
    }),
  }),
  calendars: lazy({
    load: () => import("../commands/calendar/readRun.js").then((m) => m.calendarCalendarsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `calendar calendars` is a valid whole-vocabulary read, so it is not no-args-safe; its
      // REJECT path is — an unknown flag is refused before a credential is read.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver calendar calendars --json",
      parseRejectIsIoFree: true,
      summary: "List every calendar this grant can see — display name, the ID the API takes, and the access role",
      usage: CALENDARS_USAGE,
    },
  }),
  cancel: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarCancelCommand),
    meta: writeMeta({
      dryParseSafe: true,
      example: "slopweaver calendar cancel 6h1s9r0k4p2m8n3q",
      summary: "Cancel one event on your primary calendar; holds for your yes whenever it has attendees",
      usage: CANCEL_USAGE,
    }),
  }),
  commit: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarCommitCommand),
    meta: writeMeta({
      dryParseSafe: true,
      example: "slopweaver calendar commit 3f2a… --anchor talk-call:aaaaaaaa-…#turn_…",
      summary:
        "Send a held calendar write on the owner's anchored yes (or a digest), after re-reading the event and matching the rebuilt digest",
      usage: COMMIT_USAGE,
    }),
  }),
  connect: lazy({
    load: () => import("../commands/calendar/connectRun.js").then((m) => m.calendarConnectCommand),
    meta: {
      createsWorkItem: false,
      // Not a diagnostic: `--status` reporting "not connected" is a finding, but the flow itself either
      // stores a grant or fails, and a failed consent is a broken run rather than a reported state.
      diagnostic: false,
      doorRouted: false,
      // NOT dryParseSafe, and the distinction is the point: a bare `calendar connect` is a valid invocation
      // that opens a socket and a browser, so "no args does nothing" is false of it. The narrower claim IS
      // true — a bad flag or an unknown `--grant` is refused by the pure parser before any of that.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver calendar connect --grant read",
      parseRejectIsIoFree: true,
      summary: "Authorise a Google Calendar by browser consent and store the grant owner-only under this home",
      usage: CONNECT_USAGE,
    },
  }),
  edit: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarEditCommand),
    meta: writeMeta({
      dryParseSafe: true,
      example:
        'printf %s \'{"title":"Sync (moved room)","location":"Level 3"}\' | slopweaver calendar edit 6h1s9r0k4p2m8n3q --form -',
      summary:
        "Change the named fields of one event on your primary calendar; holds whenever it reaches anyone but you",
      usage: EDIT_USAGE,
    }),
  }),
  free: lazy({
    load: () => import("../commands/calendar/freeRun.js").then((m) => m.calendarFreeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Genuinely no-args-safe: `--minutes` is required, so a bare `calendar free` refuses on the pure
      // parser, having read nothing.
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver calendar free --minutes 30 --with colleague@example.com --days 5 --between 09:00-17:00",
      parseRejectIsIoFree: true,
      summary: "Find the open stretches across your calendar and the people named, from Google's free/busy",
      usage: FREE_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/calendar/readRun.js").then((m) => m.calendarListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `calendar list` is a valid next-seven-days read, so it is not no-args-safe; its REJECT path
      // is — an unparseable `--days` or `--from` is refused before a credential is read.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver calendar list --days 14 --limit 100",
      parseRejectIsIoFree: true,
      summary: "List the events in one window across one or more calendars, recurring events expanded",
      usage: LIST_USAGE,
    },
  }),
  "prep-due": lazy({
    load: () => import("../commands/calendar/prepDueRun.js").then((m) => m.calendarPrepDueCommand),
    meta: {
      // It writes board rows, local to this machine; the calendar itself is only read.
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      // A bare `calendar prep-due` is the real hourly pass, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver calendar prep-due --hours 6 --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Register one board row per upcoming meeting the owner will talk in that has no brief yet, for a seat to brief and tag",
      usage: PREP_DUE_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/calendar/readRun.js").then((m) => m.calendarReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Genuinely no-args-safe: `calendar read` with no id refuses on the pure parser, having read nothing.
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver calendar read 6h1s9r0k4p2m8n3q --calendar primary",
      parseRejectIsIoFree: true,
      summary: "Read one event in full — attendees, recurrence and conferencing — with stated residue",
      usage: READ_USAGE,
    },
  }),
  reschedule: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarRescheduleCommand),
    meta: writeMeta({
      dryParseSafe: true,
      example:
        'printf %s \'{"start":"2026-09-18T10:00","end":"2026-09-18T10:30"}\' | slopweaver calendar reschedule 6h1s9r0k4p2m8n3q --form -',
      summary: "Move one event's time on your primary calendar; holds whenever anyone but you is on it",
      usage: RESCHEDULE_USAGE,
    }),
  }),
  respond: lazy({
    load: () => import("../commands/calendar/writeRun.js").then((m) => m.calendarRespondCommand),
    meta: writeMeta({
      dryParseSafe: true,
      example: 'printf %s \'{"response":"accepted"}\' | slopweaver calendar respond 6h1s9r0k4p2m8n3q --form -',
      summary: "Set your own RSVP on an invitation; the organiser sees it, so it always holds for your yes",
      usage: RESPOND_USAGE,
    }),
  }),
};
