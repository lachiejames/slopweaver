/**
 * Where and under what the wake's `handover finish` runs: in the parked seat's own recorded worktree, which its
 * probes resolve against, or the state home once that worktree is gone; bound to its park by
 * `--parked-at`; and under the same per-park wake claim a reseat holds, so a finish never runs beside another
 * wake's reseat of the same park.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { claimWakePark } from "../../../../../../handover/wakeJournalStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

/** The one park every case here writes: `landed`, its park the run journal's third line. */
const PARK = { parkIndex: 2, parkedAtIso: "2026-10-15T02:00:00.000Z", slug: "landed" } as const;

/**
 * Take the park's claim as another wake would, or throw when it was not free.
 *
 * @returns the claim's release
 */
function takeClaim({ home }: { home: string }): () => void {
  const claim = unwrap(claimWakePark({ ...PARK, home, nowIso: NOW.toISOString() }));
  if (claim.kind !== "claimed") {
    throw new Error(`the park's claim was not free: ${claim.reason}`);
  }
  return claim.release;
}

describe("handover wake's finish ask", () => {
  let home: string;

  beforeEach(() => {
    ({ home } = mintWakeHome());
    parkedRow({ slug: PARK.slug, wake: { kind: "checks", number: 7, repo: "o/r" } });
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("runs handover finish bound to its park, in the seat's worktree while it exists and else the state home", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "wt-"));
    parkedRow({ slug: "kept", wake: { kind: "checks", number: 8, repo: "o/r" }, worktree });
    const recorded = record();
    const merged = { prState: "MERGED" } as const;
    const deps = fakes({ checks: { 7: merged, 8: merged }, finishes: { kept: 0, landed: 0 }, recorded });
    await wakeJson({ deps, recorded });
    expect([recorded.finished, recorded.finishCwds, recorded.finishParks]).toEqual([
      ["kept", "landed"],
      [worktree, home],
      ["2@2026-10-15T02:00:00.000Z", "2@2026-10-15T02:00:00.000Z"],
    ]);
  });

  it("holds the park's wake claim for as long as the finish runs", async () => {
    const recorded = record();
    const base = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const seen: string[] = [];
    const deps: HandoverWakeDeps = {
      ...base,
      finish: async (args) => {
        const claim = unwrap(claimWakePark({ ...PARK, home, nowIso: NOW.toISOString() }));
        seen.push(claim.kind);
        if (claim.kind === "claimed") {
          claim.release();
        }
        return base.finish(args);
      },
    };
    await wakeJson({ deps, recorded });
    expect([seen, recorded.finished]).toEqual([["in-flight"], ["landed"]]);
  });

  it("asks no finish and spawns nothing while another wake holds the park's claim", async () => {
    const release = takeClaim({ home });
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    try {
      const { report } = await wakeJson({ deps, recorded });
      expect([recorded.finished, recorded.spawned, report.rows.map((row) => row.action)]).toEqual([
        [],
        [],
        ["reseat-in-flight"],
      ]);
      expect(stillParked({ slug: PARK.slug })).toBe(true);
    } finally {
      release();
    }
  });
});
