import { describe, expect, it } from "vitest";

import { atlasPlatforms, findAtlasPlatform } from "../../../../../atlas/registry.js";
import { TRELICA_ATLAS_DESCRIPTOR } from "../../../../../atlas/trelica/descriptor.js";
import {
  findTrelicaCall,
  TRELICA_CALLS,
  type TrelicaCallId,
  trelicaCalls,
} from "../../../../../atlas/trelica/inventory.js";
import {
  parseTrelicaResetOptions,
  parseTrelicaVerbOptions,
  parseTrelicaWalkOptions,
  TRELICA_RESET_USAGE,
  TRELICA_WALK_USAGE,
} from "../../../../../cli/commands/trelicaAtlas/core.js";
import { unwrap } from "../../../../../lib/result.js";

describe("the registry row", () => {
  it("lists trelica exactly once, alphabetically among its siblings", () => {
    expect(atlasPlatforms().filter((platform) => platform === "trelica").length).toBe(1);
    expect(findAtlasPlatform({ platform: "trelica" })?.platform).toBe("trelica");
  });
});

describe("the descriptor", () => {
  it("names the one command that brings every surface current", () => {
    expect(TRELICA_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas trelica refresh");
  });

  it("declares all three surfaces, with the browser one among them", () => {
    expect(TRELICA_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toEqual([
      "published-api",
      "first-party-api",
      "web-app",
    ]);
    expect(TRELICA_ATLAS_DESCRIPTOR.surfaces.some((surface) => surface.acquisition === "driven-browser")).toBe(true);
  });

  it("holds entity kinds, because nothing better suited holds this platform's entities", () => {
    expect([...TRELICA_ATLAS_DESCRIPTOR.kinds]).toEqual([
      "access-review",
      "ai-alert",
      "ai-usage",
      "app",
      "assessment",
      "contract",
      "device",
      "integration",
      "method",
      "page",
      "person",
      "role",
      "team",
      "workflow",
      "workflow-run",
    ]);
  });

  it("says what it deliberately does not hold", () => {
    expect(TRELICA_ATLAS_DESCRIPTOR.excludes.length).toBeGreaterThan(0);
    expect(TRELICA_ATLAS_DESCRIPTOR.excludes.map((entry) => entry.because).join(" ")).toContain("mutation");
  });
});

describe("the call inventory", () => {
  it("admits only GET and list-shaped POST rows", () => {
    trelicaCalls().forEach((call) => {
      expect(["GET", "POST"].includes(call.httpMethod)).toBe(true);
    });
  });

  it("gives every admitted row its own whyRead justification", () => {
    trelicaCalls().forEach((call) => {
      expect(call.whyRead.length).toBeGreaterThan(0);
    });
  });

  // The lookup is closed: an id the table does not list cannot reach it, which is the point of the table.
  it("refuses an id the table does not list at compile time", () => {
    // @ts-expect-error -- "delete-everything" is not an admitted call id
    const unlisted: TrelicaCallId = "delete-everything";
    expect(trelicaCalls().some((call) => call.id === unlisted)).toBe(false);
  });

  it("resolves an admitted id to its own row", () => {
    expect(findTrelicaCall({ id: "roles" }).path).toBe(TRELICA_CALLS.roles.path);
  });

  it("resolves every admitted id to the row that declares it", () => {
    const rows = Object.values(TRELICA_CALLS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => findTrelicaCall({ id: row.id }) !== row).map((row) => row.id)).toStrictEqual([]);
  });
});

describe("option parsing", () => {
  it("takes a home and a json flag", () => {
    const parsed = unwrap(parseTrelicaVerbOptions({ rest: ["--home", "/tmp/x", "--json"] }));
    expect(parsed.home).toBe("/tmp/x");
    expect(parsed.json).toBe(true);
  });

  it("takes a walk limit for proving the lane", () => {
    expect(unwrap(parseTrelicaWalkOptions({ rest: ["--limit", "2"] })).limit).toBe(2);
  });

  it("leaves the limit unset when none was given", () => {
    expect(unwrap(parseTrelicaWalkOptions({ rest: [] })).limit).toBe(undefined);
  });

  it("refuses a limit that is not a positive whole number", () => {
    const parsed = parseTrelicaWalkOptions({ rest: ["--limit", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("positive whole number");
  });

  it("refuses a reset that does not spell the confirmation out", () => {
    const parsed = parseTrelicaResetOptions({ rest: ["--confirm", "yes"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("--confirm archive");
  });

  it("accepts a reset that does", () => {
    expect(unwrap(parseTrelicaResetOptions({ rest: ["--confirm", "archive"] })).json).toBe(false);
  });

  it("advertises the walk limit and the reset confirmation in their own usage", () => {
    expect(TRELICA_WALK_USAGE).toContain("--limit");
    expect(TRELICA_RESET_USAGE).toContain("--confirm archive");
  });
});
