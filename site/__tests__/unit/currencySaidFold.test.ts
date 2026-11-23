/**
 * What the owner has said since a card was asked reaches the opened card only from inside one SHUT fold (AGENTS.md
 * rule 7).
 *
 * An uncapped Checked list ran 148 lines — one per unfiled supervisor-chat turn — and read as twenty screens of
 * pointers. The Checked lines are capped by `CheckedLines`' tuple type (`../../lib/cardCurrency.ts`, asserted in
 * `cardCurrency.test.ts`), and they and the said-since fold sit inside one closed Checked fold. The unit lane has no
 * `react-dom`, so the markup is not
 * rendered here — the before and after are photographs in the pull request. What this holds is what the cap hangs on:
 * no fold draws `open`, and the opened card reaches each line only through those folds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SITE = join(import.meta.dirname, "../..");

/** The fold's component, whitespace collapsed so a reflow by the formatter does not move the assertion. */
const FOLD = readFileSync(join(SITE, "components/console/CurrencySaid.tsx"), "utf8").replaceAll(/\s+/gu, " ");

/** The opened card's right-hand column, which draws the Checked section. */
const PANEL = readFileSync(join(SITE, "components/console/PanelReasoning.tsx"), "utf8").replaceAll(/\s+/gu, " ");

describe("the said-since fold", () => {
  it("is a details element that never opens itself", () => {
    expect(FOLD).toContain("<details data-said-since");
    expect(FOLD).not.toMatch(/<details[^>]*\bopen\b/u);
  });

  it("hangs no instant on a row's hover — the row's age is the time it shows", () => {
    expect(FOLD).toContain("row.where");
    expect(FOLD).not.toContain("title=");
    // The one read of the instant is the list key, which React never draws.
    expect(FOLD.match(/row\.atIso/gu)).toEqual(["row.atIso"]);
    expect(FOLD).toContain("key={`${row.atIso} ${String(at)}`}");
  });

  it("is the one way the Checked section draws what the owner said since", () => {
    expect(FOLD.match(/mark\.said\b/gu)).toEqual(["mark.said", "mark.said"]);
    expect(FOLD).toContain("{mark.said !== undefined && <SaidSince fold={mark.said} />}");
  });

  // No card carries a fold on how it was checked; docs/console says it.
  it("draws no fold on how the check was taken", () => {
    expect(FOLD).toContain("<details data-checked>");
    expect(FOLD).not.toContain("data-check-detail");
    expect(FOLD).not.toContain("mark.detail");
  });
});

/**
 * The Checked block at the bottom of an opened card is tucked under a fold so it does not clutter the page. The whole
 * section is one closed line.
 */
describe("the Checked section", () => {
  it("is one closed fold whose line names the mark, never opening itself", () => {
    expect(FOLD).toContain(
      '<details data-checked> <summary className="cursor-pointer text-[0.8rem] text-muted-foreground">Checked · {mark.words}</summary>',
    );
  });

  it("draws its lines and what the owner said since only inside that fold", () => {
    const inside = FOLD.slice(FOLD.indexOf("<details data-checked"));
    expect([
      inside.indexOf("mark.lines.map") > 0,
      inside.indexOf("<SaidSince fold={mark.said} />") > 0,
      inside.indexOf("</details>") > inside.indexOf("<SaidSince fold={mark.said} />"),
    ]).toEqual([true, true, true]);
  });

  it("is what the opened card draws, with no line of the mark left outside it", () => {
    expect(PANEL).toContain("<CheckedFold mark={mark} />");
    expect(PANEL.match(/mark\.(words|lines|said)\b/gu)).toBeNull();
  });
});
