/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  ERROR_TRACKING_STATE_CAP,
  type ErrorTrackingIssueRow,
  errorTrackingIssueLink,
  issueRowsFromSearch,
  parseErrorTrackingState,
  summariseIssuesByState,
} from "../../../datadog/errorTracking.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DAY_MS = 86_400_000;
const NOW_MS = Date.UTC(2026, 8, 29);

/** One search hit and its included issue, in the SDK's deserialised camelCase shape. */
function hitAndIssue({
  id,
  count,
  state,
  firstSeenDaysAgo,
}: {
  id: string;
  count: number;
  state: string;
  firstSeenDaysAgo: number;
}): { hit: unknown; issue: unknown } {
  return {
    hit: { attributes: { totalCount: count }, id, relationships: { issue: { data: { id, type: "issue" } } } },
    issue: {
      attributes: {
        errorMessage: "Invoice already exported",
        errorType: "DuplicateExportError",
        firstSeen: NOW_MS - firstSeenDaysAgo * DAY_MS,
        firstSeenVersion: "f00dcafe",
        lastSeen: NOW_MS,
        service: "billing-api",
        state,
      },
      id,
      type: "issue",
    },
  };
}

function row({
  state,
  firstSeenDaysAgo,
  count,
}: {
  state: ErrorTrackingIssueRow["state"];
  firstSeenDaysAgo: number;
  count: number;
}): ErrorTrackingIssueRow {
  return {
    count,
    errorMessage: null,
    errorType: null,
    firstSeenMs: NOW_MS - firstSeenDaysAgo * DAY_MS,
    firstSeenVersion: null,
    id: `issue-${String(firstSeenDaysAgo)}`,
    lastSeenMs: NOW_MS,
    service: null,
    state,
  };
}

describe("parseErrorTrackingState", () => {
  it("reads the console's word in kebab case", () => {
    expect(parseErrorTrackingState({ value: "for-review" })).toBe("OPEN");
    expect(parseErrorTrackingState({ value: "reviewed" })).toBe("ACKNOWLEDGED");
    expect(parseErrorTrackingState({ value: "Ignored" })).toBe("IGNORED");
  });

  it("reads the API's own state name", () => {
    expect(parseErrorTrackingState({ value: "acknowledged" })).toBe("ACKNOWLEDGED");
  });

  it("names nothing for a word that is neither", () => {
    expect(parseErrorTrackingState({ value: "triaged" })).toBe(null);
  });
});

describe("issueRowsFromSearch", () => {
  it("joins each hit to its included issue, in the search's order, skipping included non-issues", () => {
    const a = hitAndIssue({ count: 412, firstSeenDaysAgo: 75, id: "a", state: "OPEN" });
    const b = hitAndIssue({ count: 287, firstSeenDaysAgo: 71, id: "b", state: "ACKNOWLEDGED" });
    const rows = unwrap(
      issueRowsFromSearch({
        data: [a.hit, b.hit],
        included: [b.issue, { attributes: { handle: "someone" }, id: "u1", type: "user" }, a.issue],
      }),
    );
    expect(rows.map((each) => [each.id, each.count, each.state])).toEqual([
      ["a", 412, "OPEN"],
      ["b", 287, "ACKNOWLEDGED"],
    ]);
    expect(rows[0]!.service).toBe("billing-api");
    expect(rows[0]!.firstSeenVersion).toBe("f00dcafe");
  });

  it("carries an absent service or version as null, never a placeholder", () => {
    const { hit } = hitAndIssue({ count: 3, firstSeenDaysAgo: 1, id: "c", state: "OPEN" });
    const issue = { attributes: { firstSeen: NOW_MS, lastSeen: NOW_MS, state: "OPEN" }, id: "c", type: "issue" };
    const rows = unwrap(issueRowsFromSearch({ data: [hit], included: [issue] }));
    expect(rows[0]!.service).toBe(null);
    expect(rows[0]!.firstSeenVersion).toBe(null);
  });

  it("refuses a hit whose issue is missing from included, naming the hit", () => {
    const { hit } = hitAndIssue({ count: 3, firstSeenDaysAgo: 1, id: "orphan", state: "OPEN" });
    const problems = unwrapErr(issueRowsFromSearch({ data: [hit], included: [] }));
    expect(problems).toEqual(["search hit orphan has no issue in included[] — was include=issue sent?"]);
  });
});

describe("summariseIssuesByState", () => {
  it("counts issues and events and measures age since first seen, per state", () => {
    const summary = summariseIssuesByState({
      nowMs: NOW_MS,
      rows: [
        row({ count: 10, firstSeenDaysAgo: 120, state: "OPEN" }),
        row({ count: 5, firstSeenDaysAgo: 40, state: "OPEN" }),
        row({ count: 1, firstSeenDaysAgo: 3, state: "OPEN" }),
        row({ count: 7, firstSeenDaysAgo: 12, state: "ACKNOWLEDGED" }),
      ],
    });
    expect(summary.OPEN).toEqual({
      capped: false,
      events: 16,
      issues: 3,
      medianAgeDays: 40,
      oldestAgeDays: 120,
      olderThan30Days: 2,
    });
    expect(summary.ACKNOWLEDGED!.issues).toBe(1);
    expect(summary.IGNORED).toBe(undefined);
  });

  it("marks a state that reached Datadog's per-state cap as a floor", () => {
    const rows = Array.from({ length: ERROR_TRACKING_STATE_CAP }, (_, index) =>
      row({ count: 1, firstSeenDaysAgo: index, state: "OPEN" }),
    );
    expect(summariseIssuesByState({ nowMs: NOW_MS, rows }).OPEN!.capped).toBe(true);
  });
});

describe("errorTrackingIssueLink", () => {
  it("addresses the issue on the configured console host", () => {
    expect(errorTrackingIssueLink({ consoleHost: "ap1.datadoghq.com", id: "6d6d6d6d" })).toBe(
      "https://ap1.datadoghq.com/error-tracking/issue/6d6d6d6d",
    );
  });
});
