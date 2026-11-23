import { describe, expect, it } from "vitest";

import {
  NOTION_DISAGREEMENT_SAMPLE,
  splitNotionChannels,
  summariseDisagreement,
} from "../../../../atlas/notion/disagreement.js";

import { channel, entity } from "./notionEntityFixtures.js";

describe("splitNotionChannels", () => {
  it("puts a row both channels saw on both", () => {
    const rows = [
      entity({ api: channel({ name: "api" }), browser: channel({ name: "browser" }), providerId: "POST /v1/search" }),
    ];
    expect(splitNotionChannels({ entities: rows }).onBoth).toEqual(["POST /v1/search"]);
  });

  it("puts a declared endpoint nobody was seen calling on the api-only side", () => {
    const rows = [entity({ api: channel({ name: "api" }), providerId: "GET /v1/users" })];
    expect(splitNotionChannels({ entities: rows }).apiOnly).toEqual(["GET /v1/users"]);
  });

  it("puts an operation the client called that the SDK does not declare on the browser-only side", () => {
    const rows = [entity({ browser: channel({ name: "browser" }), providerId: "POST /api/v3/getSpaces" })];
    expect(splitNotionChannels({ entities: rows }).browserOnly).toEqual(["POST /api/v3/getSpaces"]);
  });

  it("counts a row no channel has looked at in none of the three, rather than guessing a side", () => {
    const rows = [entity({ providerId: "GET /v1/users" })];
    const split = splitNotionChannels({ entities: rows });
    expect(split.apiOnly.length + split.browserOnly.length + split.onBoth.length).toBe(0);
  });

  it("sorts each side, so two runs over the same store print identical bytes", () => {
    const rows = [
      entity({ api: channel({ name: "api" }), providerId: "GET /v1/users" }),
      entity({ api: channel({ name: "api" }), providerId: "GET /v1/comments" }),
    ];
    expect(splitNotionChannels({ entities: rows }).apiOnly).toEqual(["GET /v1/comments", "GET /v1/users"]);
  });

  it("reports three empty sides for an empty store", () => {
    expect(splitNotionChannels({ entities: [] })).toEqual({ apiOnly: [], browserOnly: [], onBoth: [] });
  });
});

describe("summariseDisagreement", () => {
  it("leads with the total number of rows held", () => {
    const lines = summariseDisagreement({ split: { apiOnly: ["a"], browserOnly: ["b"], onBoth: ["c"] } });
    expect(lines[0]).toBe("notion surface corroboration — 3 method row(s) held");
  });

  it("names the undocumented surface when there is one", () => {
    const lines = summariseDisagreement({
      split: { apiOnly: [], browserOnly: ["POST /api/v3/getSpaces"], onBoth: [] },
    });
    expect(lines.join("\n")).toContain("POST /api/v3/getSpaces");
  });

  it("prints no sample section when nothing is browser-only", () => {
    const lines = summariseDisagreement({ split: { apiOnly: ["a"], browserOnly: [], onBoth: [] } });
    expect(lines.length).toBe(4);
  });

  it("caps the sample, so a hundred browser-only rows do not become a wall", () => {
    const many = Array.from({ length: 40 }, (_, index) => `POST /api/v3/op${String(index)}`);
    const lines = summariseDisagreement({ split: { apiOnly: [], browserOnly: many, onBoth: [] } });
    expect(lines.length).toBe(5 + NOTION_DISAGREEMENT_SAMPLE);
  });

  it("says how many of the browser-only rows the sample is showing", () => {
    const many = Array.from({ length: 40 }, (_, index) => `POST /api/v3/op${String(index)}`);
    const lines = summariseDisagreement({ split: { apiOnly: [], browserOnly: many, onBoth: [] } });
    expect(lines[4]).toBe(`  the undocumented surface, first ${String(NOTION_DISAGREEMENT_SAMPLE)} of 40:`);
  });
});
