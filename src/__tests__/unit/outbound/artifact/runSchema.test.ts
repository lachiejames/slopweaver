/**
 * The inline-run vocabulary: one run of every kind parses back unchanged, the as-me drip union carries every
 * kind but the citation chip, a link label is capped at 120 characters, an empty sequence, an empty text run,
 * an unknown key and the derivation-only `quoted` flag are refused, and a Vanta policy-document address is
 * refused with the security-tasks page named in its place. The text, link and mention runs the no-fold form builds
 * its narrower union from each parse only their own kind.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  clickableUrlSchema,
  dripInlineRunSchema,
  inlineRunSchema,
  linkRunSchema,
  mentionRunSchema,
  runsSchema,
  textSpanRunSchema,
} from "../../../../outbound/artifact/runSchema.js";

const TEXT = { bold: true, code: false, italic: true, text: "staging pool", type: "text" };
const LINK = { label: "the dashboard", type: "link", url: "https://example.com/dash" };
const MENTION = { person: "U123", type: "mention" };
const GROUP = { handle: "platform", type: "group" };
const BROADCAST = { range: "here", type: "broadcast" };
const CITATION = { citationId: "c1", type: "citation" };

/** The messages of a refused parse, thrown on an accepted one so a test cannot read a success as a failure. */
function messagesOf({ result }: { result: z.ZodSafeParseResult<unknown> }): readonly string[] {
  if (result.success) {
    throw new Error("expected the parse to be refused");
  }
  return result.error.issues.map((issue) => issue.message);
}

describe("runsSchema", () => {
  it("parses one run of every inline kind back to exactly the input", () => {
    const runs = [TEXT, LINK, MENTION, GROUP, BROADCAST, CITATION];

    expect(runsSchema.parse(runs)).toEqual([
      { bold: true, code: false, italic: true, text: "staging pool", type: "text" },
      { label: "the dashboard", type: "link", url: "https://example.com/dash" },
      { person: "U123", type: "mention" },
      { handle: "platform", type: "group" },
      { range: "here", type: "broadcast" },
      { citationId: "c1", type: "citation" },
    ]);
  });

  it("refuses an empty sequence, which would render nothing", () => {
    expect(runsSchema.safeParse([]).success).toBe(false);
    expect(runsSchema.safeParse([MENTION]).success).toBe(true);
  });
});

describe("inlineRunSchema", () => {
  it("accepts a 120-character link label and refuses a 121-character one", () => {
    expect(inlineRunSchema.safeParse({ ...LINK, label: "x".repeat(120) }).success).toBe(true);
    expect(inlineRunSchema.safeParse({ ...LINK, label: "x".repeat(121) }).success).toBe(false);
  });

  it("accepts a bold link and refuses a bold flag that is not a boolean", () => {
    expect(inlineRunSchema.parse({ ...LINK, bold: true })).toEqual({
      bold: true,
      label: "the dashboard",
      type: "link",
      url: "https://example.com/dash",
    });
    expect(inlineRunSchema.safeParse({ ...LINK, bold: "yes" }).success).toBe(false);
  });

  it("refuses an empty text run", () => {
    expect(inlineRunSchema.safeParse({ text: "", type: "text" }).success).toBe(false);
  });

  it("refuses an unknown key, naming the nearest declared field", () => {
    expect(messagesOf({ result: inlineRunSchema.safeParse({ ...MENTION, persons: "U9" }) })).toEqual([
      'unknown field "persons" — REFUSED, not ignored. Did you mean "person"?\nthis form\'s fields are: person, type',
    ]);
  });

  it("refuses the derivation-only quoted flag on a text run", () => {
    expect(inlineRunSchema.safeParse({ ...TEXT, quoted: true }).success).toBe(false);
  });

  it("refuses a broadcast range outside here and channel", () => {
    expect(inlineRunSchema.safeParse({ range: "everyone", type: "broadcast" }).success).toBe(false);
  });
});

describe("dripInlineRunSchema", () => {
  it("accepts the five as-me kinds and refuses a citation chip", () => {
    expect([TEXT, LINK, MENTION, GROUP, BROADCAST].map((run) => dripInlineRunSchema.safeParse(run).success)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(dripInlineRunSchema.safeParse(CITATION).success).toBe(false);
  });
});

describe("the text, link and mention constituents", () => {
  it("each parses its own kind back to exactly the input", () => {
    expect(textSpanRunSchema.parse(TEXT)).toEqual({
      bold: true,
      code: false,
      italic: true,
      text: "staging pool",
      type: "text",
    });
    expect(linkRunSchema.parse(LINK)).toEqual({
      label: "the dashboard",
      type: "link",
      url: "https://example.com/dash",
    });
    expect(mentionRunSchema.parse(MENTION)).toEqual({ person: "U123", type: "mention" });
  });

  it("each refuses every other kind, so a narrower union built from them stays narrow", () => {
    expect([LINK, MENTION, GROUP, BROADCAST, CITATION].map((run) => textSpanRunSchema.safeParse(run).success)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([TEXT, MENTION, GROUP, BROADCAST, CITATION].map((run) => linkRunSchema.safeParse(run).success)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([TEXT, LINK, GROUP, BROADCAST, CITATION].map((run) => mentionRunSchema.safeParse(run).success)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("the text run refuses the derivation-only quoted flag by name", () => {
    expect(messagesOf({ result: textSpanRunSchema.safeParse({ ...TEXT, quoted: true }) })).toEqual([
      'unknown field "quoted" — REFUSED, not ignored. No field here is close to it, so it is probably a field ' +
        "from another schema.\nthis form's fields are: bold, code, italic, text, type",
    ]);
  });

  it("the link run grades its URL with clickableUrlSchema, refusing a Vanta policy-document address", () => {
    const [message] = messagesOf({
      result: linkRunSchema.safeParse({ ...LINK, url: "https://app.vanta.com/c/acme/ws/doc/Secure%20Policy-abc123" }),
    });

    expect(message).toContain("a Vanta policy-document URL");
  });
});

describe("clickableUrlSchema", () => {
  it("accepts an ordinary Vanta page but refuses a policy-document render, naming the security-tasks page", () => {
    expect(clickableUrlSchema.parse("https://app.vanta.com/employee/onboarding")).toBe(
      "https://app.vanta.com/employee/onboarding",
    );

    const [message] = messagesOf({
      result: clickableUrlSchema.safeParse("https://app.vanta.com/c/acme/ws/doc/Secure%20Policy-abc123"),
    });

    expect(message).toContain("a Vanta policy-document URL");
    expect(message).toContain("Link https://app.vanta.com/employee/onboarding instead");
  });

  it("refuses a string that is not a URL", () => {
    expect(clickableUrlSchema.safeParse("not a url").success).toBe(false);
  });
});
