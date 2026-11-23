/*
 * The shared masker both console writers use: every credential and private-denylist hit in a string becomes
 * `[REDACTED:<label>]`, counted by label into the caller's running map, an identifier kept; and the labels a string
 * still carries, each once.
 */
import { describe, expect, it } from "vitest";

import { maskSecretString, secretLabelsIn } from "../../../hygiene/maskSecrets.js";

/** A GitHub token shape, built at run time so this file never carries one. */
const TOKEN = "ghp_" + "Z".repeat(30);

describe("maskSecretString", () => {
  it("masks every occurrence of a credential and a denylist word, case-blind for the word, adding to the counts", () => {
    const redactions = new Map<string, number>([["denylist", 2]]);
    const masked = maskSecretString({
      denylist: ["acmesecretword"],
      redactions,
      text: `${TOKEN} then ${TOKEN} near ACMESECRETWORD in C0SYN000001`,
    });
    expect(masked).toBe(
      "[REDACTED:github-oauth-token] then [REDACTED:github-oauth-token] near [REDACTED:denylist] in C0SYN000001",
    );
    expect([...redactions]).toEqual([
      ["denylist", 3],
      ["github-oauth-token", 2],
    ]);
  });

  it("leaves a string with no secret exactly as it was, counting nothing", () => {
    const redactions = new Map<string, number>();
    expect(maskSecretString({ denylist: [], redactions, text: "the pool hit 100" })).toBe("the pool hit 100");
    expect(redactions.size).toBe(0);
  });
});

describe("secretLabelsIn", () => {
  it("names each label a string still carries once, and none once it is masked", () => {
    const text = `${TOKEN} ${TOKEN} acmesecretword`;
    expect(secretLabelsIn({ denylist: ["acmesecretword"], text }).toSorted()).toEqual([
      "denylist",
      "github-oauth-token",
    ]);
    const masked = maskSecretString({ denylist: ["acmesecretword"], redactions: new Map(), text });
    expect(secretLabelsIn({ denylist: ["acmesecretword"], text: masked })).toEqual([]);
  });
});
