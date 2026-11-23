/**
 * The CrowdStrike projection layering, asserted rather than described.
 *
 * `projection.ts` was one 551-line file holding the reader vocabulary, the record envelope and all ten
 * kinds' projections. Split, three things became checkable that were previously only true: the layers run
 * one way, the kinds partition cleanly across modules, and the browser-walk projections reach none of the
 * reader vocabulary — so a console record cannot imply the `privacy.ts` allowlist check that only
 * {@link ../../../../atlas/crowdstrike/projectionReaders.readField} performs.
 *
 * The substitution helpers are here too, because `readStringOr` and `firstOf` are different acts that an
 * inline `??` spelled identically: one carries a placeholder into a record, the other
 * answers the first of several spellings of one fact and stays nullable when none read.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import { crowdstrikeSource } from "../../../../atlas/crowdstrike/projectionEnvelope.js";
import { firstOf, readBooleanOr, readField, readStringOr } from "../../../../atlas/crowdstrike/projectionReaders.js";

/** Every module of the family, in the order a lower layer may never import an upper one. */
const LADDER = [
  "projectionReaders.ts",
  "projectionEnvelope.ts",
  "projectHosts.ts",
  "projectPolicies.ts",
  "projectVulnerabilities.ts",
  "projectZeroTrust.ts",
  "projectDetections.ts",
  "projectConsole.ts",
] as const;

/** The six that project an entity; the first two are vocabulary and envelope. */
const PROJECTORS = LADDER.slice(2);

const sourceOf = ({ file }: { file: string }): string =>
  readFileSync(new URL(`../../../../atlas/crowdstrike/${file}`, import.meta.url), "utf8");

/** Which sibling modules `file` imports from, ignoring every import outside this family. */
const familyImportsOf = ({ file }: { file: string }): readonly string[] =>
  [...sourceOf({ file }).matchAll(/from "\.\/(\w+)\.js";/gu)]
    .map((m) => `${m[1]!}.ts`)
    .filter((name) => LADDER.includes(name as (typeof LADDER)[number]));

/** Which of the atlas's ten kinds a module names in its own source. */
const kindsClaimedBy = ({ file }: { file: string }): readonly string[] => {
  const text = sourceOf({ file });
  return CROWDSTRIKE_KINDS.filter((kind) => text.includes(`"${kind}"`));
};

const AT = "2026-09-04T00:00:00.000Z";

describe("the module ladder", () => {
  it("covers every module the family has", () => {
    expect(LADDER.length).toBe(8);
    expect(PROJECTORS.length).toBe(6);
  });

  it("has no backward import edge", () => {
    const backwards = LADDER.flatMap((file, depth) =>
      familyImportsOf({ file })
        .filter((target) => LADDER.indexOf(target as (typeof LADDER)[number]) >= depth)
        .map((target) => `${file} -> ${target}`),
    );
    expect(backwards).toEqual([]);
  });

  it("keeps the six projection modules independent of each other", () => {
    const crossEdges = PROJECTORS.flatMap((file) =>
      familyImportsOf({ file })
        .filter((target) => PROJECTORS.includes(target as (typeof PROJECTORS)[number]))
        .map((target) => `${file} -> ${target}`),
    );
    expect(crossEdges).toEqual([]);
  });

  it("gives every projection module the envelope", () => {
    const missing = PROJECTORS.filter((file) => !familyImportsOf({ file }).includes("projectionEnvelope.ts"));
    expect(missing).toEqual([]);
  });
});

describe("the kinds partition across modules", () => {
  it("claims all ten kinds exactly once", () => {
    expect(CROWDSTRIKE_KINDS.length).toBe(10);
    const claimed = PROJECTORS.flatMap((file) => kindsClaimedBy({ file }));
    expect(claimed.toSorted()).toEqual(CROWDSTRIKE_KINDS.toSorted());
  });

  it("files each kind under the module its API family names", () => {
    expect(kindsClaimedBy({ file: "projectHosts.ts" })).toEqual(["host", "host-group"]);
    expect(kindsClaimedBy({ file: "projectPolicies.ts" })).toEqual(["prevention-policy", "sensor-update-policy"]);
    expect(kindsClaimedBy({ file: "projectVulnerabilities.ts" })).toEqual(["vulnerability"]);
    expect(kindsClaimedBy({ file: "projectZeroTrust.ts" })).toEqual(["zero-trust-assessment", "zero-trust-audit"]);
    expect(kindsClaimedBy({ file: "projectDetections.ts" })).toEqual(["detection"]);
    expect(kindsClaimedBy({ file: "projectConsole.ts" })).toEqual(["console-page", "console-request"]);
  });

  it("leaves the vocabulary and the envelope claiming none", () => {
    expect(kindsClaimedBy({ file: "projectionReaders.ts" })).toEqual([]);
    expect(kindsClaimedBy({ file: "projectionEnvelope.ts" })).toEqual([]);
  });
});

