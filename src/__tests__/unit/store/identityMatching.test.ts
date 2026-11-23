/**
 * The pure comparisons identity resolution is built on.
 *
 * Every case here is a real shape from this install's own bronze or a documented provider behaviour, not
 * an invented string: the point of porting the archive's matcher was to reuse a design that had already
 * met real handles, and a test over `foo`/`bar` would prove none of it.
 */
import { describe, expect, it } from "vitest";

import {
  emailSimilarity,
  levenshteinDistance,
  nameSimilarity,
  normalizeEmail,
  normalizeName,
  stringSimilarity,
} from "../../../store/identity/matching.js";

// register-class: two-normalisers-decide-sameness (docs/recurring-failure-register/bindings.md)

describe("email normalisation", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail({ email: "  Ada.Owner@Acme.example  " })).toBe("ada.owner@acme.example");
  });

  it("strips plus-addressing on every host, because it is routing rather than identity", () => {
    expect(normalizeEmail({ email: "admin.user+clerk_test@acme.example" })).toBe("admin.user@acme.example");
  });

  it("strips dots for gmail, the one host that documents them as insignificant", () => {
    expect(normalizeEmail({ email: "first.last@gmail.com" })).toBe("firstlast@gmail.com");
  });

  it("keeps dots everywhere else, where they distinguish two real mailboxes", () => {
    expect(normalizeEmail({ email: "first.last@acme.example" })).toBe("first.last@acme.example");
  });

  it("returns a string with no at-sign unchanged rather than inventing a domain", () => {
    expect(normalizeEmail({ email: "U-First" })).toBe("u-first");
  });

  it("leaves a trailing at-sign alone rather than splitting on it", () => {
    expect(normalizeEmail({ email: "someone@" })).toBe("someone@");
  });

  it("keeps a local part with no tag whole", () => {
    expect(normalizeEmail({ email: "ops@acme.example" })).toBe("ops@acme.example");
  });

  it("keeps the empty text before a leading plus rather than the tagged local part", () => {
    expect(normalizeEmail({ email: "+alerts@acme.example" })).toBe("@acme.example");
  });
});

describe("name normalisation", () => {
  it("drops a title and lowercases", () => {
    expect(normalizeName({ name: "Dr. Sadie Chen" })).toBe("sadie chen");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeName({ name: "JULIAN   RAPATTONI" })).toBe("julian rapattoni");
  });

  it("removes punctuation but keeps letters outside ASCII", () => {
    expect(normalizeName({ name: "Renée O'Brien" })).toBe("renée o brien");
  });

  it("answers the empty string for a name that is only punctuation", () => {
    expect(normalizeName({ name: "!!!" })).toBe("");
  });
});

describe("edit distance", () => {
  it("is zero for identical strings", () => {
    expect(levenshteinDistance({ left: "kitten", right: "kitten" })).toBe(0);
  });

  it("counts the three edits between kitten and sitting", () => {
    expect(levenshteinDistance({ left: "kitten", right: "sitting" })).toBe(3);
  });

  it("is the length of the other string when one is empty", () => {
    expect(levenshteinDistance({ left: "", right: "chen" })).toBe(4);
  });

  it("scores one for a literal match", () => {
    expect(stringSimilarity({ left: "chen", right: "chen" })).toBe(1);
  });

  it("scores zero against the empty string", () => {
    expect(stringSimilarity({ left: "chen", right: "" })).toBe(0);
  });
});

describe("email similarity", () => {
  it("scores one for the same address", () => {
    expect(emailSimilarity({ left: "a@acme.example", right: "A@Acme.example" })).toBe(1);
  });

  it("scores 0.95 for two spellings that normalise to one mailbox", () => {
    expect(emailSimilarity({ left: "a+tag@acme.example", right: "a@acme.example" })).toBe(0.95);
  });

  it("lifts the floor for a shared domain without reaching the auto-link bar", () => {
    expect(emailSimilarity({ left: "sadie@acme.example", right: "sadi@acme.example" })).toBeCloseTo(0.86, 2);
  });

  it("scores two different people at one company well below a match", () => {
    expect(emailSimilarity({ left: "sadie@acme.example", right: "julian@acme.example" })).toBeLessThan(0.6);
  });

  it("scores a different local part at a different host lowest of all", () => {
    expect(emailSimilarity({ left: "sadie@acme.example", right: "julian@other.example" })).toBeLessThan(0.2);
  });

  it("scores zero when one side is not an address at all", () => {
    expect(emailSimilarity({ left: "u-first", right: "a@acme.example" })).toBe(0);
  });
});

describe("name similarity", () => {
  it("scores one after normalisation", () => {
    expect(nameSimilarity({ left: "Sadie Chen", right: "sadie  chen" })).toBe(1);
  });

  it("scores an initial for a surname above the review floor", () => {
    expect(nameSimilarity({ left: "Sadie Chen", right: "Sadie C." })).toBeGreaterThanOrEqual(0.85);
  });

  it("scores a one-letter misspelling above the review floor", () => {
    expect(nameSimilarity({ left: "Sadie Chen", right: "Sadi Chen" })).toBeGreaterThanOrEqual(0.85);
  });

  it("scores two colleagues sharing a first name below the review floor", () => {
    expect(nameSimilarity({ left: "Sadie Chen", right: "Sadie Rapattoni" })).toBeLessThan(0.85);
  });

  it("scores two unrelated names low", () => {
    expect(nameSimilarity({ left: "Sadie Chen", right: "Julian Rapattoni" })).toBeLessThan(0.4);
  });

  it("scores zero when both sides normalise away, rather than one for two empty strings", () => {
    expect(nameSimilarity({ left: "!!!", right: "???" })).toBe(0);
  });
});
