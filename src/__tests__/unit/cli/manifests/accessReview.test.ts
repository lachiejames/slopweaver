/**
 * The `access-review` noun's manifest, and the usage leaf it reads.
 *
 * Two properties, and both are ones review does not catch. The manifest's platform list is written in the
 * usage block by hand nowhere — it is derived from `ACCESS_LEVEL_TABLE` — so the check is that the derivation
 * holds: a platform added to the table appears in the block a caller is shown, and one removed disappears
 * from it. And each row's `load` is asserted to reach a real command, because a manifest naming a module that
 * does not export what it claims fails only when somebody runs that exact verb.
 */
import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE } from "../../../../accessReview/levels.js";
import {
  ACCESS_REVIEW_COMMON_USAGE,
  ACCESS_REVIEW_FORMER_USAGE,
  ACCESS_REVIEW_PLATFORM_USAGE,
  ACCESS_REVIEW_PRIVILEGED_USAGE,
} from "../../../../cli/commands/accessReview/usage.js";
import { accessReviewManifest } from "../../../../cli/manifests/accessReview.js";

const BLOCKS: readonly { readonly verb: string; readonly text: string }[] = [
  { text: ACCESS_REVIEW_FORMER_USAGE, verb: "former" },
  { text: ACCESS_REVIEW_PLATFORM_USAGE, verb: "platform" },
  { text: ACCESS_REVIEW_PRIVILEGED_USAGE, verb: "privileged" },
];

describe("the access-review manifest", () => {
  it("declares exactly the three verbs of the report", () => {
    expect(Object.keys(accessReviewManifest).toSorted()).toEqual(["former", "platform", "privileged"]);
  });

  it("carries a read-only, door-free meta on every row", () => {
    expect(Object.keys(accessReviewManifest).length).toBeGreaterThan(0);
    expect(
      Object.values(accessReviewManifest).map((entry) => ({
        door: entry.meta.doorRouted,
        effect: entry.meta.effect,
        work: entry.meta.createsWorkItem,
      })),
    ).toEqual([
      { door: false, effect: "none", work: false },
      { door: false, effect: "none", work: false },
      { door: false, effect: "none", work: false },
    ]);
  });

  it("gives every row the usage block of its own verb", () => {
    expect(Object.values(accessReviewManifest).map((entry) => entry.meta.usage.split("\n")[0]!)).toEqual([
      "usage: slopweaver access-review former [--json] [--home <dir>]",
      "usage: slopweaver access-review platform <platform> [--json] [--home <dir>]",
      "usage: slopweaver access-review privileged [--json] [--home <dir>]",
    ]);
  });

  it("loads a real command for every row", async () => {
    const loaded = await Promise.all(Object.values(accessReviewManifest).map(async (entry) => entry.load()));
    expect(loaded.map((command) => typeof command)).toEqual(["function", "function", "function"]);
  });
});

describe("the access-review usage blocks", () => {
  it("opens each block with the invocation it documents", () => {
    expect(BLOCKS.length).toBeGreaterThan(0);
    expect(
      BLOCKS.map((block) => block.text.split("\n")[0]!.startsWith(`usage: slopweaver access-review ${block.verb}`)),
    ).toEqual([true, true, true]);
  });

  it("ends every block with the tail that is true of all three", () => {
    expect(BLOCKS.map((block) => block.text.endsWith(ACCESS_REVIEW_COMMON_USAGE))).toEqual([true, true, true]);
  });

  it("derives the platform list from the level table rather than restating it", () => {
    expect(ACCESS_LEVEL_TABLE.length).toBeGreaterThan(0);
    expect(ACCESS_REVIEW_PLATFORM_USAGE).toContain(
      `  <platform>      one of: ${ACCESS_LEVEL_TABLE.map((spec) => spec.platform).join(", ")}`,
    );
  });
});
