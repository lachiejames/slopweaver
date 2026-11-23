/*
 * A fold (the release notes' "N more") opens on its first few entries and keeps the rest behind a "N more" fold.
 */
import { describe, expect, it } from "vitest";

import { foldList } from "../../lib/sidebarFold";

const COMMITS = { many: "commits", one: "commit" };

describe("foldList", () => {
  it("shows the lead entries and keeps the rest, in order, behind a counted label", () => {
    expect(foldList({ items: ["a", "b", "c", "d", "e"], noun: COMMITS, shown: 3 })).toEqual({
      hidden: ["d", "e"],
      more: "2 more commits",
      shown: ["a", "b", "c"],
    });
  });

  it("names a single hidden entry in the singular", () => {
    expect(foldList({ items: ["a", "b", "c", "d"], noun: COMMITS, shown: 3 }).more).toBe("1 more commit");
  });

  it("hides nothing and offers no label when the list fits", () => {
    expect(foldList({ items: ["a", "b", "c"], noun: COMMITS, shown: 3 })).toEqual({
      hidden: [],
      more: undefined,
      shown: ["a", "b", "c"],
    });
    expect(foldList({ items: ["a"], noun: COMMITS, shown: 3 })).toEqual({
      hidden: [],
      more: undefined,
      shown: ["a"],
    });
  });

  it("folds an empty list into two empty halves", () => {
    expect(foldList({ items: [], noun: COMMITS, shown: 3 })).toEqual({ hidden: [], more: undefined, shown: [] });
  });

  it("puts every entry behind the label when none is shown", () => {
    expect(foldList({ items: ["a", "b"], noun: COMMITS, shown: 0 })).toEqual({
      hidden: ["a", "b"],
      more: "2 more commits",
      shown: [],
    });
  });

  it("keeps each entry's identity, so a React key and a link survive the split", () => {
    const first = { sha: "1" };
    const fourth = { sha: "4" };
    const folded = foldList({ items: [first, { sha: "2" }, { sha: "3" }, fourth], noun: COMMITS, shown: 3 });
    expect(folded.shown[0]).toBe(first);
    expect(folded.hidden[0]).toBe(fourth);
  });

  it("holds every one of a full fifty-commit window, none dropped", () => {
    const window = Array.from({ length: 50 }, (_, index) => index);
    const folded = foldList({ items: window, noun: COMMITS, shown: 3 });
    expect([...folded.shown, ...folded.hidden]).toEqual(window);
    expect(folded.more).toBe("47 more commits");
  });
});
