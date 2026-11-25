/**
 * `lapEvidenceChanged`, the pure half of the pin `--apply` takes before a lap tree goes: what was read now must
 * still earn the verdict the scan gave, or the tree is kept.
 */
import { describe, expect, it } from "vitest";

import type { LapTreeMarkerV1 } from "../../../worktree/lapTreeProvenance.js";
import { lapEvidenceChanged } from "../../../worktree/pruneLapPin.js";

const HEAD = "d".repeat(40);

const MARKER: LapTreeMarkerV1 = {
  kind: "github-lap-tree",
  mintedHead: HEAD,
  pid: 4242,
  processStart: "Thu Nov 26 09:00:00 2026",
  version: 1,
};

const MARKED = { kind: "marked", marker: MARKER } as const;

describe("lapEvidenceChanged", () => {
  it("clears a marked tree whose marker is the same and whose minter is still gone", () => {
    expect(
      lapEvidenceChanged({ evidence: MARKED, now: { head: HEAD, holderLive: false, kind: "marked", marker: MARKER } }),
    ).toBeNull();
  });

  it("keeps a marked tree whose minter is running now", () => {
    expect(
      lapEvidenceChanged({ evidence: MARKED, now: { head: HEAD, holderLive: true, kind: "marked", marker: MARKER } }),
    ).toBe("its minting lap, pid 4242, is running now — kept");
  });

  it("keeps a marked tree whose marker names another start stamp", () => {
    const now = {
      head: HEAD,
      holderLive: false,
      kind: "marked",
      marker: { ...MARKER, processStart: "later" },
    } as const;
    expect(lapEvidenceChanged({ evidence: MARKED, now })).toBe("its lap marker changed since the scan — kept");
  });

  it("keeps a tree whose provenance kind changed, or that is no longer lap-shaped", () => {
    expect(
      lapEvidenceChanged({ evidence: MARKED, now: { head: HEAD, kind: "unmarked", witness: "refs/heads/main" } }),
    ).toBe("its lap provenance is not what the scan read — kept");
    expect(lapEvidenceChanged({ evidence: MARKED, now: undefined })).toBe(
      "its lap provenance is not what the scan read — kept",
    );
  });

  it("clears an unmarked tree a kept ref still contains, and keeps one no kept ref does now", () => {
    const evidence = { kind: "unmarked", witness: "refs/heads/main" } as const;
    expect(lapEvidenceChanged({ evidence, now: { head: HEAD, kind: "unmarked", witness: "refs/tags/v1" } })).toBeNull();
    expect(lapEvidenceChanged({ evidence, now: { head: HEAD, kind: "unmarked", witness: null } })).toBe(
      "no kept ref contains its HEAD now, or which do could not be read — kept",
    );
  });
});
