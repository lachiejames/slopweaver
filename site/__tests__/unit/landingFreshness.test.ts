/*
 * The console takes its own landing reading only when the one it shows comes due against the landing cadence (the Pull
 * requests page's clock), cannot give GitHub's count, or cannot be counted as the owner's whole open population (the shell's
 * reading events), never looping on a census GitHub will not give. The per-reading backoff every page-owned reading
 * shares is `syncFreshness.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CADENCE_MINUTES } from "../../../src/review/readCadence";
import {
  countAgedFromOf,
  LANDING_CADENCE_MINUTES,
  landingDueOf,
  readingEventReasonOf,
  refreshReasonWords,
} from "../../lib/landingFreshness";
import { NO_READING_ID, SYNC_NOW_BY } from "../../lib/syncFreshness";

const NOW = Date.parse("2026-09-26T13:30:00.000Z");
const READ = [
  {
    kind: "read",
    pullRequests: [],
    repo: "lachiejames/slopweaver",
    startedAtIso: "2026-09-26T13:00:00.000Z",
    totalCount: 0,
    viewer: "me",
  },
] as const;
const UNREAD = [{ kind: "unread", repo: "lachiejames/slopweaver", why: "GitHub answered 502" }] as const;

describe("landingDueOf", () => {
  it("mirrors the cadence the tick's --if-due reads on", () => {
    expect(LANDING_CADENCE_MINUTES).toBe(DEFAULT_CADENCE_MINUTES);
  });

  it("keeps a reading 25 minutes old and calls one a second past due, so the new one lands inside the cadence", () => {
    expect([
      landingDueOf({ nowMs: NOW, observedAtIso: "2026-09-26T13:05:00.000Z" }),
      landingDueOf({ nowMs: NOW, observedAtIso: "2026-09-26T13:04:59.000Z" }),
    ]).toStrictEqual([false, true]);
  });

  it("calls the 58-minute-old tick reading met due, and an instant it cannot read due", () => {
    expect([
      landingDueOf({ nowMs: NOW, observedAtIso: "2026-09-26T12:32:00.000Z" }),
      landingDueOf({ nowMs: NOW, observedAtIso: "not a date" }),
    ]).toStrictEqual([true, true]);
  });
});

describe("readingEventReasonOf", () => {
  /** The reading's selection: the one repository READ and UNREAD carry an entry for. */
  const SELECTED = { author: "@me", includeDrafts: true, repos: [READ[0].repo] };
  const FRESH = "2026-09-26T13:20:00.000Z";
  type EventArgs = Parameters<typeof readingEventReasonOf>[0];
  const eventOf = (over: Partial<EventArgs>): ReturnType<typeof readingEventReasonOf> =>
    readingEventReasonOf({
      by: "tick-615",
      census: READ,
      gap: undefined,
      nowMs: NOW,
      observedAtIso: FRESH,
      selection: SELECTED,
      ...over,
    });

  it("names nothing over a fresh, read, countable reading, and nothing over an OLD one either: age is not an event", () => {
    expect([eventOf({}), eventOf({ observedAtIso: "2026-09-26T12:32:00.000Z" })]).toStrictEqual([undefined, undefined]);
  });

  it("names a reading that carries no census or an unread one", () => {
    expect([eventOf({ census: undefined }), eventOf({ census: UNREAD })]).toStrictEqual(["no-census", "census-unread"]);
  });

  it("names a census with no entry for a repository the reading was taken over as unread, whatever its age", () => {
    const acme = { author: "@me", includeDrafts: true, repos: ["acme/acme-admin"] };
    expect([
      eventOf({ census: [], selection: acme }),
      eventOf({ census: [], observedAtIso: "2026-09-26T12:32:00.000Z", selection: acme }),
      eventOf({ census: READ, selection: { ...acme, repos: [READ[0].repo, "acme/acme-admin"] } }),
    ]).toStrictEqual(["census-unread", "census-unread", "census-unread"]);
  });

  it("names a tick reading that left drafts out, the badge's only way to a number", () => {
    expect(eventOf({ gap: "drafts-excluded" })).toBe("drafts-excluded");
  });

  it("names the census before the population gap, since a population is judged only over a census that read", () => {
    expect(eventOf({ census: UNREAD, gap: "drafts-excluded" })).toBe("census-unread");
  });

  it("retries its own reading for a census only once the backoff has passed, so an unreadable one cannot loop", () => {
    expect([
      eventOf({ by: SYNC_NOW_BY, census: UNREAD, observedAtIso: "2026-09-26T13:20:00.001Z" }),
      eventOf({ by: SYNC_NOW_BY, census: UNREAD, observedAtIso: "2026-09-26T13:20:00.000Z" }),
    ]).toStrictEqual([undefined, "census-unread"]);
  });

  it("retries its own reading whose rows do not reconcile only once the backoff has passed", () => {
    expect([
      eventOf({ by: SYNC_NOW_BY, gap: "rows-short", observedAtIso: "2026-09-26T13:20:00.001Z" }),
      eventOf({ by: SYNC_NOW_BY, gap: "rows-short", observedAtIso: "2026-09-26T13:20:00.000Z" }),
    ]).toStrictEqual([undefined, "rows-short"]);
  });
});

describe("refreshReasonWords", () => {
  it("says why it establishes a reading when there is none to show", () => {
    expect(refreshReasonWords({ reason: "no-reading" })).toBe("the page had no landing reading it could show");
    expect(NO_READING_ID).toBe("none");
  });

  it("says why in the page's words", () => {
    expect(refreshReasonWords({ reason: "due" })).toBe(
      "the reading shown was 25 minutes old or more, against the 30-minute landing cadence",
    );
    expect(refreshReasonWords({ reason: "drafts-excluded" })).toBe(
      "the reading shown left drafts out, so the console is taking one with drafts included",
    );
    expect(refreshReasonWords({ reason: "rows-short" })).toBe(
      "GitHub's open list and the reading's rows did not reconcile, so the console is taking a fresh reading",
    );
    expect(refreshReasonWords({ reason: "census-unread" })).toBe(
      "the reading shown did not read GitHub's open list for every repository it was taken over",
    );
  });
});

describe("countAgedFromOf", () => {
  it("ages the count from the earliest census start, which the reading's own instant comes after", () => {
    const census = [
      { ...READ[0], repo: "acme/acme-admin", startedAtIso: "2026-09-26T12:57:30.000Z" },
      { ...READ[0], startedAtIso: "2026-09-26T12:58:00.000Z" },
      UNREAD[0],
    ];
    expect(countAgedFromOf({ census, observedAtIso: "2026-09-26T13:00:00.000Z" })).toBe("2026-09-26T12:57:30.000Z");
  });

  it("ages from the reading's own instant when it carries no census", () => {
    expect(countAgedFromOf({ census: undefined, observedAtIso: "2026-09-26T13:00:00.000Z" })).toBe(
      "2026-09-26T13:00:00.000Z",
    );
  });
});
