import { describe, expect, it } from "vitest";
import { heldBackLines } from "../../../../../cli/commands/briefing/renderDiagnostics.js";

describe("heldBackLines", () => {
  it("names every pull request the projection dropped, one line each", () => {
    expect(
      heldBackLines({
        heldBack: [
          { nativeId: "#1081", why: "the row is already ruled" },
          { nativeId: "#1082", why: "a session is still working it" },
        ],
      }),
    ).toEqual([
      "--open-prs held back 2 pull request(s) the run says are already settled or not the owner's move:",
      "  #1081: the row is already ruled",
      "  #1082: a session is still working it",
    ]);
  });

  it("says nothing at all when the projection held nothing back", () => {
    expect(heldBackLines({ heldBack: [] })).toEqual([]);
  });
});
