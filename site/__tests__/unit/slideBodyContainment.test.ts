/**
 * A panel's body column can never be widened by what it holds (`../../app/console-tw.css` `.sw-slide-body`).
 *
 * A 300-character URL in a card's quoted thread drew as a chip whose truncating label
 * still contributed its whole width to min-content, so every nested auto-track grid between the body column and the
 * chip grew to the URL's width and ran under the facts column. The unit lane runs no browser, so layout itself is not
 * measured here — the before and after are photographs in the pull request. What this holds is the two halves of the
 * fix: the rule, in a layer every utility still beats, and every slide body carrying the class it hangs on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SITE = join(import.meta.dirname, "../..");

/** The console stylesheet, whitespace collapsed so a reflow by the formatter does not move the assertion. */
const CSS = readFileSync(join(SITE, "app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");

/** The shell every opened card and tile draws its body in. */
const SLIDE_OVER = readFileSync(join(SITE, "components/live/SlideOver.tsx"), "utf8").replaceAll(/\s+/gu, " ");

/**
 * The text of one exported class constant in `SlideOver.tsx`.
 *
 * @param name the constant's identifier
 * @returns the string literal it is assigned
 */
function constantOf({ name }: { name: string }): string {
  return new RegExp(`export const ${name} = "([^"]*)";`, "u").exec(SLIDE_OVER)![1];
}

/**
 * The body of the stylesheet's `@layer components { … }` block, up to its first top-level rule outside it.
 *
 * @returns the block's text
 */
function componentsLayer(): string {
  const start = CSS.indexOf("@layer components {");
  const end = CSS.indexOf(".sw-titlebar {", start);
  return CSS.slice(start, end);
}

describe("a slide body's columns cannot be widened by their content", () => {
  it("zeroes the automatic minimum of every grid item inside a slide body and caps it at its grid area, in the components layer", () => {
    expect(componentsLayer()).toContain(".sw-slide-body :where(.grid) > * { min-width: 0; max-width: 100%; }");
  });

  it("wraps a long token at the edge of its box inside a slide body, without shrinking any box's minimum", () => {
    expect(componentsLayer()).toContain(".sw-slide-body { overflow-wrap: break-word; }");
  });

  it("puts both rules below the utilities layer, so an explicit min-w-* or max-w-* on an element still wins", () => {
    expect(CSS).toContain("@layer theme, base, components, console, utilities;");
  });

  it("hangs the class on every slide body arrangement: the two-column one, the folded one and a session's", () => {
    expect(
      ["SLIDE_BODY", "SLIDE_BODY_FOLDED", "SLIDE_BODY_SESSION"].map((name) => constantOf({ name }).split(" ")[0]),
    ).toEqual(["sw-slide-body", "sw-slide-body", "sw-slide-body"]);
  });

  it("splits a session's body four fifths to one, its property column sticky until the body stacks", () => {
    expect([
      constantOf({ name: "SLIDE_BODY_SESSION" }).includes("grid-cols-[minmax(0,4fr)_minmax(12rem,1fr)]"),
      constantOf({ name: "SLIDE_ASIDE_STICKY" }),
    ]).toEqual([true, "sticky top-0 self-start max-[900px]:static"]);
  });
});

/** The Queue panels' reasoning, whitespace collapsed for the same reason as the shell above. */
const REASONING = readFileSync(join(SITE, "components/console/PanelReasoning.tsx"), "utf8").replaceAll(/\s+/gu, " ");

describe("a Queue panel's body fills its width at every scroll position", () => {
  // Scrolled down a card, its body was a narrow column at the right edge —
  // the Checked section's hundred-odd lines in the 300px column, long after the card beside them had ended. Those lines
  // now appear only once the owner opens the Checked fold, and opened they still span the body.
  it("draws the Checked section across the whole body, not in the 300px column", () => {
    expect(REASONING).toContain(
      '<div className={cn(SLIDE_SECTION, REASONING_TEXT, "col-span-full border-t-border")} data-currency={mark.kind}> <div className="flex items-start justify-between gap-2"> <CheckedFold mark={mark} />',
    );
  });

  it("places the Checked section after the column closes, as its own item of the body's grid", () => {
    expect(REASONING).toContain("</aside> <CheckedSection card={card} /> </>");
  });

  it("draws the Checked section exactly once", () => {
    expect(REASONING.split("<CheckedSection card={card} />").length).toBe(2);
  });
});
