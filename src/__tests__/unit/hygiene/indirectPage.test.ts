/**
 * The indirect-candidate page — pure. Every term is synthetic (`ABC-1`, `en-ZZ`, `Zorblatt`).
 */
import { describe, expect, it } from "vitest";

import { groupOf, type IndirectPageFacts, renderIndirectPage } from "../../../hygiene/indirectPage.js";
import type { IndirectClass, IndirectPlace } from "../../../hygiene/indirectScan.js";

const FACTS: IndirectPageFacts = {
  binaryFiles: 2,
  committedLabel: "4 Nov 2026",
  filesScanned: 10,
  harvestMaxFiles: 3,
  harvestSkipped: 1,
  mapRows: 5,
  mapSha256: "0123456789abcdef0123456789abcdef",
  ref: "main",
  scannedLabel: "4 Nov 2026",
  sha: "abcdef0123456789abcdef0123456789abcdef01",
};

/** One class of one term, its places at the given paths. */
const oneTermClass = ({
  className,
  disposition,
  term,
  paths,
}: {
  className: string;
  disposition: IndirectPlace["disposition"];
  term: string;
  paths: readonly string[];
}): IndirectClass => {
  const places = paths.map((path, index) => ({
    className,
    disposition,
    excerpt: `line <${term}>`,
    line: index + 1,
    path,
    replacement: "XYZ-1",
    term,
  }));
  return {
    className,
    disposition,
    files: new Set(paths).size,
    hits: places.length,
    terms: [{ files: new Set(paths).size, hits: places.length, places, term }],
  };
};

describe("groupOf", () => {
  it.each([
    ["map:issue-key", "provider-identity"],
    ["map:person", "people"],
    ["map:locale", "business-and-geography"],
    ["harvest:proper-name", "harvest"],
  ])("%s groups under %s", (className, group) => {
    expect(groupOf({ className })).toBe(group);
  });
});

describe("renderIndirectPage", () => {
  const classes = [
    oneTermClass({ className: "map:issue-key", disposition: "remove", paths: ["a.ts", "b.ts"], term: "ABC-1" }),
    oneTermClass({ className: "map:locale", disposition: "aggregate", paths: ["c.ts", "c.ts", "d.ts"], term: "en-ZZ" }),
    oneTermClass({ className: "harvest:unknown-word", disposition: "review", paths: ["e.md"], term: "Zorblatt" }),
  ];
  const page = renderIndirectPage({ classes, facts: FACTS });

  it("leads on the remaining obvious places and the run's provenance", () => {
    expect(page).toContain('<p class="lede">2 obvious candidate places remain.');
    expect(page).toContain("main at <code>abcdef012345</code>");
    expect(page).toContain("<code>sha256:0123456789abcdef</code>");
    expect(page).toContain("spanning more than 3 files");
  });

  it("lists every place of a listed class, in code, and opens the remove class", () => {
    expect(page).toContain(
      "<details open><summary><code>map:issue-key</code> · remove · 2 places in 2 files · 1 terms",
    );
    expect(page).toContain("<td><code>a.ts:1</code></td><td><code>line &lt;ABC-1&gt;</code></td>");
    expect(page).toContain("<td><code>b.ts:2</code></td>");
  });

  it("reports an aggregate class as totals per term with its distinct files folded", () => {
    expect(page).toContain("<td><code>en-ZZ</code></td><td>3 places in 2 files</td>");
    expect(page).toContain("<summary>files</summary><code>c.ts\nd.ts</code>");
  });

  it("orders the groups people first and the harvest last", () => {
    const provider = page.indexOf("<h2>Provider identity</h2>");
    const geography = page.indexOf("<h2>Business and geography</h2>");
    const harvest = page.indexOf("<h2>Names nobody listed (dictionary harvest)</h2>");
    expect(provider).toBeGreaterThan(0);
    expect(geography).toBeGreaterThan(provider);
    expect(harvest).toBeGreaterThan(geography);
    expect(page).not.toContain("<h2>People</h2>");
  });
});
