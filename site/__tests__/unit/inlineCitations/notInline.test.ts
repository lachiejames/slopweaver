import { describe, expect, it } from "vitest";

import { notInline } from "../../../lib/inlineCitations";
import { pr } from "./fixtures";

describe("notInline", () => {
  it("names only the published pull requests no drawn sentence links, in the row's order", () => {
    const prUrls = [pr({ n: 16676 }), pr({ n: 99 }), pr({ n: 17560 }), pr({ n: 98 })];
    expect(notInline({ prUrls, texts: [`bump #16676 (${pr({ n: 16676 })})`, "and #17560 too"] })).toEqual([
      pr({ n: 99 }),
      pr({ n: 98 }),
    ]);
  });

  it("counts a linked tab as its pull request", () => {
    expect(notInline({ prUrls: [pr({ n: 7 })], texts: [`${pr({ n: 7 })}/files`] })).toEqual([]);
  });
});
