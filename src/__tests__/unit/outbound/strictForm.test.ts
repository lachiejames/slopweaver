import { describe, expect, it } from "vitest";
import { z } from "zod";

import { nearestField } from "../../../lib/nearestField.js";
import { strictForm, unknownKeyMessage } from "../../../outbound/strictForm.js";

/** A form with field names close enough to each other to exercise the suggestion boundary. */
const FORM = strictForm({
  citationUrl: z.url().optional(),
  count: z.number(),
  severity: z.enum(["red", "green"]),
  substance: z.string().optional(),
  title: z.string(),
});

const KNOWN = ["citationUrl", "count", "owner", "severity", "state", "substance", "ticket", "title", "trend"];

/** The single issue a strict object raises for unknown keys. */
function refusalOf({ input }: { input: unknown }): string {
  const parsed = FORM.safeParse(input);

  expect(parsed.success).toBe(false);
  return z.prettifyError(parsed.error!);
}

const VALID = { count: 1, severity: "red" as const, title: "t" };

describe("nearestField", () => {
  it("suggests the field a one-character typo meant", () => {
    expect(nearestField({ key: "sevrity", known: KNOWN })).toBe("severity");
  });

  it("suggests across a case slip, because capitalisation is not a different word", () => {
    expect(nearestField({ key: "Substance", known: KNOWN })).toBe("substance");
  });

  it("reaches a longer field that CONTAINS the key, which edit distance alone would miss", () => {
    expect(nearestField({ key: "citation", known: KNOWN })).toBe("citationUrl");
  });

  it("suggests the singular when a plural was written", () => {
    expect(nearestField({ key: "citationUrls", known: KNOWN })).toBe("citationUrl");
  });

  it("returns nothing for a field from ANOTHER schema — a least-bad guess would point somewhere wrong", () => {
    expect(nearestField({ key: "impact", known: KNOWN })).toBe(undefined);
    expect(nearestField({ key: "rootCause", known: KNOWN })).toBe(undefined);
    expect(nearestField({ key: "fixStep", known: KNOWN })).toBe(undefined);
  });

  it("returns nothing when there are no fields at all", () => {
    expect(nearestField({ key: "anything", known: [] })).toBe(undefined);
  });

  it("prefers the closer of two candidates, and breaks a tie on the name", () => {
    expect(nearestField({ key: "titl", known: ["title", "trend"] })).toBe("title");
    expect(nearestField({ key: "aa", known: ["ab", "ac"] })).toBe("ab");
  });
});

describe("unknownKeyMessage", () => {
  it("names the key, the suggestion, and the full field list", () => {
    const message = unknownKeyMessage({ keys: ["sevrity"], known: KNOWN });

    expect(message).toBe(
      'unknown field "sevrity" — REFUSED, not ignored. Did you mean "severity"?\n' +
        "this form's fields are: citationUrl, count, owner, severity, state, substance, ticket, title, trend",
    );
  });

  it("says so plainly when nothing is close, rather than inventing a nearest match", () => {
    expect(unknownKeyMessage({ keys: ["impact"], known: KNOWN })).toContain("No field here is close to it");
  });

  it("gives EVERY rejected key its own line, so one run reports all of them", () => {
    const lines = unknownKeyMessage({ keys: ["impact", "fixStep", "rootCause"], known: KNOWN }).split("\n");

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('"impact"');
    expect(lines[1]).toContain('"fixStep"');
    expect(lines[2]).toContain('"rootCause"');
    expect(lines[3]).toContain("this form's fields are:");
  });

  it("lists the fields SORTED, so the message is stable whatever order the shape was written in", () => {
    expect(unknownKeyMessage({ keys: ["x"], known: ["zeta", "alpha", "mid"] })).toContain(
      "this form's fields are: alpha, mid, zeta",
    );
  });
});

describe("strictForm — the refusal that used to be a silent strip", () => {
  it("accepts a form with only declared fields", () => {
    expect(FORM.safeParse(VALID).success).toBe(true);
  });

  it("REFUSES an unknown key instead of dropping it", () => {
    expect(FORM.safeParse({ ...VALID, impact: "the whole point" }).success).toBe(false);
  });

  it("does NOT strip: the accepted output has exactly the declared fields", () => {
    const parsed = FORM.safeParse(VALID);

    expect(Object.keys(parsed.data!).toSorted()).toEqual(["count", "severity", "title"]);
  });

  it("names the key and the nearest field in the raised message", () => {
    expect(refusalOf({ input: { ...VALID, sevrity: "red" } })).toContain('Did you mean "severity"?');
  });

  it("reports the ported-payload keys that caused this, all in one parse", () => {
    const message = refusalOf({
      input: { ...VALID, fixStep: "c", impact: "a", rootCause: "b" },
    });

    expect(message).toContain('"impact"');
    expect(message).toContain('"rootCause"');
    expect(message).toContain('"fixStep"');
  });
});

describe("strictForm — the custom message replaces ONLY the unknown-key wording", () => {
  it("keeps Zod's own message for a wrong field type", () => {
    expect(refusalOf({ input: { ...VALID, count: "twelve" } })).toContain("expected number");
  });

  it("keeps Zod's own message for a missing required field", () => {
    expect(refusalOf({ input: { severity: "red", title: "t" } })).toContain("expected number");
  });

  it("keeps Zod's own message when the input is not an object at all", () => {
    expect(refusalOf({ input: "not an object" })).toContain("expected object");
  });

  it("keeps Zod's own message for a bad enum value", () => {
    expect(refusalOf({ input: { ...VALID, severity: "purple" } })).toContain("severity");
  });
});
