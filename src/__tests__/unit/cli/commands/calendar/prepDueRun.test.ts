/**
 * Unit: the `calendar prep-due` shell over plain fake seams — what it registers, what it refuses to read past, and
 * the exit code the hourly standing row stamps or reports. No Google account, no board.
 */
import { describe, expect, it } from "vitest";

import { type CalendarPrepDueDeps, runCalendarPrepDue } from "../../../../../cli/commands/calendar/prepDueRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { CalendarErrors } from "../../../../../live/calendar/errors.js";
import type { EventAttendee, ParsedCalendarEvent } from "../../../../../live/calendar/parse.js";
import { prepRowSlug } from "../../../../../live/calendar/prepDue.js";
import { type CalendarListingResult, MAX_LIST_LIMIT } from "../../../../../live/calendar/read.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

const NOW = new Date("2026-10-08T20:05:00.000Z");
const HOME = "/fake/home";
const CHECKOUT = "/fake/checkout/slopweaver";
const ACCOUNT = "owner@acme.com";

function person({ email, self = false }: { email: string; self?: boolean }): EventAttendee {
  return { displayName: undefined, email, optional: false, resource: false, responseStatus: "accepted", self };
}

/* A seven-person platform stand-up at the given instant, under the given instance id. */
function standup({ id, startIso }: { id: string; startIso: string }): ParsedCalendarEvent {
  return {
    attendees: [
      person({ email: ACCOUNT, self: true }),
      ...Array.from({ length: 6 }, (_, index) => person({ email: `c${String(index)}@acme.com` })),
    ],
    calendarId: "primary",
    conferenceUrl: undefined,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: undefined,
    htmlLink: undefined,
    iCalUID: undefined,
    id,
    location: undefined,
    organizerEmail: undefined,
    recurrence: [],
    recurringEventId: undefined,
    start: { dateTime: startIso, kind: "timed", timeZone: undefined },
    status: "confirmed",
    summary: "Platform team standup",
    transparency: undefined,
    updatedIso: undefined,
    visibility: undefined,
  };
}

const STANDUP = standup({ id: "a45i_20261008T230000Z", startIso: "2026-10-08T23:00:00Z" });
const LATER = standup({ id: "b77k_20261008T233000Z", startIso: "2026-10-08T23:30:00Z" });

function listingOf({
  events,
  complete,
  account = ACCOUNT,
}: {
  events: readonly ParsedCalendarEvent[];
  complete: boolean;
  account?: string;
}): CalendarListingResult {
  return {
    document: {
      coverage: { detail: "", kind: "bounded", residue: [] },
      data: {},
      readAtIso: NOW.toISOString(),
      source: "calendar",
      target: { address: "w", identity: account, kind: "event window" },
    },
    listing: { account, calendarIds: ["primary"], complete, events, timeMaxIso: "", timeMinIso: "" },
  };
}

/** What the fakes saw, and the seams themselves. */
interface Harness {
  readonly deps: CalendarPrepDueDeps;
  readonly calls: string[];
  readonly registered: (readonly string[])[];
  readonly out: string[];
  readonly diagnostics: string[];
}

