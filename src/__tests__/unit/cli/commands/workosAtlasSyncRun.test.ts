/**
 * What `atlas workos sync` prints and what it exits with.
 *
 * The property worth pinning is that the ROLLUP alone never reaches the reader: a run where one family
 * refused and three filled prints which one refused, because the alternative is opening the atlas files to
 * find out — and the run that produced this test's fixture reported four zeroes and one status code.
 */
import { describe, expect, it } from "vitest";

import type { WorkosContentKind, WorkosContentOutcome } from "../../../../atlas/workos/contentAcquire.js";
import type { WorkosSyncOutcome } from "../../../../atlas/workos/sync.js";
import { exitCodeForWorkosSync, renderWorkosSyncLines } from "../../../../cli/commands/workosAtlas/syncRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../cli/exitCodes.js";

/** Every family graded the same way, for an outcome that needs no per-family shape. */
function allFamilies({
  outcome,
  reason,
}: {
  outcome: WorkosContentOutcome;
  reason: string | null;
}): Readonly<Record<WorkosContentKind, { outcome: WorkosContentOutcome; reason: string | null }>> {
  const grade = { outcome, reason };
  return { connection: grade, directory: grade, organization: grade, user: grade };
}

/** One published outcome, overridable field by field. */
function outcomeOf({ over = {} }: { over?: Partial<WorkosSyncOutcome> } = {}): WorkosSyncOutcome {
  return {
    absentCount: 1,
    connectionCount: 1,
    content: "synced",
    contentReason: null,
    directoryCount: 1,
    families: allFamilies({ outcome: "synced", reason: null }),
    organizationCount: 1,
    pageCount: 7,
    presentCount: 9,
    probedCount: 10,
    userCount: 1,
    written: [],
    ...over,
  };
}

describe("exitCodeForWorkosSync", () => {
  it("exits ok when every family synced", () => {
    expect(exitCodeForWorkosSync({ outcome: outcomeOf() })).toBe(EXIT_OK);
  });

  it("exits error when a family was attempted and broke", () => {
    expect(exitCodeForWorkosSync({ outcome: outcomeOf({ over: { content: "failed" } }) })).toBe(EXIT_ERROR);
  });

  it("exits expected-empty when the content half is unconfigured", () => {
    expect(exitCodeForWorkosSync({ outcome: outcomeOf({ over: { content: "not-configured" } }) })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("exits expected-empty when a bound cut a family short", () => {
    expect(exitCodeForWorkosSync({ outcome: outcomeOf({ over: { content: "truncated" } }) })).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("renderWorkosSyncLines", () => {
  it("prints three lines and no family line when everything synced", () => {
    expect(renderWorkosSyncLines({ outcome: outcomeOf() }).length).toBe(3);
  });

  it("names the family that refused, rather than only the rolled-up outcome", () => {
    const lines = renderWorkosSyncLines({
      outcome: outcomeOf({
        over: {
          content: "failed",
          contentReason: "directory: https://api.workos.com/directories answered HTTP 500",
          directoryCount: 0,
          families: {
            ...allFamilies({ outcome: "synced", reason: null }),
            directory: { outcome: "failed", reason: "https://api.workos.com/directories answered HTTP 500" },
          },
        },
      }),
    });
    expect(lines[2]).toBe("  directory (failed) — https://api.workos.com/directories answered HTTP 500");
  });

  it("still reports the three families that filled, on the same run", () => {
    const lines = renderWorkosSyncLines({
      outcome: outcomeOf({
        over: {
          content: "failed",
          directoryCount: 0,
          families: {
            ...allFamilies({ outcome: "synced", reason: null }),
            directory: { outcome: "failed", reason: "answered HTTP 500" },
          },
        },
      }),
    });
    expect(lines[1]).toBe("content (failed) — 1 organisation(s), 1 user(s), 1 connection(s), 0 directory(ies)");
  });

  it("prints a family with no reason without a dangling dash", () => {
    const lines = renderWorkosSyncLines({
      outcome: outcomeOf({
        over: {
          content: "failed",
          families: {
            ...allFamilies({ outcome: "synced", reason: null }),
            user: { outcome: "failed", reason: null },
          },
        },
      }),
    });
    expect(lines[2]).toBe("  user (failed)");
  });
});
