// Who a line asks is asserted in `../../review/vulnReviewerChoice.test.ts`; this file reads the roster.
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { readVulnReviewerMap } from "../../../../live/vuln/reviewerMap.js";

const MAP = {
  defaults: ["rosa-org", "jasper-org"],
  fallbacks: ["tobias-org"],
  logins: { "jasper-org": "U-JASPER", "tobias-org": "U-TOBIAS", "Rosa-Org": "U-ROSA" },
};

/** A file read that answers with the given text, or throws as a missing file would. */
function reader({ text }: { text: string | undefined }) {
  return (): string => {
    if (text === undefined) {
      throw new Error("ENOENT: no such file or directory");
    }
    return text;
  };
}

/** Read the map from the given document. */
function readOf({ value }: { value: unknown }) {
  return readVulnReviewerMap({ home: "/home", readFile: reader({ text: JSON.stringify(value) }) });
}

describe("readVulnReviewerMap", () => {
  it("reads a well-formed roster, logins lower-cased so a roster entry finds its person", () => {
    const map = unwrap(readOf({ value: MAP }));

    expect(map.defaults).toEqual(["rosa-org", "jasper-org"]);
    expect(map.fallbacks).toEqual(["tobias-org"]);
    expect(map.logins["rosa-org"]).toBe("U-ROSA");
  });

  it("ignores a team table: a team never maps to a person", () => {
    const map = unwrap(readOf({ value: { ...MAP, teams: { "org/eng": "U-SADIE" } } }));

    expect(Object.keys(map)).toEqual(["defaults", "fallbacks", "logins"]);
  });

  it("reports an absent file by path, rather than reading as an empty map", () => {
    const read = readVulnReviewerMap({ home: "/home", readFile: reader({ text: undefined }) });

    expect(read.isErr() ? read.error.code : "").toBe("REVIEWER_MAP_UNREADABLE");
    expect(read.isErr() ? read.error.message : "").toContain("live/vuln/reviewers.json");
  });

  it("refuses text that is not JSON at all", () => {
    const read = readVulnReviewerMap({ home: "/home", readFile: reader({ text: "not json" }) });

    expect(read.isErr() ? read.error.code : "").toBe("REVIEWER_MAP_UNREADABLE");
  });

  it("refuses a map with no defaults, naming the shape it expects", () => {
    const read = readOf({ value: { ...MAP, defaults: [] } });

    expect(read.isErr() ? read.error.message : "").toContain("`defaults` (a non-empty list of logins)");
  });

  it("refuses a map missing its fallbacks list rather than reading it as none", () => {
    const read = readOf({ value: { defaults: MAP.defaults, logins: MAP.logins } });

    expect(read.isErr() ? read.error.message : "").toContain("`fallbacks` (a list of logins)");
  });

  it("refuses a roster login with no person, naming it", () => {
    const read = readOf({ value: { ...MAP, fallbacks: ["nobody-org"] } });

    expect(read.isErr() ? read.error.message : "").toContain("nobody-org is on the roster but not under `logins`");
  });

  it("refuses a roster login only an object's prototype answers for, rather than reading it as mapped", () => {
    const read = readOf({ value: { ...MAP, fallbacks: ["constructor"] } });

    expect(unwrapErr(read).message).toContain("constructor is on the roster but not under `logins`");
  });

  it("refuses a login mapped to an empty person key", () => {
    const read = readOf({ value: { ...MAP, logins: { ...MAP.logins, "jasper-org": "" } } });

    expect(read.isErr() ? read.error.code : "").toBe("REVIEWER_MAP_UNREADABLE");
  });
});
