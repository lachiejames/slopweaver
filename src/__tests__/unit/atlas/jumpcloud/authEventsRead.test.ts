import { describe, expect, it } from "vitest";

import { JUMPCLOUD_AUTH_SERVICES } from "../../../../atlas/jumpcloud/authEvents.js";
import { type AuthEventsDeps, readJumpcloudAuthEvents } from "../../../../atlas/jumpcloud/authEventsRead.js";
import type { JumpcloudFetch } from "../../../../atlas/jumpcloud/client.js";
import { JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";
import { admitJumpcloudPage, type JumpcloudAdmit } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { admitAnyCarrier } from "../../../jumpcloudCarrierAdmit.js";

const START = "2026-09-01T00:00:00Z";
const END = "2026-09-15T00:00:00Z";
const EVENTS_URL = "https://api.jumpcloud.com/insights/directory/v1/events";

/** One scripted answer: the events array and the response headers that page carries. */
interface Answer {
  readonly events: readonly unknown[];
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

/** A short page: fewer results than the requested limit, so the provider's own end-of-window signal. */
function shortPage({ events }: { events: readonly unknown[] }): Answer {
  return { events, headers: { "x-result-count": String(events.length) }, status: 200 };
}

/** A full page, optionally offering a continuation cursor. */
function fullPage({ cursor }: { cursor: string | null }): Answer {
  const headers: Record<string, string> = { "x-result-count": "1000" };
  if (cursor !== null) {
    headers["x-search_after"] = cursor;
  }
  return { events: [], headers, status: 200 };
}

/** One request the fake transport received. */
interface CapturedRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly body: string | null;
}

/** Plain typed dependencies over an in-order answer script, recording every request and progress line. */
function harness({
  answers,
  maxPages,
  admit = admitAnyCarrier,
}: {
  answers: readonly Answer[];
  maxPages: number;
  admit?: JumpcloudAdmit;
}): {
  deps: AuthEventsDeps;
  requests: CapturedRequest[];
  progress: string[];
} {
  const requests: CapturedRequest[] = [];
  const progressLines: string[] = [];
  const fetch: JumpcloudFetch = async ({ url, method, body }) => {
    const answer = answers[requests.length];
    requests.push({ body, method, url });
    if (answer === undefined) {
      throw new Error(`the transport was asked for request ${String(requests.length)}, beyond its script`);
    }
    return { headers: answer.headers, status: answer.status, text: JSON.stringify(answer.events) };
  };
  const progress: AuthEventsDeps["progress"] = (line) => {
    progressLines.push(line);
  };
  return {
    deps: { admit, client: { apiKey: "test-key", fetch, orgId: "org-test" }, maxPages, progress },
    progress: progressLines,
    requests,
  };
}

/** The request bodies, parsed, so an assertion reads the fields rather than the serialised text. */
function bodiesOf({ requests }: { requests: readonly CapturedRequest[] }): unknown[] {
  return requests.map(({ body }): unknown => JSON.parse(body!));
}

/** The first page body the read sends for one service. */
function firstPageBody({ service }: { service: string }): Record<string, unknown> {
  return { end_time: END, limit: 1000, service: [service], sort: "DESC", start_time: START };
}

describe("readJumpcloudAuthEvents", () => {
  it("walks the five auth services in order, one short page each, folding into one shared state", async () => {
    const { deps, requests, progress } = harness({
      answers: [
        shortPage({
          events: [
            {
              event_type: "user_login_attempt",
              jc_initiated_by_email: "alice@example.test",
              jc_initiated_by_username: "alice",
              service: "directory",
              success: true,
              timestamp: "2026-09-14T10:00:00Z",
            },
          ],
        }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({
          events: [
            {
              event_type: "sso_auth",
              initiated_by: { username: "bob" },
              jc_initiated_by_email: "bob@example.test",
              service: "sso",
              success: null,
              timestamp: "2026-09-13T08:00:00Z",
            },
          ],
        }),
        shortPage({
          events: [
            {
              event_type: "login_attempt",
              jc_initiated_by_email: "alice@example.test",
              service: "systems",
              success: true,
              timestamp: "2026-09-14T12:00:00Z",
              username: "alice.mac",
            },
          ],
        }),
      ],
      maxPages: 5,
    });

    const report = unwrap(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));

    expect(JUMPCLOUD_AUTH_SERVICES).toEqual(["directory", "ldap", "radius", "sso", "systems"]);
    expect(report).toEqual({
      endIso: END,
      fold: {
        droppedNotAuth: 0,
        eventsRead: 3,
        lastAuth: [
          {
            eventType: "login_attempt",
            identity: "alice@example.test",
            identityKind: "email",
            lastAuthIso: "2026-09-14T12:00:00Z",
            service: "systems",
            username: "alice.mac",
          },
          {
            eventType: "sso_auth",
            identity: "bob@example.test",
            identityKind: "email",
            lastAuthIso: "2026-09-13T08:00:00Z",
            service: "sso",
            username: "bob",
          },
        ],
        oldestEventIso: "2026-09-13T08:00:00Z",
        unrecognisedEventTypes: [],
      },
      services: [
        { ending: { kind: "window-exhausted" }, eventsRead: 1, pagesRead: 1, service: "directory" },
        { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "ldap" },
        { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "radius" },
        { ending: { kind: "window-exhausted" }, eventsRead: 1, pagesRead: 1, service: "sso" },
        { ending: { kind: "window-exhausted" }, eventsRead: 1, pagesRead: 1, service: "systems" },
      ],
      startIso: START,
    });
    expect(progress).toEqual([
      "directory page 1: 1 event(s), 1 identity(ies) so far",
      "ldap page 1: 0 event(s), 1 identity(ies) so far",
      "radius page 1: 0 event(s), 1 identity(ies) so far",
      "sso page 1: 1 event(s), 2 identity(ies) so far",
      "systems page 1: 1 event(s), 2 identity(ies) so far",
    ]);
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual(
      ["directory", "ldap", "radius", "sso", "systems"].map(() => ({ method: "POST", url: EVENTS_URL })),
    );
    expect(bodiesOf({ requests })).toEqual(
      ["directory", "ldap", "radius", "sso", "systems"].map((service) => firstPageBody({ service })),
    );
  });

  it("carries a page's cursor into the next request and ends on no-cursor when a full page offers none", async () => {
    const { deps, requests } = harness({
      answers: [
        fullPage({ cursor: '[1789427630640, "6aa87fae8395abff58bfb5fb"]' }),
        fullPage({ cursor: null }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
      ],
      maxPages: 3,
    });

    const report = unwrap(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));

    expect(report.services).toEqual([
      { ending: { kind: "no-cursor" }, eventsRead: 0, pagesRead: 2, service: "directory" },
      { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "ldap" },
      { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "radius" },
      { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "sso" },
      { ending: { kind: "window-exhausted" }, eventsRead: 0, pagesRead: 1, service: "systems" },
    ]);
    expect(bodiesOf({ requests }).slice(0, 2)).toEqual([
      firstPageBody({ service: "directory" }),
      { ...firstPageBody({ service: "directory" }), search_after: [1789427630640, "6aa87fae8395abff58bfb5fb"] },
    ]);
  });

  it("stops a service at the page cap even though the provider offered another cursor", async () => {
    const { deps, requests } = harness({
      answers: [
        fullPage({ cursor: '[1789427630640, "6aa87fae8395abff58bfb5fb"]' }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
      ],
      maxPages: 1,
    });

    const report = unwrap(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));

    expect(report.services[0]).toEqual({
      ending: { kind: "page-cap", pages: 1 },
      eventsRead: 0,
      pagesRead: 1,
      service: "directory",
    });
    expect(bodiesOf({ requests })).toEqual(
      ["directory", "ldap", "radius", "sso", "systems"].map((service) => firstPageBody({ service })),
    );
  });

  it("returns PERMISSION_REFUSED from the service that answered 403 and asks no later service", async () => {
    const { deps, requests, progress } = harness({
      answers: [
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        shortPage({ events: [] }),
        { events: [], headers: {}, status: 403 },
        shortPage({ events: [] }),
      ],
      maxPages: 5,
    });

    const failure = unwrapErr(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));

    expect(failure.code).toBe("PERMISSION_REFUSED");
    expect(failure.message).toBe(
      "insights-directory-insights-events-post answered 403: this administrator may not read it. One family refused this way while others succeed is a permission boundary, not a broken credential",
    );
    expect(failure).toEqual(
      JumpcloudReadErrors.permissionRefused({ status: 403, surface: "insights-directory-insights-events-post" }),
    );
    expect(bodiesOf({ requests })).toEqual(
      ["directory", "ldap", "radius", "sso"].map((service) => firstPageBody({ service })),
    );
    expect(progress).toEqual([
      "directory page 1: 0 event(s), 0 identity(ies) so far",
      "ldap page 1: 0 event(s), 0 identity(ies) so far",
      "radius page 1: 0 event(s), 0 identity(ies) so far",
    ]);
  });

  it("admits a page through the measured event boundary before projecting it, an empty page included", async () => {
    const { deps } = harness({
      admit: admitJumpcloudPage,
      answers: JUMPCLOUD_AUTH_SERVICES.map(() => shortPage({ events: [] })),
      maxPages: 1,
    });
    const report = unwrap(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));
    expect(report.services.map((walk) => walk.ending.kind)).toEqual(
      JUMPCLOUD_AUTH_SERVICES.map(() => "window-exhausted"),
    );
  });

  it("refuses a page carrying an event key the boundary was never measured with, naming the key, and projects nothing", async () => {
    const { deps, progress } = harness({
      admit: admitJumpcloudPage,
      answers: [shortPage({ events: [{ unmeasuredEventKey: "x" }] })],
      maxPages: 1,
    });
    const failure = unwrapErr(await readJumpcloudAuthEvents({ deps, endIso: END, startIso: START }));
    expect(failure.code).toBe("BODY_SHAPE_CHANGED");
    expect(failure.message).toContain('new field "[0].unmeasuredEventKey"');
    expect(progress).toEqual([]);
  });
});
