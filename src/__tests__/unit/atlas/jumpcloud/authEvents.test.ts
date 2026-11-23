import { describe, expect, it } from "vitest";

import {
  authEventsPageBody,
  closeAuthFold,
  emptyAuthFold,
  foldAuthPage,
  JUMPCLOUD_AUTH_EVENT_TYPES,
  JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT,
  JUMPCLOUD_AUTH_SERVICES,
  parseSearchAfter,
  projectAuthEvents,
} from "../../../../atlas/jumpcloud/authEvents.js";
import { resolveAuthWindow } from "../../../../atlas/jumpcloud/authWindow.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One raw event as Directory Insights writes it, so a test says only what it is varying. */
const rawEvent = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_type: "user_login_attempt",
  jc_initiated_by_email: "holly.upton@acme.com",
  jc_initiated_by_username: "holly.upton",
  service: "directory",
  success: true,
  timestamp: "2026-09-14T23:59:27Z",
  ...over,
});

describe("authEventsPageBody", () => {
  it("asks for exactly ONE service, which is the only spelling the provider serves", () => {
    const body = authEventsPageBody({
      endIso: "2026-09-15T00:00:00Z",
      searchAfter: null,
      service: "directory",
      startIso: "2026-06-18T00:00:00Z",
    });
    expect(body["service"]).toEqual(["directory"]);
    expect(body["start_time"]).toBe("2026-06-18T00:00:00Z");
    expect(body["end_time"]).toBe("2026-09-15T00:00:00Z");
    expect(body["limit"]).toBe(JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT);
  });

  it("asks newest-first, which is what makes a truncated walk's rows correct rather than provisional", () => {
    const body = authEventsPageBody({
      endIso: "2026-09-15T00:00:00Z",
      searchAfter: null,
      service: "sso",
      startIso: "2026-09-01T00:00:00Z",
    });
    expect(body["sort"]).toBe("DESC");
  });

  it("omits the cursor entirely on the first page rather than sending an empty one", () => {
    const first = authEventsPageBody({
      endIso: "2026-09-15T00:00:00Z",
      searchAfter: null,
      service: "sso",
      startIso: "2026-09-01T00:00:00Z",
    });
    expect("search_after" in first).toBe(false);
  });

  it("sends a later page's cursor as the ARRAY the provider parses, never as its header text", () => {
    const later = authEventsPageBody({
      endIso: "2026-09-15T00:00:00Z",
      searchAfter: [1789427630640, "6aa87fae8395abff58bfb5fb"],
      service: "directory",
      startIso: "2026-09-01T00:00:00Z",
    });
    expect(later["search_after"]).toEqual([1789427630640, "6aa87fae8395abff58bfb5fb"]);
  });
});

describe("parseSearchAfter", () => {
  it("parses the JSON array the X-Search_after header carries as text", () => {
    expect(parseSearchAfter({ raw: '[1789427630640, "6aa87fae8395abff58bfb5fb"]' })).toEqual([
      1789427630640,
      "6aa87fae8395abff58bfb5fb",
    ]);
  });

  it("reads an absent or empty header as no cursor at all", () => {
    expect(parseSearchAfter({ raw: null })).toBe(null);
    expect(parseSearchAfter({ raw: "" })).toBe(null);
  });

  it("reads a cursor that is not a JSON array as none, rather than sending one the provider refuses", () => {
    expect(parseSearchAfter({ raw: "not json" })).toBe(null);
    expect(parseSearchAfter({ raw: '{"after":1}' })).toBe(null);
  });
});

describe("the named service and event-type lists", () => {
  it("names the five auth services and none of the ones that fire without a person", () => {
    expect(JUMPCLOUD_AUTH_SERVICES).toEqual(["directory", "ldap", "radius", "sso", "systems"]);
    expect(JUMPCLOUD_AUTH_SERVICES.includes("mdm")).toBe(false);
    expect(JUMPCLOUD_AUTH_SERVICES.includes("all")).toBe(false);
  });

  it("names both spellings of a login, because the two services disagree about it", () => {
    expect(JUMPCLOUD_AUTH_EVENT_TYPES.includes("login_attempt")).toBe(true);
    expect(JUMPCLOUD_AUTH_EVENT_TYPES.includes("user_login_attempt")).toBe(true);
    expect(JUMPCLOUD_AUTH_EVENT_TYPES.includes("sso_auth")).toBe(true);
    expect(JUMPCLOUD_AUTH_EVENT_TYPES.includes("admin_login_attempt")).toBe(true);
  });
});

