/**
 * The board's reads — `list`, `row`, `steers` and `alignment-board` — split out of `handover.ts` so it stays under
 * the file-size cap.
 *
 * Declared metadata only — every entry is lazy, so nothing here loads a command module. What this file guards
 * is that the split dropped no verb from the one folded manifest, and that no read claims a write.
 */
import { describe, expect, it } from "vitest";

import { handoverManifest } from "../../../../cli/manifests/handover.js";
import { handoverBoardReadManifest } from "../../../../cli/manifests/handoverBoardReads.js";

describe("handoverBoardReadManifest", () => {
  it("holds exactly the whole-board read, the one-row read, the steers read and the Alignment projection read", () => {
    expect(Object.keys(handoverBoardReadManifest).toSorted()).toEqual(["alignment-board", "list", "row", "steers"]);
  });

  it("reaches the one folded manifest, so the split did not drop a verb", () => {
    expect(handoverManifest["list"]).toBe(handoverBoardReadManifest["list"]);
    expect(handoverManifest["row"]).toBe(handoverBoardReadManifest["row"]);
    expect(handoverManifest["steers"]).toBe(handoverBoardReadManifest["steers"]);
    expect(handoverManifest["alignment-board"]).toBe(handoverBoardReadManifest["alignment-board"]);
  });

  it("declares each as a diagnostic read that creates no work item, steers writing nothing at all", () => {
    const metas = [
      handoverBoardReadManifest["list"]!.meta,
      handoverBoardReadManifest["row"]!.meta,
      handoverBoardReadManifest["steers"]!.meta,
      handoverBoardReadManifest["alignment-board"]!.meta,
    ];
    expect(metas.map((meta) => [meta.effect, meta.diagnostic, meta.createsWorkItem])).toEqual([
      ["local-state", true, false],
      ["local-state", true, false],
      ["none", true, false],
      ["local-state", true, false],
    ]);
  });

  it("publishes the Alignment projection read's literal usage", () => {
    expect(handoverBoardReadManifest["alignment-board"]!.meta.usage).toBe(
      "usage: slopweaver handover alignment-board [--home <dir>] [--json]",
    );
  });
});
