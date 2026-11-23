/**
 * The registry guard over the committed forbidden-identifier rules: every hashed set holds exactly the number
 * of digests the generator wrote, every entry is a digest and nothing else, and every location rule is the
 * global, case-insensitive shape the scanner expects.
 */
import { describe, expect, it } from "vitest";

import { FORBIDDEN_EXACT_IDS } from "../../../hygiene/forbiddenExactIds.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { markerIsRequired } from "../../../hygiene/locationMarker.js";
import { PROVIDER_LOCATION_RULES } from "../../../hygiene/providerLocations.js";

const DIGEST = /^[0-9a-f]{64}$/;
const { hashed } = FORBIDDEN_IDENTIFIER_RULES;

/** Every hashed set as plain digests, substring rows reduced to their digest. */
const DIGEST_SETS: Readonly<Record<string, readonly string[]>> = {
  embeddedUpper: hashed.embeddedUpper,
  exactIds: hashed.exactIds,
  exemptTicketReferences: hashed.exemptTicketReferences,
  spanHeads: hashed.spanHeads,
  substringCi: hashed.substringCi.map((rule) => rule.hash),
  substringCs: hashed.substringCs.map((rule) => rule.hash),
  teamKeys: hashed.teamKeys,
  wordCi: hashed.wordCi,
  wordCs: hashed.wordCs,
};

describe("FORBIDDEN_IDENTIFIER_RULES.hashed", () => {
  it("takes its exact-id set from the sibling module that holds it", () => {
    expect(hashed.exactIds).toBe(FORBIDDEN_EXACT_IDS);
  });

  it("holds exactly the generated number of rules in each set", () => {
    expect(Object.fromEntries(Object.entries(DIGEST_SETS).map(([name, set]) => [name, set.length]))).toEqual({
      embeddedUpper: 10,
      exactIds: 126,
      exemptTicketReferences: 1,
      spanHeads: 38,
      substringCi: 10,
      substringCs: 3,
      teamKeys: 10,
      wordCi: 51,
      wordCs: 82,
    });
  });

  it("stores nothing but lowercase SHA-256 hex — no set carries a plaintext token", () => {
    const all = Object.values(DIGEST_SETS).flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((entry) => !DIGEST.test(entry))).toEqual([]);
  });

  it("carries no duplicate within a set", () => {
    expect(
      Object.entries(DIGEST_SETS)
        .filter(([, set]) => new Set(set).size !== set.length)
        .map(([name]) => name),
    ).toEqual([]);
  });

  it("gives every substring rule a positive whole-number window", () => {
    const rows = [...hashed.substringCi, ...hashed.substringCs];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((rule) => !Number.isInteger(rule.length) || rule.length <= 0)).toEqual([]);
  });

  it("holds exactly the two fields a substring row needs", () => {
    const rows = [...hashed.substringCi, ...hashed.substringCs];
    expect(rows.filter((rule) => Object.keys(rule).toSorted().join(",") !== "hash,length")).toEqual([]);
  });
});

describe("PROVIDER_LOCATION_RULES", () => {
  it("is the rule set the committed rules compose", () => {
    expect(FORBIDDEN_IDENTIFIER_RULES.providerLocations).toBe(PROVIDER_LOCATION_RULES);
  });

  it("covers the seven providers, each pattern global and case-insensitive with one capture", () => {
    expect(PROVIDER_LOCATION_RULES.map((rule) => rule.provider)).toEqual([
      "slack",
      "linear",
      "trelica",
      "1password",
      "atlassian",
      "cloudflare-access",
      "datadog",
    ]);
    expect(PROVIDER_LOCATION_RULES.filter((rule) => rule.re.flags !== "gi")).toEqual([]);
  });

  it("gives every rule a lowercase marker its pattern provably requires, so every rule earns the skip", () => {
    expect(
      PROVIDER_LOCATION_RULES.filter(
        (rule) => rule.marker !== rule.marker.toLowerCase() || !markerIsRequired({ marker: rule.marker, re: rule.re }),
      ).map((rule) => rule.provider),
    ).toEqual([]);
  });

  it("lists every allowed label once, lowercase, as a valid hostname label", () => {
    const bad = PROVIDER_LOCATION_RULES.flatMap((rule) => {
      const allowed: readonly string[] = rule.allowed;
      return allowed.filter((label, index) => !/^[a-z0-9][a-z0-9-]*$/.test(label) || allowed.indexOf(label) !== index);
    });
    expect(bad).toEqual([]);
  });
});
