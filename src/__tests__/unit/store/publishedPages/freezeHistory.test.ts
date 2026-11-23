/**
 * The held keys a new-history refusal names. The count itself is asked inside the freeze's transaction and is proven
 * on the integration lane; what is pure is which neighbours are worth a sentence.
 */
import { describe, expect, it } from "vitest";

import { freezeNeighbours } from "../../../../store/publishedPages/freezeHistory.js";

// The measured drift: `259` inside `…642592` became `260`, a distance of TWO, which is why the reach
// cannot be one.
const CANONICAL = "af415a0a-f9cd-43b1-aac2-187e71642592";
const DRIFTED = "af415a0a-f9cd-43b1-aac2-187e71642602";

describe("freezeNeighbours", () => {
  it("names the canonical key two edits from the drifted one, with its versions", () => {
    expect(freezeNeighbours({ held: [{ key: CANONICAL, versions: 568 }], key: DRIFTED })).toEqual([
      { distance: 2, key: CANONICAL, versions: 568 },
    ]);
  });

  it("names no key three edits away, nor the key itself", () => {
    expect(
      freezeNeighbours({
        held: [
          { key: "acme-abc", versions: 1 },
          { key: "acme-xyz", versions: 4 },
        ],
        key: "acme-abc",
      }),
    ).toEqual([]);
  });

  it("orders nearest first and stops at three", () => {
    const held = [
      { key: "acme-ab", versions: 1 },
      { key: "acme-ad", versions: 2 },
      { key: "acme-a", versions: 3 },
      { key: "acme-bd", versions: 4 },
      { key: "acme-ac", versions: 5 },
    ];

    expect(freezeNeighbours({ held, key: "acme-ac" }).map((row) => [row.key, row.distance])).toEqual([
      ["acme-ab", 1],
      ["acme-ad", 1],
      ["acme-a", 1],
    ]);
  });

  it("answers nothing over an empty store", () => {
    expect(freezeNeighbours({ held: [], key: "acme-new" })).toEqual([]);
  });
});
