/** The `session close-done --json` document turned into the tick's close-done observation. */
import { describe, expect, it } from "vitest";

import type { CapturedDocument } from "../../../../supervisor/tickDraftSources.js";
import { diagnosticOf, factsOf, redirected, sourcesWith } from "../tickDraftSourcesFixture.js";

/** A close-done document with the given counts. */
function closeDoneDocument({
  dryRun,
  closed,
  failed,
  kept,
}: {
  dryRun: boolean;
  closed: number;
  failed: number;
  kept: number;
}): CapturedDocument {
  return redirected({
    path: "close-done.json",
    value: { counts: { closed, driftClosed: 0, failed, held: 0, kept }, dryRun, outcomes: [] },
  });
}

describe("draftTickSources — close-done", () => {
  it("maps the four counts a tick keeps", () => {
    const sources = sourcesWith({
      capture: closeDoneDocument({ closed: 1, dryRun: false, failed: 0, kept: 56 }),
      kind: "closeDone",
    });

    expect(sources.closeDone.status).toBe("read");
    expect(factsOf({ observation: sources.closeDone })).toStrictEqual({
      closedChats: 1,
      closedLedgerRows: 0,
      heldBusy: 0,
      keptOpen: 56,
    });
  });

  it("is unavailable for a dry run, whose counts are what the sweep would have done", () => {
    const sources = sourcesWith({
      capture: closeDoneDocument({ closed: 2, dryRun: true, failed: 0, kept: 53 }),
      kind: "closeDone",
    });

    expect(sources.closeDone.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.closeDone })).toContain("is a dry run");
  });

  it("keeps a failed close visible, which the four counts alone would drop", () => {
    const sources = sourcesWith({
      capture: closeDoneDocument({ closed: 1, dryRun: false, failed: 2, kept: 10 }),
      kind: "closeDone",
    });

    expect(sources.closeDone.status).toBe("partial");
    expect(diagnosticOf({ observation: sources.closeDone })).toBe("2 close(s) FAILED");
  });
});