describe("projectAuthEvents", () => {
  it("keeps the seven fields a dormancy read uses and nothing else", () => {
    const events = unwrap(
      projectAuthEvents({ body: [rawEvent({ client_ip: "203.0.113.4", id: "abc" })], service: "directory" }),
    );
    expect(events.length).toBe(1);
    expect(events[0]!.email).toBe("holly.upton@acme.com");
    expect(events[0]!.username).toBe("holly.upton");
    expect(events[0]!.eventType).toBe("user_login_attempt");
    expect(events[0]!.service).toBe("directory");
    expect(events[0]!.success).toBe(true);
    expect(events[0]!.timestampIso).toBe("2026-09-14T23:59:27Z");
    expect(events[0]!.atMs).toBe(Date.parse("2026-09-14T23:59:27Z"));
    expect(Object.keys(events[0]!).toSorted()).toEqual([
      "atMs",
      "email",
      "eventType",
      "service",
      "success",
      "timestampIso",
      "username",
    ]);
  });

  it("lowercases the email, because it is the key every other dormancy signal joins on", () => {
    const events = unwrap(
      projectAuthEvents({
        body: [rawEvent({ jc_initiated_by_email: "Holly.Upton@Acme.com" })],
        service: "directory",
      }),
    );
    expect(events[0]!.email).toBe("holly.upton@acme.com");
  });

  it("reads a systems login's flat username past its null jc_initiated_by_username", () => {
    const events = unwrap(
      projectAuthEvents({
        body: [
          {
            event_type: "login_attempt",
            initiated_by: { type: "user", username: "lenaward" },
            jc_initiated_by_email: "lena.ward@acme.com",
            jc_initiated_by_username: null,
            service: "systems",
            success: true,
            timestamp: "2026-09-14T23:59:59.257Z",
            username: "lenaward",
          },
        ],
        service: "systems",
      }),
    );
    expect(events[0]!.username).toBe("lenaward");
    expect(events[0]!.email).toBe("lena.ward@acme.com");
  });

  it("falls back to the actor record's username when the event carries neither flat field", () => {
    const events = unwrap(
      projectAuthEvents({
        body: [
          {
            event_type: "sso_auth",
            initiated_by: { administrator: false, type: "user", username: "jonahyates" },
            service: "sso",
            success: null,
            timestamp: "2026-09-14T23:59:44Z",
          },
        ],
        service: "sso",
      }),
    );
    expect(events[0]!.username).toBe("jonahyates");
    expect(events[0]!.email).toBe(null);
  });

  it("treats an unstated success as not-a-failure, which is what keeps SSO in the answer at all", () => {
    const events = unwrap(
      projectAuthEvents({ body: [rawEvent({ event_type: "sso_auth", success: null })], service: "sso" }),
    );
    expect(events[0]!.success).toBe(true);
  });

  it("attributes a row stating no service of its own to the service it was asked of", () => {
    const events = unwrap(projectAuthEvents({ body: [rawEvent({ service: undefined })], service: "ldap" }));
    expect(events[0]!.service).toBe("ldap");
  });

  it("skips a row with no instant, an unparseable one, or no actor at all", () => {
    const events = unwrap(
      projectAuthEvents({
        body: [
          rawEvent({ timestamp: undefined }),
          rawEvent({ timestamp: "not-an-instant" }),
          rawEvent({ event_type: undefined }),
          { event_type: "user_login_attempt", service: "directory", timestamp: "2026-09-14T23:59:27Z" },
          "a bare string",
        ],
        service: "directory",
      }),
    );
    expect(events.length).toBe(0);
  });

  it("refuses a page that is not the array Directory Insights answers", () => {
    const failure = unwrapErr(projectAuthEvents({ body: { results: [] }, service: "directory" }));
    expect(failure.code).toBe("UNEXPECTED_SHAPE");
    expect(failure.message).toContain("JSON array of events");
  });
});

