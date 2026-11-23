/**
 * The `private-terms` noun's manifest: every verb writes only under the home, none routes through the door, and each
 * quotes the usage line its own parser builds.
 */
import { describe, expect, it } from "vitest";

import { type PrivateTermsVerb, privateTermsUsage } from "../../../../cli/commands/privateTerms/core.js";
import { privateTermsManifest } from "../../../../cli/manifests/privateTerms.js";
import { NOUN_GROUPS } from "../../../../cli/nounGroups.js";

const VERBS: readonly PrivateTermsVerb[] = [
  "add",
  "confirm",
  "list",
  "narrow",
  "remove",
  "review-prepare",
  "review-record",
];

describe("privateTermsManifest", () => {
  it("declares exactly the seven verbs", () => {
    expect(Object.keys(privateTermsManifest).toSorted()).toStrictEqual([...VERBS]);
  });

  it("claims local-state on every verb and routes none through the door", () => {
    const effects = new Set(Object.values(privateTermsManifest).map((entry) => entry.meta.effect));
    expect([...effects]).toStrictEqual(["local-state"]);
    expect(Object.values(privateTermsManifest).filter((entry) => entry.meta.doorRouted)).toStrictEqual([]);
  });

  it("marks only review-record diagnostic, since a BROKEN verdict exits 1 by design", () => {
    const diagnostic = Object.entries(privateTermsManifest)
      .filter(([, entry]) => entry.meta.diagnostic)
      .map(([verb]) => verb);
    expect(diagnostic).toStrictEqual(["review-record"]);
  });

  it.each(VERBS)("quotes %s's usage exactly as its parser's spec renders it", (verb) => {
    expect(privateTermsManifest[verb]!.meta.usage).toBe(privateTermsUsage({ verb }));
  });

  it("is registered on the noun barrel, so every verb is dispatchable by name", () => {
    expect(Object.keys(NOUN_GROUPS["private-terms"]!).toSorted()).toStrictEqual([...VERBS]);
  });
});
