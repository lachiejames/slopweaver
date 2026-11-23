/*
 * `quoteAnchors`, the anchor check of a document comment: links Linear draws as chips, collapsible titles, struck
 * code, marks CommonMark leaves standing, and the block markers and broken rows of table cells.
 */
import { describe, expect, it } from "vitest";

import { quoteAnchors } from "../../../../../../cli/commands/linear/commentCore.js";

describe("quoteAnchors", () => {
  it("does not anchor in a link to Linear itself, which Linear draws as a chip (fallback review r10)", () => {
    const content =
      "the entitlement in [CCCC-1044](https://linear.app/acme/issue/CCCC-1044/gift-deposits), the duplicate row. " +
      "See [the runbook](<https://example.test/runbook>) and [image.png](https://uploads.linear.app/a/b.png) too.";

    expect(quoteAnchors({ content, quote: "the entitlement in CCCC-1044, the duplicate row." })).toBe(false);
    expect(quoteAnchors({ content, quote: "CCCC-1044" })).toBe(false);
    expect(quoteAnchors({ content, quote: "image.png" })).toBe(false);
    expect(quoteAnchors({ content, quote: "See the runbook and" })).toBe(true);
    expect(quoteAnchors({ content, quote: ", the duplicate row. See the runbook and" })).toBe(true);
  });

  it("does not anchor in a collapsible title drawn as a heading (fallback review r11)", () => {
    const content = "+++ ### Decision 3: daily options\n\nbody text\n\n+++\n\n+++ Plain title\n\nmore\n\n+++";

    expect(quoteAnchors({ content, quote: "### Decision 3: daily options" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Decision 3: daily options" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Plain title" })).toBe(true);
    expect(quoteAnchors({ content, quote: "body text" })).toBe(true);
  });

  it("does not anchor in struck-through code, whose strike marks Linear stores inside the backticks (r12)", () => {
    const content = "~~New ~~`~~ProtocolVariantGroup~~`~~ model~~ and `a ~ b` stays";

    expect(quoteAnchors({ content, quote: "New ~~ProtocolVariantGroup~~ model" })).toBe(false);
    expect(quoteAnchors({ content, quote: "ProtocolVariantGroup" })).toBe(false);
    expect(quoteAnchors({ content, quote: "a ~ b stays" })).toBe(true);
  });

  it("does not anchor in a table row the parser stopped reading as a table (fallback review r12)", () => {
    const content =
      "| Id | Step |\n| --- | --- |\n| O1 | first\n- nested |\n| O2 | Self-registration link for employees |";

    expect(quoteAnchors({ content, quote: "O2 | Self-registration link for employees" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Step" })).toBe(true);
  });

  it("reads a mark CommonMark left standing as a break, and an escaped one as itself (fallback review r13)", () => {
    expect(quoteAnchors({ content: "**Open (needs** @chai**):** confirm the scope.", quote: "**):** confirm" })).toBe(
      false,
    );
    expect(quoteAnchors({ content: "**No**** need for FSM:**", quote: "No** need" })).toBe(false);
    expect(quoteAnchors({ content: "3. ~~How would we rank? ~~**Resolved**", quote: "~~How would we" })).toBe(false);
    expect(quoteAnchors({ content: "* Item A + item B need consent\\\n\nnext", quote: "need consent\\" })).toBe(false);
    expect(quoteAnchors({ content: "a cell\n\nv2 - magic link. |", quote: "magic link. |" })).toBe(false);
    expect(quoteAnchors({ content: "**No**** need for FSM:**", quote: "need for FSM:" })).toBe(true);
    expect(quoteAnchors({ content: "price is 5 \\* 3 \\| \\~ each", quote: "5 * 3 | ~ each" })).toBe(true);
    expect(quoteAnchors({ content: "run `a*b_c|d` now", quote: "a*b_c|d" })).toBe(true);
  });

  it("does not anchor two code spans Linear stored as one, nor a block marker inside a cell (r13)", () => {
    expect(quoteAnchors({ content: "see `DailyDigest``ItemDefinition` here", quote: "DailyDigest``Item" })).toBe(false);
    const table = "| Kind | Holds |\n| --- | --- |\n| PII | - name, DOB |\n| 1 | 1. Browse |";

    expect(quoteAnchors({ content: table, quote: "- name, DOB" })).toBe(false);
    expect(quoteAnchors({ content: table, quote: "1. Browse" })).toBe(false);
    expect(quoteAnchors({ content: table, quote: "PII" })).toBe(true);
  });

  it("keeps a link to Linear a chip when its address carries an escape (fallback review r14)", () => {
    const escapedHost = "the entitlement in [CCCC-1044](https://linear\\.app/acme/issue/CCCC-1044/gift), the row.";
    const escapedScheme = "the entitlement in [CCCC-1044](https\\://linear.app/acme/issue/CCCC-1044/gift), the row.";

    expect(quoteAnchors({ content: escapedHost, quote: "in CCCC-1044, the row." })).toBe(false);
    expect(quoteAnchors({ content: escapedScheme, quote: "in CCCC-1044, the row." })).toBe(false);
    expect(quoteAnchors({ content: escapedHost, quote: "the entitlement in" })).toBe(true);
  });

  it("reads nothing in a document whose character references decode to the reader's own markers (r14)", () => {
    expect(quoteAnchors({ content: "foo&#xE002;bar and more", quote: "and more" })).toBe(false);
    expect(quoteAnchors({ content: "foo&#57346;bar and more", quote: "and more" })).toBe(false);
  });

  it("refuses a block marker behind a star bullet in a cell, a lone task box and edge whitespace (r14)", () => {
    const table = "| a | b |\n| --- | --- |\n| x | * [ ] task |";

    expect(quoteAnchors({ content: table, quote: "[ ] task" })).toBe(false);
    expect(quoteAnchors({ content: "- [ ]\n\ndone", quote: "[ ]" })).toBe(false);
    expect(quoteAnchors({ content: "- [x] done it", quote: " done it" })).toBe(false);
    expect(quoteAnchors({ content: "- [x] done it", quote: "done it" })).toBe(true);
  });

  it("reads a single tilde as a stray mark rather than a strikethrough (fallback review r14)", () => {
    const content = "Latency is ~5ms~ to ~6ms~ today.";

    expect(quoteAnchors({ content, quote: "Latency is 5ms to 6ms today." })).toBe(false);
    expect(quoteAnchors({ content, quote: "Latency is" })).toBe(true);
  });

  it("reads a block marker anywhere in a cell line, or after a stranded row's pipe, as a break (r15)", () => {
    const table =
      "| a | b |\n| --- | --- |\n| P1 | match the pause pattern for:1. Pause for 1 month&#10;2. Decide later |";
    const stranded = "a paragraph\n\n| 1. We split the exercises under each CarePlan. This does";

    expect(quoteAnchors({ content: table, quote: "pattern for:1. Pause for 1 month" })).toBe(false);
    expect(quoteAnchors({ content: table, quote: "1. Pause for 1 month" })).toBe(false);
    expect(quoteAnchors({ content: table, quote: "Pause for 1 month" })).toBe(true);
    expect(quoteAnchors({ content: stranded, quote: "1. We split the exercises" })).toBe(false);
    expect(quoteAnchors({ content: stranded, quote: "We split the exercises" })).toBe(true);
  });

  it("reads a collapsible before the cell rule, and a stranded row's pipe for its whole block (r16)", () => {
    const collapsible = "+++ Pool sizing | options\n\nbody\n\n+++";
    const headed = "+++ ### Decision 3 | daily\n\nbody\n\n+++";
    const stranded = "a paragraph\n\n| P1 | pause: intro\nthen:1. Pause\n2. Bench Press";

    expect(quoteAnchors({ content: collapsible, quote: "++" })).toBe(false);
    expect(quoteAnchors({ content: collapsible, quote: "Pool sizing" })).toBe(true);
    expect(quoteAnchors({ content: headed, quote: "Decision 3" })).toBe(false);
    expect(quoteAnchors({ content: stranded, quote: "then:1. Pause" })).toBe(false);
    expect(quoteAnchors({ content: stranded, quote: "2. Bench Press" })).toBe(false);
    expect(quoteAnchors({ content: stranded, quote: "Bench Press" })).toBe(true);
  });

  it("applies the cell rule to a broken row's later paragraph that holds no pipe of its own (r17)", () => {
    const content =
      "| Actions | Example |\n| -- | -- |\n| 1. Staff member builds a plan. \n\n | Workouts:* 2x Bench Press\n\n" +
      "Todo:* [ ] Rest a day\n\nNotes:1. Rest a day\n2. Hydrate well\n\n |\n| x | y |";

    expect(quoteAnchors({ content, quote: "[ ] Rest a day" })).toBe(false);
    expect(quoteAnchors({ content, quote: "2. Hydrate well" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Notes:1. Rest a day" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Hydrate well" })).toBe(true);
  });

  it("breaks at reference-shaped text in a cell's code span, since Linear writes a cell's newline as one (r19)", () => {
    const content = "| Step | Command |\n| --- | --- |\n| Build | `yarn install&#10;yarn build` |";

    expect(quoteAnchors({ content, quote: "yarn install&#10;yarn build" })).toBe(false);
    expect(quoteAnchors({ content, quote: "install&#10;yarn" })).toBe(false);
    expect(quoteAnchors({ content, quote: "yarn install" })).toBe(true);
    expect(quoteAnchors({ content, quote: "yarn build" })).toBe(true);
  });

  it("drops a collapsible marker that follows a cell's newline written as a reference (r19)", () => {
    const content = "| a | b |\n| - | - |\n| intro&#10;+++ Details&#10;body&#10;+++ | x |";

    expect(quoteAnchors({ content, quote: "++" })).toBe(false);
    expect(quoteAnchors({ content, quote: "+++ Details" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Details" })).toBe(true);
    expect(quoteAnchors({ content, quote: "body" })).toBe(true);
  });

  it("breaks where a code span's edge space was stripped, since the page may draw it (r20)", () => {
    const content = "use ` && ` between commands, and `^revert ` alone";

    expect(quoteAnchors({ content, quote: "use && between commands" })).toBe(false);
    expect(quoteAnchors({ content, quote: "&&" })).toBe(true);
    expect(quoteAnchors({ content, quote: "and ^revert  alone" })).toBe(true);
  });

  it("does not anchor a whitespace-only quote", () => {
    expect(quoteAnchors({ content: "two spaces", quote: " " })).toBe(false);
  });

  it("does not anchor in a bare URL, which Linear may draw as a chip", () => {
    const content = "tracked in https://linear.app/o/issue/INFR-12 for now";

    expect(quoteAnchors({ content, quote: "linear.app/o/issue/INFR-12" })).toBe(false);
    expect(quoteAnchors({ content, quote: "for now" })).toBe(true);
  });
});
