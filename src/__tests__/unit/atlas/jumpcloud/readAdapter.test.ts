import { describe, expect, it } from "vitest";

import { readJumpcloudSnapshot } from "../../../../atlas/jumpcloud/readAdapter.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../../atlas/registry.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("readJumpcloudSnapshot", () => {
  it("refuses rather than answering zero devices to a question about this organisation's devices", () => {
    const result = readJumpcloudSnapshot();
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });

  it("names the command that would change the answer", () => {
    expect(unwrapErr(readJumpcloudSnapshot()).message).toContain("slopweaver atlas jumpcloud sync");
  });

  it("does not point the reader at a verb that answers with this same message", () => {
    expect(unwrapErr(readJumpcloudSnapshot()).message.includes("atlas jumpcloud coverage")).toBe(false);
  });

  it("says an empty answer would be indistinguishable from an organisation that holds no devices", () => {
    expect(unwrapErr(readJumpcloudSnapshot()).message).toContain(
      "indistinguishable from an organisation that holds none",
    );
  });

  it("refuses the same way whichever home it is pointed at, because no home has a generation yet", () => {
    expect(unwrapErr(readJumpcloudSnapshot({ home: "/nowhere/at/all" })).message).toBe(
      unwrapErr(readJumpcloudSnapshot()).message,
    );
  });
});

describe("the JumpCloud row in the atlas registry", () => {
  it("makes the platform reachable through the generic read seam", () => {
    expect(atlasPlatforms().includes("jumpcloud")).toBe(true);
  });

  it("resolves to a real registration rather than a name in a list", () => {
    expect(findAtlasPlatform({ platform: "jumpcloud" })?.platform).toBe("jumpcloud");
  });
});
