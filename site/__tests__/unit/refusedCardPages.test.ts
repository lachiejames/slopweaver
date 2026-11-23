/**
 * A refused Queue card still draws its pages. The refused branch of `QueueCardBody` draws neither field set, so a
 * briefing `withBriefingPages` put on `card.pages` was invisible there while the voice read it through the card — the
 * class of drift on the refused branch. The site lane renders no component, so this reads the source,
 * as `plainWhyRenderers.test.ts` does: the refused branch's field list holds the pages row, and that row is the
 * pages list over `card.pages`, drawn when no links strip stands in for it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "../../components/console/QueueCardBody.tsx"), "utf8");

/** The refused branch: from its test to the folded branch that follows it. */
const REFUSED = SOURCE.slice(SOURCE.indexOf("if (refused !== undefined) {"), SOURCE.indexOf("if (folded) {"));

describe("a refused Queue card", () => {
  it("draws the pages row in its field list, beside the links row", () => {
    expect(REFUSED.replace(/\s+/gu, " ")).toContain("<dl className={FIELDS}> {linksRow} {pagesRow} <dt>card</dt>");
  });

  it("draws card.pages in that row whenever no links strip carries them", () => {
    expect(SOURCE.replace(/\s+/gu, " ")).toContain(
      "const pagesRow = links === undefined && card.pages.length > 0 && ( <> <dt>pages</dt> <dd> <PagesList pages={card.pages} /> </dd> </> );",
    );
  });
});
