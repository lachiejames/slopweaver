/**
 * A Google door row graded on whether this install ever connected it.
 *
 * The finding this closes: one turn answered an ask naming a FILE with "no pdf, attachment or
 * drive doc" after searching only the corpus, because routing offered 54 rows and not one was a door. Adding
 * the rows is half the fix; the other half is that a row must not claim reach on an install whose grant was
 * never given, so the cases below are the three states a grant store can be in plus the row it never touches.
 */
import { describe, expect, it } from "vitest";

import {
  type ConnectionRouteReading,
  connectionDoorOf,
  deriveConnectionCapabilities,
  deriveConnectionCapability,
} from "../../../route/connectionReading.js";
import type { SourceCapability } from "../../../route/profile.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";

const DECLARED_DETAIL = "the shared drives this account can see";

/** One door row as the generic table declares them: available, current, with a real argv. */
function row({ over }: { over: Partial<SourceCapability> }): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", "drive", "drives"],
    coverage: { detail: DECLARED_DETAIL, kind: "bounded" },
    effect: "read",
    freshness: { detail: "read directly from Google Drive", kind: "live" },
    id: "drive",
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["file"],
    truthMode: "current",
    what: "the files the owner's Google Drive holds",
    ...over,
  };
}

describe("connectionDoorOf", () => {
  it("names the door for each of the four rows that hold a grant", () => {
    expect(connectionDoorOf({ capability: row({ over: { id: "drive" } }) })).toBe("drive");
    expect(connectionDoorOf({ capability: row({ over: { id: "gmail" } }) })).toBe("gmail");
    expect(connectionDoorOf({ capability: row({ over: { id: "calendar" } }) })).toBe("calendar");
    expect(connectionDoorOf({ capability: row({ over: { id: "outlook" } }) })).toBe("outlook");
  });

  it("refuses an unconnected Outlook row, naming the Outlook connect verb", () => {
    const reading: ConnectionRouteReading = {
      connected: false,
      door: "outlook",
      why: "no outlook grant is stored on this install",
    };
    const graded = deriveConnectionCapability({ capability: row({ over: { id: "outlook" } }), reading });
    expect(graded.availability).toEqual({
      kind: "unavailable",
      reason: "no outlook grant is stored on this install — run `slopweaver outlook connect`",
    });
    expect(graded.command).toEqual([]);
  });

  it("grades the browser row too — on the recorded profile, not on a grant", () => {
    expect(connectionDoorOf({ capability: row({ over: { id: "browser" } }) })).toBe("browser");
  });

  it("never grades a row that is not a door", () => {
    expect(connectionDoorOf({ capability: row({ over: { id: "corpus" } }) })).toBeNull();
  });
});

describe("deriveConnectionCapability", () => {
  it("refuses a browser row with no recorded Chrome profile, naming how to record one", () => {
    const reading: ConnectionRouteReading = {
      connected: false,
      door: "browser",
      why: "no Chrome profile has been recorded on this machine",
    };
    const graded = deriveConnectionCapability({ capability: row({ over: { id: "browser" } }), reading });
    expect(graded.availability).toEqual({
      kind: "unavailable",
      reason:
        "no Chrome profile has been recorded on this machine — run `slopweaver browser profile --list, then --set <directory>`",
    });
    expect(graded.command).toEqual([]);
  });

  it("refuses an unconnected door, clears its command and names the verb that fixes it", () => {
    const reading: ConnectionRouteReading = {
      connected: false,
      door: "drive",
      why: "no drive grant is stored on this install",
    };
    const graded = deriveConnectionCapability({ capability: row({ over: {} }), reading });
    expect(graded.availability).toEqual({
      kind: "unavailable",
      reason: "no drive grant is stored on this install — run `slopweaver drive connect`",
    });
    expect(graded.command).toEqual([]);
    expect(graded.coverage).toEqual({ detail: "no drive grant is stored on this install", kind: "unknown" });
  });

  it("carries a corrupt grant's own message rather than reporting it as absent", () => {
    const reading: ConnectionRouteReading = {
      connected: false,
      door: "gmail",
      why: "the stored Gmail grant is not valid JSON: Unexpected end of JSON input",
    };
    const graded = deriveConnectionCapability({ capability: row({ over: { id: "gmail" } }), reading });
    expect(graded.availability).toEqual({
      kind: "unavailable",
      reason: "the stored Gmail grant is not valid JSON: Unexpected end of JSON input — run `slopweaver gmail connect`",
    });
  });

  it("leaves a connected door exactly as declared", () => {
    const reading: ConnectionRouteReading = { account: "someone@example.com", connected: true, door: "drive" };
    const graded = deriveConnectionCapability({ capability: row({ over: {} }), reading });
    expect(graded.availability).toEqual({ kind: "available" });
    expect(graded.command).toEqual(["slopweaver", "drive", "drives"]);
    expect(graded.coverage.detail).toBe(DECLARED_DETAIL);
  });

  it("leaves a row exactly as declared when nobody looked", () => {
    const graded = deriveConnectionCapability({ capability: row({ over: {} }), reading: undefined });
    expect(graded.availability).toEqual({ kind: "available" });
    expect(graded.command).toEqual(["slopweaver", "drive", "drives"]);
  });

  it("never re-words a row that was already unavailable for another reason", () => {
    const already = row({
      over: { availability: { kind: "unavailable", reason: "the command cannot run here" }, command: [] },
    });
    const reading: ConnectionRouteReading = { connected: false, door: "drive", why: "no drive grant" };
    expect(deriveConnectionCapability({ capability: already, reading }).availability).toEqual({
      kind: "unavailable",
      reason: "the command cannot run here",
    });
  });
});

describe("deriveConnectionCapabilities", () => {
  it("grades only the rows whose door was read, leaving every other row byte-identical", () => {
    const table = [row({ over: {} }), row({ over: { id: "gmail" } }), row({ over: { id: "corpus" } })];
    const readings = new Map<string, ConnectionRouteReading>([
      ["drive", { connected: false, door: "drive", why: "no drive grant is stored on this install" }],
    ]);
    const graded = deriveConnectionCapabilities({ capabilities: table, readings });
    expect(graded[0]!.availability.kind).toBe("unavailable");
    expect(graded[1]).toBe(table[1]);
    expect(graded[2]).toBe(table[2]);
  });
});

describe("the generic table's door rows", () => {
  it("declares all five doors as available current-truth legs run through the bundled launcher", () => {
    const doors = GENERIC_SOURCE_CAPABILITIES.filter((capability) =>
      ["browser", "calendar", "drive", "gmail", "outlook"].includes(capability.id),
    );
    expect(doors.map((capability) => capability.id)).toEqual(["drive", "gmail", "outlook", "calendar", "browser"]);
    expect(doors.filter((capability) => capability.truthMode !== "current")).toEqual([]);
    expect(doors.filter((capability) => capability.availability.kind !== "available")).toEqual([]);
    expect(doors.filter((capability) => capability.command[0] !== "slopweaver")).toEqual([]);
  });

  it("never substitutes the question into a provider query, which is what produced the false empty", () => {
    const doors = GENERIC_SOURCE_CAPABILITIES.filter((capability) =>
      ["browser", "calendar", "drive", "gmail", "outlook"].includes(capability.id),
    );
    expect(doors.length).toBe(5);
    expect(doors.filter((capability) => capability.command.includes("{question}"))).toEqual([]);
  });
});
