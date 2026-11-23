/**
 * Which documents the readings ledger refuses under the landing producer — the same set the Queue draws nothing from
 * (`site/lib/landingIsOwners.ts`), whatever spelling of the producer reaches it.
 */
import { describe, expect, it } from "vitest";

import { landingSelectionRefusal } from "../../../readings/landingSelection.js";

const NOT_OWNERS =
  "must be read with --author @me — the landing ledger is the Queue's reading of the owner's pull requests, " +
  "so anybody else's is never recorded";

describe("landingSelectionRefusal", () => {
  it.each([
    ["no author — every author", { selection: { repos: [] } }],
    ["a colleague's login", { selection: { author: "user1-acme", repos: [] } }],
    ["a non-string author", { selection: { author: 7 } }],
    ["a null selection", { selection: null }],
    ["an array selection", { selection: [] }],
  ])("refuses a landing document read over %s", (_shape, document) => {
    expect(landingSelectionRefusal({ document, producer: "github landing" })).toBe(NOT_OWNERS);
  });

  it("refuses a landing document that is not an object", () => {
    expect(landingSelectionRefusal({ document: [], producer: "github landing" })).toBe(
      "must be a JSON object — the page and the Queue draw nothing from any other shape",
    );
  });

  it("judges every spelling that files under the landing slug", () => {
    const everyone = { selection: { repos: [] } };
    expect(landingSelectionRefusal({ document: everyone, producer: " GitHub_Landing " })).toBe(NOT_OWNERS);
  });

  it("passes @me in any case, a document with no selection, a cadence skip, and every other producer", () => {
    const passed = [
      landingSelectionRefusal({ document: { selection: { author: "@ME" } }, producer: "github landing" }),
      landingSelectionRefusal({ document: { rows: [] }, producer: "github landing" }),
      landingSelectionRefusal({ document: { kind: "skipped", selection: "o/r@@me" }, producer: "github landing" }),
      landingSelectionRefusal({ document: { selection: { author: "someone" } }, producer: "claude gauge" }),
    ];
    expect(passed).toEqual([undefined, undefined, undefined, undefined]);
  });
});