describe("the console projections cannot reach the allowlist vocabulary", () => {
  it("imports nothing from the reader module", () => {
    expect(familyImportsOf({ file: "projectConsole.ts" })).toEqual(["projectionEnvelope.ts"]);
  });

  // The falsifiable half: the absence above is evidence only because every OTHER projection module
  // does import the readers, so the assertion would redden if the scan simply found nothing anywhere.
  it("is the only projection module that does not", () => {
    const withReaders = PROJECTORS.filter((file) => familyImportsOf({ file }).includes("projectionReaders.ts"));
    expect(withReaders).toEqual([
      "projectHosts.ts",
      "projectPolicies.ts",
      "projectVulnerabilities.ts",
      "projectZeroTrust.ts",
      "projectDetections.ts",
    ]);
  });
});

describe("readField normalises absence to null without swallowing a falsey value", () => {
  it("answers null for an absent key, an explicit null and a denied field", () => {
    expect(readField({ field: "hostname", raw: {} })).toBe(null);
    expect(readField({ field: "hostname", raw: { hostname: null } })).toBe(null);
    expect(readField({ field: "local_ip", raw: { local_ip: "10.0.0.4" } })).toBe(null);
  });

  it("keeps false, zero and the empty string, which are answers rather than absences", () => {
    expect(readField({ field: "enabled", raw: { enabled: false } })).toBe(false);
    expect(readField({ field: "score", raw: { score: 0 } })).toBe(0);
    expect(readField({ field: "hostname", raw: { hostname: "" } })).toBe("");
  });
});

describe("crowdstrikeSource fills its two optional fields without an operator", () => {
  it("reads an absent deep link as unverified rather than unavailable", () => {
    const source = crowdstrikeSource({ input: { endpoint: "/e", observedAt: AT, surface: "falcon-api" } });
    expect(source.deepLink).toBe(null);
    expect(source.deepLinkStatus).toBe("unverified");
    expect(source.artifacts).toEqual([]);
  });

  it("treats an explicit null deep link exactly as an absent one", () => {
    const source = crowdstrikeSource({
      input: { deepLink: null, endpoint: "/e", observedAt: AT, surface: "falcon-api" },
    });
    expect(source.deepLink).toBe(null);
    expect(source.deepLinkStatus).toBe("unverified");
  });

  it("credits the surface, not the presence of a link", () => {
    const walked = crowdstrikeSource({
      input: { deepLink: "https://falcon.example.test/h", endpoint: "/e", observedAt: AT, surface: "falcon-console" },
    });
    expect(walked.deepLinkStatus).toBe("browser-discovered");
    const api = crowdstrikeSource({
      input: { deepLink: "https://falcon.example.test/h", endpoint: "/e", observedAt: AT, surface: "falcon-api" },
    });
    expect(api.deepLinkStatus).toBe("provider-provided");
  });
});

describe("a substitution is named", () => {
  it("readStringOr carries the substitute in for an absent, blank or denied field", () => {
    expect(readStringOr({ field: "name", raw: {}, substitute: "unnamed group" })).toBe("unnamed group");
    expect(readStringOr({ field: "name", raw: { name: "   " }, substitute: "g1" })).toBe("g1");
    expect(readStringOr({ field: "local_ip", raw: { local_ip: "10.0.0.4" }, substitute: "withheld" })).toBe("withheld");
  });

  it("readStringOr passes a real answer through untouched but trimmed", () => {
    expect(readStringOr({ field: "name", raw: { name: "  Laptops " }, substitute: "g1" })).toBe("Laptops");
  });

  it("readBooleanOr substitutes for absent and for a non-boolean, and keeps an explicit false", () => {
    expect(readBooleanOr({ field: "enabled", raw: {}, substitute: false })).toBe(false);
    expect(readBooleanOr({ field: "enabled", raw: { enabled: "yes" }, substitute: true })).toBe(true);
    expect(readBooleanOr({ field: "enabled", raw: { enabled: false }, substitute: true })).toBe(false);
  });
});

describe("firstOf is a fallback between reads, not a substitution", () => {
  it("answers the most authoritative attempt that read", () => {
    expect(firstOf({ values: ["recent.user", "fallback.user"] })).toBe("recent.user");
    expect(firstOf({ values: [null, "fallback.user"] })).toBe("fallback.user");
    expect(firstOf({ values: [null, null, "third"] })).toBe("third");
  });

  // The property that separates it from readStringOr: no attempt reading is still an absence, so the
  // record carries null rather than a placeholder nothing downstream can tell from a real value.
  it("stays null when no attempt read", () => {
    expect(firstOf({ values: [null, null] })).toBe(null);
    expect(firstOf({ values: [] })).toBe(null);
  });
});
