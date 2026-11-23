import { describe, expect, it } from "vitest";

import { airtableDispositionOf } from "../../../../atlas/airtable/exclusions.js";
import { AIRTABLE_SURFACES } from "../../../../atlas/airtable/generated/surfaces.js";
import { AIRTABLE_ATLAS_KINDS, airtableKindFor } from "../../../../atlas/airtable/kinds.js";

describe("deciding what to do with one Airtable operation", () => {
  it("refuses a write with the mutating reason", () => {
    const decided = airtableDispositionOf({ method: "DELETE", operationId: "delete-base" });

    expect(decided.disposition).toBe("excluded");
    expect(decided.exclusionReason).toBe("mutating");
    expect(decided.dispositionBecause).toBe("DELETE changes the tenant, and this atlas only ever reads");
  });

  // The distinction is the whole value of the field: nothing in the tenant changes and a real person is
  // signed out of their work regardless, so "this changes stored configuration" would be a false reason.
  it("refuses logging a person out as side-effecting rather than mutating", () => {
    const decided = airtableDispositionOf({ method: "POST", operationId: "logout-user" });

    expect(decided.exclusionReason).toBe("side-effecting");
    expect(decided.dispositionBecause).toContain("ends a named person's Airtable sessions");
  });

  it("admits the one POST that reads, because a key list does not fit a query string", () => {
    const decided = airtableDispositionOf({ method: "POST", operationId: "hyperdb-table-read-records" });

    expect(decided.disposition).toBe("entity");
    expect(decided.exclusionReason).toBe(null);
  });

  it("stores nothing for the credential-posture probe", () => {
    const decided = airtableDispositionOf({ method: "GET", operationId: "get-user-id-scopes" });

    expect(decided.disposition).toBe("probe-only");
    expect(decided.dispositionBecause).toContain("credential posture");
  });

  // A GET is not automatically an entity, which is the direction a verb-based rule gets wrong.
  it("shape-indexes a GET whose records are observations", () => {
    const decided = airtableDispositionOf({ method: "GET", operationId: "change-events" });

    expect(decided.disposition).toBe("shape-index");
    expect(decided.exclusionReason).toBe(null);
  });
});

describe("placing an Airtable operation in a kind", () => {
  it("places every operation in the generated registry", () => {
    const unplaced = AIRTABLE_SURFACES.filter(
      (row) => airtableKindFor({ operationId: row.name, tag: row.tag }) === null,
    );

    expect(unplaced.map((row) => row.name)).toEqual([]);
  });

  it("places a tag it has never seen nowhere, so the generator refuses rather than guessing", () => {
    expect(airtableKindFor({ operationId: "invented-operation", tag: "notATagAirtableDeclares" })).toBe(null);
  });

  // `collaborators` is a verb, not a resource. Filed under one kind, "who can see this base" and "who can
  // see this workspace" become the same question with unrelated answers.
  it("splits the collaborators verb by the resource its path names", () => {
    expect(airtableKindFor({ operationId: "add-base-collaborator", tag: "collaborators" })?.kind).toBe("base");
    expect(airtableKindFor({ operationId: "add-workspace-collaborator", tag: "collaborators" })?.kind).toBe(
      "workspace",
    );
    expect(airtableKindFor({ operationId: "add-interface-collaborator", tag: "collaborators" })?.kind).toBe(
      "interface",
    );
  });

  it("places the tag Airtable declares and serves no operation for, so a future endpoint has a home", () => {
    expect(airtableKindFor({ operationId: "some-future-automation-read", tag: "workflow" })?.kind).toBe("page");
  });

  it("only ever returns a kind this atlas holds a file for", () => {
    const kinds = AIRTABLE_SURFACES.flatMap((row) => {
      const placed = airtableKindFor({ operationId: row.name, tag: row.tag });
      return placed === null ? [] : [placed.kind, ...placed.alsoFeeds];
    });
    const strangers = kinds.filter((kind) => !AIRTABLE_ATLAS_KINDS.includes(kind));

    expect(strangers).toEqual([]);
  });
});
