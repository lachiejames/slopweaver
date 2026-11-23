import { describe, expect, it } from "vitest";
import { parseCommRows } from "../../../../../live/machine/capacityParse.js";

describe("parseCommRows", () => {
  it("keeps embedded spaces in comm intact, since comm is always the last field", () => {
    const rows = parseCommRows({
      text: "100 /System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds\n200 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)\n",
    });
    expect(rows).toEqual([
      { comm: "/System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds", pid: 100 },
      { comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)", pid: 200 },
    ]);
  });

  it("drops a line that does not start with a pid", () => {
    expect(parseCommRows({ text: "not-a-pid some/command\n" })).toEqual([]);
  });
});
