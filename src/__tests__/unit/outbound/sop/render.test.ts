/**
 * What the SOP renderer emits — the house shape, and the two placement decisions that are not cosmetic.
 *
 * The body opens with a blockquote and the table-of-contents block, and the metadata sits under a heading:
 * `../../../../outbound/notion/aboveFold.ts` puts everything before the FIRST heading through the operator's
 * packing rules, and `Owner: … Last updated: …` is a colon-introduced list by construction.
 */
import { describe, expect, it } from "vitest";
import { SOP_FORM_EXAMPLE } from "../../../../cli/commands/sop/formExample.js";
import { notionAboveFoldCells } from "../../../../outbound/notion/aboveFold.js";
import { renderSop, sopEmoji, sopTitle, TOC, UNREVIEWED } from "../../../../outbound/sop/render.js";
import type { SopForm } from "../../../../outbound/sop/types.js";

const markdown = renderSop({ form: SOP_FORM_EXAMPLE });
const lines = markdown.split("\n");

/** Every `## ` heading the document carries, in order. */
const sections = lines.filter((line) => line.startsWith("## ")).map((line) => line.slice(3));

describe("the house shape", () => {
  it("emits the sections in the house order", () => {
    expect(sections).toEqual([
      "At a glance",
      "Purpose",
      "When this applies",
      "Scope",
      "Before you start",
      "Steps",
      "Exceptions",
      "Escalation",
      "Related",
      "Where this came from",
    ]);
  });

  it("opens with the unreviewed notice, then the contents block", () => {
    expect(lines[0]).toBe(UNREVIEWED);
    expect(lines[2]).toBe(TOC);
  });

  it("keeps the title and the icon out of the body, because both are Notion page properties", () => {
    expect(markdown).not.toContain(SOP_FORM_EXAMPLE.title);
    expect(markdown).not.toContain(SOP_FORM_EXAMPLE.emoji);
    expect(sopTitle({ form: SOP_FORM_EXAMPLE })).toBe("SOP: Granting a seat on the ticketing tool");
    expect(sopEmoji({ form: SOP_FORM_EXAMPLE })).toBe("📋");
  });
});

describe("the lead the Notion door will gate", () => {
  it("carries only the quoted notice and the contents block, so no metadata reaches the packing rules", () => {
    const cells = notionAboveFoldCells({ markdown });
    expect(cells.length).toBe(1);
    expect(cells[0]!.text).toBe(`${UNREVIEWED}\n\n${TOC}\n`);
  });
});

describe("steps", () => {
  it("numbers each step and names its actor on its own line", () => {
    expect(markdown).toContain("### 1. Check the approval is in writing\n\n**Who:** whoever is on the support rota");
    expect(markdown).toContain(
      "### 3. Reply in the thread with what was granted\n\n**Who:** whoever is on the support rota",
    );
  });
});

describe("the scope table is rectangular even when its two columns are not", () => {
  it("pads the shorter column rather than dropping the longer one's tail", () => {
    const form: SopForm = {
      ...SOP_FORM_EXAMPLE,
      scope: { covers: ["one", "two", "three"], doesNotCover: ["only this"] },
    };
    const rows = renderSop({ form })
      .split("\n")
      .filter((line) => line.startsWith("| one") || line.startsWith("| two") || line.startsWith("| three"));
    expect(rows).toEqual(["| one | only this |", "| two |  |", "| three |  |"]);
  });
});

describe("sections with nothing to say are omitted rather than emitted empty", () => {
  it("drops before-you-start, exceptions and related when they carry no rows", () => {
    const form: SopForm = { ...SOP_FORM_EXAMPLE, beforeYouStart: [], exceptions: [], related: [] };
    const emitted = renderSop({ form })
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    expect(emitted).toEqual([
      "At a glance",
      "Purpose",
      "When this applies",
      "Scope",
      "Steps",
      "Escalation",
      "Where this came from",
    ]);
  });
});

describe("the source is a link a reader can open", () => {
  it("renders it under its own section", () => {
    expect(markdown).toContain("Distilled from [the request thread](https://example.test/threads/1).");
  });
});