function harness({
  events = [STANDUP],
  tagged = ok(new Set<string>()),
  taggedAtWrite = tagged,
  existing = new Set<string>(),
  registerCode = () => EXIT_OK,
  raceWinner = new Set<string>(),
  checkout = ok(CHECKOUT),
  listFails = false,
  complete = true,
  boardUnread = undefined,
  nowAtWrite = NOW,
  account = ACCOUNT,
  organisation = ok(ACME_ORGANISATION),
}: {
  /** The Google account the calendar listing is bound to. */
  account?: string;
  /** What the organisation read answers; Acme unless a case drives an install with none written. */
  organisation?: Awaited<ReturnType<CalendarPrepDueDeps["organisation"]>>;
  events?: readonly ParsedCalendarEvent[];
  tagged?: ReturnType<CalendarPrepDueDeps["taggedEventIds"]>;
  /** What every read after the first answers: a tag that landed between selection and the write. */
  taggedAtWrite?: ReturnType<CalendarPrepDueDeps["taggedEventIds"]>;
  existing?: Set<string>;
  registerCode?: (args: { slug: string }) => number;
  raceWinner?: Set<string>;
  checkout?: ReturnType<CalendarPrepDueDeps["checkout"]>;
  listFails?: boolean;
  complete?: boolean;
  /** Why the board would not read whole, when it should not. */
  boardUnread?: string | undefined;
  /** What every clock read after the first answers: the instant the pass reaches a meeting's write. */
  nowAtWrite?: Date;
} = {}): Harness {
  let clockReads = 0;
  const calls: string[] = [];
  const registered: (readonly string[])[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const rows = new Set(existing);
  return {
    calls,
    deps: {
      checkout: () => {
        calls.push("checkout");
        return checkout;
      },
      list: async ({ calendarIds, timeMinIso, timeMaxIso, limit }) => {
        calls.push(`list:${calendarIds.join("+")}:${timeMinIso}..${timeMaxIso}:${String(limit)}`);
        return listFails ? err(CalendarErrors.notConnected()) : ok(listingOf({ account, complete, events }));
      },
      now: () => {
        clockReads += 1;
        return clockReads === 1 ? NOW : nowAtWrite;
      },
      organisation: async () => {
        calls.push("organisation");
        return organisation;
      },
      registerRow: async ({ argv }) => {
        const slug = argv[argv.indexOf("--slug") + 1]!;
        registered.push(argv);
        if (raceWinner.has(slug)) {
          rows.add(slug);
        }
        return registerCode({ slug });
      },
      claimedSlugs: () => (boardUnread === undefined ? ok(new Set(rows)) : err(boardUnread)),
      taggedEventIds: () => {
        calls.push("tags");
        return calls.filter((call) => call === "tags").length === 1 ? tagged : taggedAtWrite;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    registered,
  };
}

describe("runCalendarPrepDue", () => {
  it("registers one seated dispatch row for the stand-up, against the running checkout", async () => {
    const run = harness();
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_OK);
    expect(run.calls).toEqual([
      "tags",
      "checkout",
      "organisation",
      `list:primary:2026-10-08T20:05:00.000Z..2026-10-09T00:05:00.000Z:${String(MAX_LIST_LIMIT)}`,
      "tags",
    ]);
    expect(run.registered).toHaveLength(1);
    const argv = run.registered[0]!;
    expect(argv.slice(0, 5)).toEqual(["node", "slopweaver", "handover", "register", "--ask"]);
    expect(argv.slice(6)).toEqual([
      "--dispatch",
      "--slug",
      "meeting-brief-a45i_20261008t230000z",
      "--asked-iso",
      "2026-10-08T20:05:00.000Z",
      "--workspace",
      "team",
      "--workspace-because",
      "the meeting this brief is for is in owner@acme.com, an account on acme.com",
      "--repo",
      CHECKOUT,
      "--home",
      HOME,
    ]);
    expect(run.out).toEqual([
      "registered  meeting-brief-a45i_20261008t230000z  2026-10-08T23:00:00.000Z  Platform team standup (small)",
    ]);
  });

  it("states no workspace for a meeting on a calendar connected under an account off the organisation's domain", async () => {
    const run = harness({ account: "someone@gmail.com" });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_OK);
    expect(run.registered).toHaveLength(1);
    const argv = run.registered[0]!;
    expect([argv.includes("--workspace"), argv.slice(-4)]).toEqual([false, ["--repo", CHECKOUT, "--home", HOME]]);
  });

  it("exits 3 and registers nothing when no meeting is in the window", async () => {
    const run = harness({ events: [] });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.registered).toEqual([]);
    expect(run.out).toEqual(["calendar prep-due: no meeting in the window"]);
  });

  it("skips a meeting whose row exists or whose page is tagged, and exits 3 for a fully briefed window", async () => {
    const run = harness({
      events: [STANDUP, LATER],
      existing: new Set([prepRowSlug({ eventId: STANDUP.id })]),
      tagged: ok(new Set([LATER.id])),
    });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.registered).toEqual([]);
    expect(run.out).toEqual([
      "skipped  a45i_20261008T230000Z  Platform team standup — a brief is already registered or tagged",
      "skipped  b77k_20261008T233000Z  Platform team standup — a brief is already registered or tagged",
    ]);
  });

  it("reports a dry run's candidates and registers nothing", async () => {
    const run = harness();
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME, "--dry-run"] })).toBe(EXIT_OK);
    expect(run.registered).toEqual([]);
    expect(run.out[0]).toBe(
      "would-register  meeting-brief-a45i_20261008t230000z  2026-10-08T23:00:00.000Z  Platform team standup (small)",
    );
  });

  it("reads a lost registration race as an existing row, not a failure", async () => {
    const slug = prepRowSlug({ eventId: STANDUP.id });
    const run = harness({ raceWinner: new Set([slug]), registerCode: () => EXIT_ERROR });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out[0]).toBe(`existing  ${slug}  2026-10-08T23:00:00.000Z  Platform team standup (small)`);
  });

  // A counterexample: a seat tagged a page to the stand-up after the pass read the ledger.
  it("re-reads the tag ledger at the write, so a page tagged since selection registers nothing", async () => {
    const run = harness({ taggedAtWrite: ok(new Set([STANDUP.id])) });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.registered).toEqual([]);
    expect(run.out).toEqual([
      `existing  ${prepRowSlug({ eventId: STANDUP.id })}  2026-10-08T23:00:00.000Z  Platform team standup (small)`,
    ]);
  });

  // A counterexample: the stand-up began while the pass was still reading its ledgers.
  it("re-reads the clock at the write, so a meeting that started during the reads registers nothing", async () => {
    const run = harness({ nowAtWrite: new Date("2026-10-08T23:00:00.000Z") });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.registered).toEqual([]);
    expect(run.out).toEqual([
      `started  ${prepRowSlug({ eventId: STANDUP.id })}  2026-10-08T23:00:00.000Z  Platform team standup (small)`,
    ]);
  });

  it("fails a meeting, registering nothing, when the tag ledger turns unreadable before the write", async () => {
    const run = harness({ taggedAtWrite: err("ledger has 1 line(s) it cannot parse") });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(run.registered).toEqual([]);
    expect(run.diagnostics).toEqual(["ledger has 1 line(s) it cannot parse"]);
  });

  it("registers every meeting and exits 1 when any one registration failed", async () => {
    const failing = prepRowSlug({ eventId: STANDUP.id });
    const run = harness({
      events: [STANDUP, LATER],
      registerCode: ({ slug }) => (slug === failing ? EXIT_ERROR : EXIT_OK),
    });
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(run.registered).toHaveLength(2);
    expect(run.out.map((line) => line.split("  ")[0])).toEqual(["failed", "registered"]);
  });

  it("fails the pass on an untrustworthy tag ledger, a failed listing, a capped listing or no checkout", async () => {
    const tags = harness({ tagged: err("ledger has 1 line(s) it cannot parse") });
    expect(await runCalendarPrepDue({ deps: tags.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(tags.diagnostics).toEqual(["ledger has 1 line(s) it cannot parse"]);
    expect(tags.calls).toEqual(["tags"]);

    const listing = harness({ listFails: true });
    expect(await runCalendarPrepDue({ deps: listing.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(listing.registered).toEqual([]);

    // A board doc that will not read may be the row that already claims the meeting.
    const board = harness({ boardUnread: "calendar prep-due: 1 doc(s) in /fake/home/handovers will not read" });
    expect(await runCalendarPrepDue({ deps: board.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(board.diagnostics).toEqual(["calendar prep-due: 1 doc(s) in /fake/home/handovers will not read"]);
    expect(board.registered).toEqual([]);

    // A counterexample: the walk stopped at its cap, and one of the events it read failed to parse,
    // so fewer than the cap came back. The listing's own `complete` is what says a meeting may be unread.
    const capped = harness({ complete: false, events: [STANDUP] });
    expect(await runCalendarPrepDue({ deps: capped.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(capped.diagnostics).toEqual([
      `calendar prep-due: the listing is not every event in the window — it stopped at its ${String(MAX_LIST_LIMIT)}` +
        "-event cap, or an event Google returned would not parse — so a meeting it missed would read as absent",
    ]);
    expect(capped.registered).toEqual([]);

    // A counterexample: an hour with nothing due must still fail an install with no checkout, or the
    // hourly row stamps every empty hour and fails only in the one a meeting needed.
    const checkout = harness({
      checkout: err(["calendar prep-due: no declared checkout is this repository"]),
      events: [],
    });
    expect(await runCalendarPrepDue({ deps: checkout.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(checkout.diagnostics).toEqual(["calendar prep-due: no declared checkout is this repository"]);
    expect(checkout.calls).toEqual(["tags", "checkout"]);
    expect(checkout.registered).toEqual([]);

    // The same for an install with no organisation written: the empty hour fails, before the listing is read.
    const unwritten = harness({
      events: [],
      organisation: err(["calendar prep-due: no organisation is configured in the store"]),
    });
    expect(await runCalendarPrepDue({ deps: unwritten.deps, rest: ["--home", HOME] })).toBe(EXIT_ERROR);
    expect(unwritten.diagnostics).toEqual(["calendar prep-due: no organisation is configured in the store"]);
    expect(unwritten.calls).toEqual(["tags", "checkout", "organisation"]);
    expect(unwritten.registered).toEqual([]);
  });

  it("refuses a malformed --hours before touching any seam", async () => {
    const run = harness();
    expect(await runCalendarPrepDue({ deps: run.deps, rest: ["--hours", "25"] })).toBe(EXIT_USAGE);
    expect(run.calls).toEqual([]);
    expect(run.diagnostics.join("\n")).toContain("--hours must be an integer between 1 and 24, got 25");
  });
});
