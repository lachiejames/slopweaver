/*
 * `draftListLines`: the held-only view says how many rows it hides, an empty register reads differently from
 * one whose rows are all resolved, and `--all` prints every row with no footer.
 */
import { describe, expect, it } from "vitest";

import { draftListLines } from "../../../../../../cli/commands/slack/draftReport.js";
import { item, NO_MEDIA } from "./harness.js";

describe("draftListLines", () => {
  it("says how many rows the held-only view is hiding, so a filtered list cannot read as a drained one", () => {
    const lines = draftListLines({
      items: [item(), item({ over: { id: "sd-22222222" }, state: "dropped" })],
      mediaOf: NO_MEDIA,
      showResolved: false,
    });
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("sd-11111111");
    expect(lines[2]).toBe("1 released or dropped draft(s) hidden — `--all` shows them.");
  });

  it("distinguishes an empty register from one whose rows are all resolved", () => {
    expect(draftListLines({ items: [], mediaOf: NO_MEDIA, showResolved: false })).toEqual(["no parked drafts."]);
    expect(draftListLines({ items: [item({ state: "released" })], mediaOf: NO_MEDIA, showResolved: false })).toEqual([
      "no HELD drafts — 1 already released or dropped. `--all` shows them.",
    ]);
  });

  it("prints every row and no footer once --all included them", () => {
    const lines = draftListLines({
      items: [item(), item({ over: { id: "sd-2" }, state: "dropped" })],
      mediaOf: NO_MEDIA,
      showResolved: true,
    });
    expect(lines.length).toBe(2);
  });
});
