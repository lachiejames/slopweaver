/**
 * The card subject form: a url, or words that begin with the exact lower-case `no page`, and nothing else.
 * The near-misses and the 300-character edge are the cases a loosened regex or cap would quietly pass.
 */
import { describe, expect, it } from "vitest";

import { NO_PAGE_REQUIRED_MESSAGE } from "../../../../briefing/cardSubject.js";
import { subjectSchema } from "../../../../outbound/briefing/subjectForm.js";
import { unknownKeyMessage } from "../../../../outbound/strictForm.js";

describe("subjectSchema", () => {
  it("parses a linked subject to exactly its input", () => {
    const subject = { text: "Renovate dashboard", url: "https://github.com/acme/widgets/issues/9" };
    const parsed = subjectSchema.safeParse(subject);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(subject);
  });

  it("parses an unlinked subject whose words declare it has no page", () => {
    const parsed = subjectSchema.safeParse({ text: "no page — the staging pool question" });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ text: "no page — the staging pool question" });
  });

  it("refuses an unlinked ordinary subject on `text`, with the no-page rule's own words", () => {
    const parsed = subjectSchema.safeParse({ text: "The staging pool question" });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["text"], NO_PAGE_REQUIRED_MESSAGE],
    ]);
  });

  it.each(["No page — capitalised", "no pages — plural"])("refuses the near-miss %j", (text) => {
    const parsed = subjectSchema.safeParse({ text });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual([NO_PAGE_REQUIRED_MESSAGE]);
  });

  it("accepts a subject of exactly 300 characters", () => {
    const text = `no page ${"a".repeat(292)}`;

    expect(text.length).toBe(300);
    expect(subjectSchema.safeParse({ text }).success).toBe(true);
  });

  it("refuses a subject of 301 characters on `text`", () => {
    const parsed = subjectSchema.safeParse({ text: `no page ${"a".repeat(293)}` });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => [issue.code, issue.path])).toEqual([["too_big", ["text"]]]);
  });

  it("refuses an unknown key rather than stripping it", () => {
    const parsed = subjectSchema.safeParse({
      colour: "red",
      text: "Renovate dashboard",
      url: "https://github.com/acme/widgets/issues/9",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ["unrecognized_keys", unknownKeyMessage({ keys: ["colour"], known: ["text", "url"] })],
    ]);
  });
});
