/**
 * `drainDiagnostics` — which of the drain's own diagnostics one `session watch` batch carries, and in what order.
 * The rest of `watchBatchReport.ts` reads the screen and the transcripts, so its output modes are covered where the
 * pure pieces they call live (`sessions/watchReport/`, `watchReadingRecord.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { drainDiagnostics } from "../../../../../cli/commands/session/watchBatchReport.js";
import type { WatchBatch } from "../../../../../cli/commands/session/watchFollow.js";

/** A batch that saw everything, overridden one outcome at a time. */
function batch({ over }: { over: Partial<WatchBatch> }): WatchBatch {
  return { answered: true, events: [], gap: false, highestSeq: 120, truncated: false, ...over };
}

describe("drainDiagnostics", () => {
  it("carries nothing for a drain that was answered, gapless and complete", () => {
    expect(drainDiagnostics({ batch: batch({ over: {} }) })).toEqual([]);
  });

  it("names only the aged-out cursor when the replay had a gap", () => {
    const diagnostics = drainDiagnostics({ batch: batch({ over: { gap: true } }) });

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]).toContain("aged out of cmux's retained buffer");
  });

  it("says a drain cmux never answered read no fleet, never a quiet one", () => {
    const diagnostics = drainDiagnostics({ batch: batch({ over: { answered: false } }) });

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]).toContain("read no fleet rather than a quiet one");
  });

  it("orders gap, then unanswered, then truncated when all three fire", () => {
    const diagnostics = drainDiagnostics({ batch: batch({ over: { answered: false, gap: true, truncated: true } }) });

    expect(diagnostics.length).toBe(3);
    expect(diagnostics[0]).toContain("aged out");
    expect(diagnostics[1]).toContain("neither an acknowledgement nor an event");
    expect(diagnostics[2]).toContain("closed the subscription before its replay reached the live edge");
  });
});
