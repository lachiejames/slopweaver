import { describe, expect, it } from "vitest";

import { trelicaApiObservedGaps, trelicaApiRechecks } from "../../../../atlas/trelica/apiGaps.js";
import type { TrelicaCallResult } from "../../../../atlas/trelica/client.js";
import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import type { TrelicaPublishedSurface } from "../../../../atlas/trelica/publishedSpec.js";

const AT = "2026-10-02T00:00:00.000Z";

/** A published surface with one document read and one the tenant does not serve. */
const SURFACE: TrelicaPublishedSurface = {
  documents: [{ document: "apps", operations: [], securitySchemes: [], servers: [], title: "Apps", version: "v1" }],
  unreadable: [{ document: "flow", reason: "the tenant answered HTTP 404" }],
};

/** One call that answered. */
const ANSWERED: TrelicaCallResult = {
  callId: "apps",
  httpMethod: "POST",
  items: [],
  path: "/x",
  statusCode: 200,
  total: 0,
};

/** One call answered, one refused. */
const RUN = {
  failures: [{ callId: "roles", error: TrelicaAtlasErrors.callRefused({ callId: "roles", statusCode: 403 }) }],
  results: [ANSWERED],
};

describe("trelicaApiObservedGaps", () => {
  it("states both permanent gaps, then one per unreadable document and one per refused call", () => {
    const gaps = trelicaApiObservedGaps({ at: AT, run: RUN, surface: SURFACE });
    expect(gaps.map((gap) => gap.scope)).toEqual([
      "published-api-credentials",
      "spend-transactions-and-audit-activity",
      "published-document:flow",
      "first-party-call:roles",
    ]);
  });
});

describe("trelicaApiRechecks", () => {
  it("resolves what read and answered, and leaves open what did not", () => {
    const rechecks = trelicaApiRechecks({ run: RUN, surface: SURFACE });
    expect(rechecks).toEqual([
      { condition: "published-document-unreadable", resolved: true, scope: "published-document:apps" },
      { condition: "first-party-call-refused", resolved: true, scope: "first-party-call:apps" },
      { condition: "first-party-call-refused", resolved: false, scope: "first-party-call:roles" },
    ]);
  });
});
