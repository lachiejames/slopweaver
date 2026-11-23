/*
 * How the Notion fetch turns provider text into corpus text: chunking a long doc, rendering rich text with its
 * link targets, flattening a data-source row's properties, and the per-type property dispatch table.
 */
import { describe, expect, it } from "vitest";
import { chunkText, renderProperty, renderRichText, renderRowProperties } from "../../../../../corpus/notion/fetch.js";

describe("chunkText", () => {
  it("returns no chunks for blank text", () => {
    expect(chunkText({ text: "   \n\n  " })).toEqual([]);
  });

  it("keeps a short doc as a single chunk", () => {
    expect(chunkText({ text: "one\n\ntwo" })).toEqual(["one\n\ntwo"]);
  });

  it("splits on paragraph boundaries when over the cap", () => {
    const chunks = chunkText({ maxChars: 6, text: "aaaa\n\nbbbb\n\ncccc" });
    expect(chunks).toEqual(["aaaa", "bbbb", "cccc"]);
  });
});

describe("renderRichText", () => {
  it("joins plain text and preserves link targets", () => {
    expect(renderRichText({ richText: [{ plain_text: "see " }, { href: "https://x.test", plain_text: "here" }] })).toBe(
      "see here (https://x.test)",
    );
  });

  it("returns empty for a non-array", () => {
    expect(renderRichText({ richText: undefined })).toBe("");
  });
});

describe("renderRowProperties (data-source rows are the actual records)", () => {
  it("extracts the title property and flattens the rest to `Name: value` lines", () => {
    const { title, text } = renderRowProperties({
      properties: {
        Done: { checkbox: false, type: "checkbox" },
        Name: { title: [{ plain_text: "Ship the migration" }], type: "title" },
        Owner: { people: [{ name: "Seth" }, { name: "Dana" }], type: "people" },
        Priority: { select: { name: "High" }, type: "select" },
        Status: { status: { name: "In progress" }, type: "status" },
      },
    });
    expect(title).toBe("Ship the migration");
    expect(text).toContain("Status: In progress");
    expect(text).toContain("Priority: High");
    expect(text).toContain("Owner: Seth, Dana");
    expect(text).not.toContain("Done:"); // an unchecked box renders empty → omitted, never faked
  });
});

describe("renderProperty (dispatch table)", () => {
  it("renders a title/rich_text property via rich text", () => {
    expect(renderProperty({ value: { title: [{ plain_text: "Roadmap" }], type: "title" } })).toBe("Roadmap");
  });

  it("renders a rich_text property with a link as text (url)", () => {
    expect(
      renderProperty({ value: { rich_text: [{ href: "https://x.dev", plain_text: "see" }], type: "rich_text" } }),
    ).toBe("see (https://x.dev)");
  });

  it("renders select and status names", () => {
    expect(renderProperty({ value: { select: { name: "Done" }, type: "select" } })).toBe("Done");
    expect(renderProperty({ value: { status: { name: "In Progress" }, type: "status" } })).toBe("In Progress");
  });

  it("comma-joins multi_select and people names", () => {
    expect(renderProperty({ value: { multi_select: [{ name: "a" }, { name: "b" }], type: "multi_select" } })).toBe(
      "a, b",
    );
    expect(renderProperty({ value: { people: [{ name: "Ada" }], type: "people" } })).toBe("Ada");
  });

  it("renders a number", () => {
    expect(renderProperty({ value: { number: 42, type: "number" } })).toBe("42");
  });

  it("renders checkbox true as yes and false as empty", () => {
    expect(renderProperty({ value: { checkbox: true, type: "checkbox" } })).toBe("yes");
    expect(renderProperty({ value: { checkbox: false, type: "checkbox" } })).toBe("");
  });

  it("renders a date with start and optional end", () => {
    expect(renderProperty({ value: { date: { start: "2026-01-01" }, type: "date" } })).toBe("2026-01-01");
    expect(renderProperty({ value: { date: { end: "2026-01-02", start: "2026-01-01" }, type: "date" } })).toBe(
      "2026-01-01 → 2026-01-02",
    );
  });

  it("renders url/email/phone_number scalar strings", () => {
    expect(renderProperty({ value: { type: "url", url: "https://x.dev" } })).toBe("https://x.dev");
    expect(renderProperty({ value: { email: "a@b.co", type: "email" } })).toBe("a@b.co");
  });

  it("renders a relation as a linked count", () => {
    expect(renderProperty({ value: { relation: [{}, {}], type: "relation" } })).toBe("2 linked");
  });

  it("returns empty for an unknown type or a non-object value", () => {
    expect(renderProperty({ value: { type: "mystery" } })).toBe("");
    expect(renderProperty({ value: 5 })).toBe("");
  });
});
