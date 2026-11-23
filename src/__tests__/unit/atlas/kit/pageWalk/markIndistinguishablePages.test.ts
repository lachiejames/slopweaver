/**
 * The duplicate-picture check: two pages whose screenshots are the same file lose their artifacts, each naming
 * the other, which is how a sibling atlas once reported twenty-one photographed pages that were all the same
 * not-found shell.
 */
import { describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../../atlas/kit/pageScreenshot.js";
import { markIndistinguishablePages } from "../../../../../atlas/kit/pageWalk.js";

import { observation } from "./harness.js";

describe("markIndistinguishablePages", () => {
  const shot = screenshotArtifact({ artifactPathFor: ({ sha256 }) => sha256, bytes: new Uint8Array([9, 9, 9]) });

  it("strips the artifact from two pages whose picture is byte-identical", () => {
    const marked = markIndistinguishablePages({
      pages: [
        observation({ over: { artifacts: [shot], surface: "one" } }),
        observation({ over: { artifacts: [shot], surface: "two" } }),
      ],
    });
    expect(marked.map((page) => page.artifacts.length)).toEqual([0, 0]);
  });

  it("names the other page each shared picture belongs to", () => {
    const marked = markIndistinguishablePages({
      pages: [
        observation({ over: { artifacts: [shot], surface: "one" } }),
        observation({ over: { artifacts: [shot], surface: "two" } }),
      ],
    });
    expect(marked[0]!.screenshotMissingBecause).toContain("two");
  });

  it("leaves a page whose picture is its own alone", () => {
    const marked = markIndistinguishablePages({ pages: [observation({ over: { artifacts: [shot] } })] });
    expect(marked[0]!.artifacts).toEqual([shot]);
  });
});
