import { describe, expect, it } from "vitest";

import {
  batchEntryBodies,
  buildAuditFilter,
  MAX_RESOURCE_NAMES,
  MAX_VIEWS,
  quoteFilterString,
  viewsOf,
} from "../../../gcpAudit/filter.js";
import type { GcpContainer } from "../../../gcpAudit/transport.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const LOGS =
  '(log_id("cloudaudit.googleapis.com/activity") OR log_id("cloudaudit.googleapis.com/data_access") OR ' +
  'log_id("cloudaudit.googleapis.com/policy") OR log_id("cloudaudit.googleapis.com/system_event"))';

describe("quoteFilterString", () => {
  it("escapes a quote and a backslash so neither can close the literal", () => {
    expect(quoteFilterString({ value: 'a"b\\c' })).toBe('"a\\"b\\\\c"');
  });
});

describe("buildAuditFilter", () => {
  it("reads every audit stream since the instant, narrowed to the named principals", () => {
    const filter = unwrap(buildAuditFilter({ principals: ["a@x.com", "b@x.com"], since: "2025-08-29T00:00:00Z" }));
    expect(filter).toBe(
      `${LOGS} AND timestamp >= "2025-08-29T00:00:00Z" AND ` +
        '(protoPayload.authenticationInfo.principalEmail = "a@x.com" OR protoPayload.authenticationInfo.principalEmail = "b@x.com")',
    );
  });

  it("leaves the principal clause off for every principal", () => {
    expect(unwrap(buildAuditFilter({ principals: "all", since: "2025-08-29T00:00:00.5Z" }))).toBe(
      `${LOGS} AND timestamp >= "2025-08-29T00:00:00.5Z"`,
    );
  });

  it("refuses an instant that is not RFC 3339 UTC", () => {
    expect(unwrapErr(buildAuditFilter({ principals: "all", since: "2025-08-29" })).message).toContain(
      "--since 2025-08-29 is not an RFC 3339 UTC instant",
    );
  });

  it("refuses an empty principal list rather than reading everyone", () => {
    expect(unwrapErr(buildAuditFilter({ principals: [], since: "2025-08-29T00:00:00Z" })).message).toBe(
      "name at least one --principal, or pass --all-principals",
    );
  });

  it("refuses a principal that could close the string", () => {
    expect(unwrapErr(buildAuditFilter({ principals: ['a@x.com" OR "1'], since: "2025-08-29T00:00:00Z" })).code).toBe(
      "INPUT_INVALID",
    );
  });
});

describe("viewsOf", () => {
  it("charges two views per bucket, and two for a container whose buckets went unread", () => {
    expect(viewsOf({ buckets: 3 })).toBe(6);
    expect(viewsOf({ buckets: 0 })).toBe(2);
  });
});

describe("batchEntryBodies", () => {
  const containers = ({ count }: { count: number }): GcpContainer[] =>
    Array.from({ length: count }, (_, index) => `projects/project-${String(index).padStart(4, "0")}` as GcpContainer);

  it("cuts at the resource-name ceiling when views allow", () => {
    const bodies = batchEntryBodies({ filter: "f", resources: containers({ count: 150 }), views: () => 1 });
    expect(bodies.map((body) => body.resourceNames.length)).toEqual([MAX_RESOURCE_NAMES, 50]);
  });

  it("cuts at the view ceiling before the name ceiling", () => {
    const bodies = batchEntryBodies({ filter: "f", resources: containers({ count: 99 }), views: () => 4 });
    expect(bodies.map((body) => body.resourceNames.length)).toEqual([MAX_VIEWS / 4, MAX_VIEWS / 4 - 1]);
  });

  it("keeps every container exactly once, in order, each body carrying the filter", () => {
    const resources = containers({ count: 7 });
    const bodies = batchEntryBodies({ filter: "the-filter", resources, views: () => 60 });
    expect(bodies.flatMap((body) => body.resourceNames)).toEqual(resources);
    expect(bodies.map((body) => body.filter)).toEqual(["the-filter", "the-filter", "the-filter"]);
  });

  it("answers no body for no containers", () => {
    expect(batchEntryBodies({ filter: "f", resources: [], views: () => 2 })).toEqual([]);
  });
});