describe("foldAuthPage", () => {
  it("keeps the newest authentication per identity, first-wins over a DESC walk", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [
            rawEvent({ timestamp: "2026-09-14T09:00:00.000Z" }),
            rawEvent({ timestamp: "2026-07-02T09:00:00.000Z" }),
          ],
          service: "directory",
        }),
      ),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.lastAuth.length).toBe(1);
    expect(fold.lastAuth[0]!.lastAuthIso).toBe("2026-09-14T09:00:00.000Z");
  });

  it("orders by instant and not by ISO text, which this endpoint's mixed precisions demand", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [
            rawEvent({ timestamp: "2026-09-14T09:00:00Z" }),
            rawEvent({ timestamp: "2026-09-14T09:00:00.500123456Z" }),
          ],
          service: "directory",
        }),
      ),
      state,
    });
    expect(closeAuthFold({ state }).lastAuth[0]!.lastAuthIso).toBe("2026-09-14T09:00:00.500123456Z");
  });

  it("merges one person's two service usernames onto their one email", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [
            {
              event_type: "login_attempt",
              jc_initiated_by_email: "lena.ward@acme.com",
              service: "systems",
              success: true,
              timestamp: "2026-09-14T23:00:00Z",
              username: "lenaward",
            },
          ],
          service: "systems",
        }),
      ),
      state,
    });
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [
            rawEvent({
              jc_initiated_by_email: "lena.ward@acme.com",
              jc_initiated_by_username: "lena.ward",
              timestamp: "2026-09-10T01:00:00Z",
            }),
          ],
          service: "directory",
        }),
      ),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.lastAuth.length).toBe(1);
    expect(fold.lastAuth[0]!.identity).toBe("lena.ward@acme.com");
    expect(fold.lastAuth[0]!.identityKind).toBe("email");
    expect(fold.lastAuth[0]!.lastAuthIso).toBe("2026-09-14T23:00:00Z");
  });

  it("keys an identity that never carried an email by its username, and says which it did", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [
            {
              event_type: "sso_auth",
              initiated_by: { username: "svc.scanner" },
              service: "sso",
              timestamp: "2026-09-14T23:00:00Z",
            },
          ],
          service: "sso",
        }),
      ),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.lastAuth[0]!.identity).toBe("svc.scanner");
    expect(fold.lastAuth[0]!.identityKind).toBe("username");
  });

  it("counts a failed attempt as read and never records it as a last authentication", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(projectAuthEvents({ body: [rawEvent({ success: false })], service: "directory" })),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.eventsRead).toBe(1);
    expect(fold.lastAuth.length).toBe(0);
  });

  it("drops an event type the allowlist does not name and REPORTS which one", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [rawEvent({ event_type: "user_update_provision" }), rawEvent({ event_type: "association_change" })],
          service: "directory",
        }),
      ),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.droppedNotAuth).toBe(2);
    expect(fold.unrecognisedEventTypes).toEqual(["association_change", "user_update_provision"]);
    expect(fold.lastAuth.length).toBe(0);
  });

  it("carries the oldest instant it reached across services, which is the bound a silence rests on", () => {
    const state = emptyAuthFold();
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({ body: [rawEvent({ timestamp: "2026-09-10T00:00:00Z" })], service: "directory" }),
      ),
      state,
    });
    foldAuthPage({
      events: unwrap(
        projectAuthEvents({
          body: [rawEvent({ jc_initiated_by_email: "other@acme.com", timestamp: "2026-08-02T00:00:00Z" })],
          service: "sso",
        }),
      ),
      state,
    });
    const fold = closeAuthFold({ state });
    expect(fold.oldestEventIso).toBe("2026-08-02T00:00:00Z");
    expect(fold.eventsRead).toBe(2);
    expect(fold.lastAuth.map((row) => row.identity)).toEqual(["holly.upton@acme.com", "other@acme.com"]);
  });

  it("folds nothing to an empty report with no oldest instant at all", () => {
    const fold = closeAuthFold({ state: emptyAuthFold() });
    expect(fold.lastAuth).toEqual([]);
    expect(fold.eventsRead).toBe(0);
    expect(fold.droppedNotAuth).toBe(0);
    expect(fold.oldestEventIso).toBe(null);
    expect(fold.unrecognisedEventTypes).toEqual([]);
  });
});

describe("resolveAuthWindow", () => {
  it("takes the caller's two instants", () => {
    const window = unwrap(
      resolveAuthWindow({
        nowIso: "2026-09-15T11:00:00.000Z",
        since: "2026-06-18T00:00:00Z",
        until: "2026-09-01T00:00:00Z",
      }),
    );
    expect(window.startIso).toBe("2026-06-18T00:00:00Z");
    expect(window.endIso).toBe("2026-09-01T00:00:00Z");
  });

  it("ends the window at the invocation's own clock when no --until was given", () => {
    const window = unwrap(
      resolveAuthWindow({ nowIso: "2026-09-15T11:00:00.000Z", since: "2026-06-18T00:00:00Z", until: undefined }),
    );
    expect(window.endIso).toBe("2026-09-15T11:00:00.000Z");
  });

  it("refuses a missing --since rather than inventing a default start", () => {
    const failure = unwrapErr(
      resolveAuthWindow({ nowIso: "2026-09-15T11:00:00.000Z", since: undefined, until: undefined }),
    );
    expect(failure.reason).toBe("start-missing");
    expect(failure.message).toContain("--since <iso> is required");
  });

  it("refuses a --since that is not an instant", () => {
    const failure = unwrapErr(
      resolveAuthWindow({ nowIso: "2026-09-15T11:00:00.000Z", since: "last tuesday", until: undefined }),
    );
    expect(failure.reason).toBe("not-an-instant");
    expect(failure.message).toBe("--since last tuesday is not an ISO instant");
  });

  it("refuses a start older than retention HERE, quoting the provider rather than spending a request", () => {
    const failure = unwrapErr(
      resolveAuthWindow({ nowIso: "2026-09-15T11:00:00.000Z", since: "2025-09-15T00:00:00Z", until: undefined }),
    );
    expect(failure.reason).toBe("past-retention");
    expect(failure.message).toContain("90 day retention period");
    expect(failure.message).toContain("2026-06-17T11:00:00.000Z");
  });

  it("allows a start exactly at the retention floor", () => {
    const window = unwrap(
      resolveAuthWindow({ nowIso: "2026-09-15T11:00:00.000Z", since: "2026-06-17T11:00:00.000Z", until: undefined }),
    );
    expect(window.startIso).toBe("2026-06-17T11:00:00.000Z");
  });

  it("refuses a window that holds no time at all", () => {
    const failure = unwrapErr(
      resolveAuthWindow({
        nowIso: "2026-09-15T11:00:00.000Z",
        since: "2026-09-01T00:00:00Z",
        until: "2026-09-01T00:00:00Z",
      }),
    );
    expect(failure.reason).toBe("empty-window");
    expect(failure.message).toContain("holds no time at all");
  });
});
