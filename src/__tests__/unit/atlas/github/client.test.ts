/**
 * `recordsIn` — which records one GitHub response body contributes. A wrapper is marked by its numeric
 * `total_count` alone, so a singleton document that carries an array of its own stays one record.
 */
import { describe, expect, it } from "vitest";

import { recordsIn } from "../../../../atlas/github/client.js";

describe("recordsIn", () => {
  it("reads a bare array as the record list, with no reported total", () => {
    expect(recordsIn({ body: [{ id: 1 }, { id: 2 }] })).toEqual({
      records: [{ id: 1 }, { id: 2 }],
      reportedTotal: null,
    });
  });

  it("unwraps a wrapper's collection beside its numeric total_count", () => {
    const body = { secrets: [{ name: "FIXTURE_ONE" }, { name: "FIXTURE_TWO" }], total_count: 2 };
    expect(recordsIn({ body })).toEqual({
      records: [{ name: "FIXTURE_ONE" }, { name: "FIXTURE_TWO" }],
      reportedTotal: 2,
    });
  });

  it("keeps a repository document with an empty topics array as ONE record", () => {
    const body = { allow_squash_merge: true, full_name: "acme/widgets", topics: [] };
    expect(recordsIn({ body })).toEqual({ records: [body], reportedTotal: null });
  });

  it("never reads a repository's topic names as records", () => {
    const body = { full_name: "acme/widgets", topics: ["cli", "local-first"] };
    expect(recordsIn({ body })).toEqual({ records: [body], reportedTotal: null });
  });

  it("reads an empty wrapper with no array beside its total_count as zero records, never itself", () => {
    expect(recordsIn({ body: { total_count: 0 } })).toEqual({ records: [], reportedTotal: 0 });
  });

  it("keeps a nonzero total beside no array, so the completeness check can refuse the read", () => {
    expect(recordsIn({ body: { total_count: 3 } })).toEqual({ records: [], reportedTotal: 3 });
  });

  it("keeps the Actions permissions document as ONE record", () => {
    const body = { allowed_actions: "selected", enabled: true };
    expect(recordsIn({ body })).toEqual({ records: [body], reportedTotal: null });
  });

  it("keeps the workflow defaults document as ONE record", () => {
    const body = { can_approve_pull_request_reviews: false, default_workflow_permissions: "read" };
    expect(recordsIn({ body })).toEqual({ records: [body], reportedTotal: null });
  });

  it("reads a non-object body as no records", () => {
    expect(recordsIn({ body: "not a document" })).toEqual({ records: [], reportedTotal: null });
  });
});
