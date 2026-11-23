import { describe, expect, it } from "vitest";

import { WORKER_REVIEW_WAIT_SECONDS } from "../../../../../cli/commands/turn/core.js";
import {
  ORPHAN_PARENT_PID,
  ORPHAN_SILENCE_MS,
  orphanedTickerVerdict,
} from "../../../../../cli/commands/turn/tickerOwner.js";

/** An instant to judge every case against, so no test reads a real clock. */
const NOW_ISO = "2026-09-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

/** A parent pid that is not 1 — a host really holding this process. */
const PARENTED_PID = 49_984;

/**
 * One reading, with the orphaned-and-long-silent case as the default so each test names only what it
 * changes. Not a mock: every input is a plain value the pure function already takes.
 */
function verdict(
  over: Partial<Parameters<typeof orphanedTickerVerdict>[0]> = {},
): ReturnType<typeof orphanedTickerVerdict> {
  return orphanedTickerVerdict({
    blockedOnHuman: false,
    latestActivityIso: new Date(NOW_MS - ORPHAN_SILENCE_MS - 1).toISOString(),
    nowMs: NOW_MS,
    parentPid: ORPHAN_PARENT_PID,
    ...over,
  });
}

describe("ORPHAN_SILENCE_MS", () => {
  it("clears the longest single wait the worker contract prescribes, so a live turn is never reaped", () => {
    expect(ORPHAN_SILENCE_MS).toBeGreaterThan(WORKER_REVIEW_WAIT_SECONDS * 1000);
  });

  it("is that wait plus half again — derived from the constant, never a typed-in number", () => {
    expect(ORPHAN_SILENCE_MS).toBe(Math.round(WORKER_REVIEW_WAIT_SECONDS * 1000 * 1.5));
  });
});

describe("orphanedTickerVerdict", () => {
  it("reaps an orphan whose worker has been silent past the bound, naming the minutes and the last call", () => {
    const lastIso = "2026-09-20T11:00:00.000Z";
    const result = verdict({ latestActivityIso: lastIso });
    expect(result.kind).toBe("reap");
    expect(result).toStrictEqual({
      kind: "reap",
      line: `orphaned (ppid 1), and its worker made no tool call for 60m — last one ${lastIso}`,
    });
  });

  it("keeps ticking when some host still parents this process, however silent the worker is", () => {
    expect(verdict({ parentPid: PARENTED_PID })).toStrictEqual({ kind: "keep-ticking" });
  });

  it("keeps ticking for an orphan whose worker made a tool call one millisecond inside the bound", () => {
    const insideIso = new Date(NOW_MS - ORPHAN_SILENCE_MS + 1).toISOString();
    expect(verdict({ latestActivityIso: insideIso })).toStrictEqual({ kind: "keep-ticking" });
  });

  it("reaps exactly at the bound — the boundary is inclusive", () => {
    const atIso = new Date(NOW_MS - ORPHAN_SILENCE_MS).toISOString();
    expect(verdict({ latestActivityIso: atIso }).kind).toBe("reap");
  });

  it("keeps ticking when no activity was read at all — a Codex worker's empty fold is not a death", () => {
    expect(verdict({ latestActivityIso: undefined })).toStrictEqual({ kind: "keep-ticking" });
  });

  it("keeps ticking on an unparseable instant rather than treating a bad reading as a verdict", () => {
    expect(verdict({ latestActivityIso: "not an instant" })).toStrictEqual({ kind: "keep-ticking" });
  });

  // The arm that makes the reap a fix rather than a new defect. A turn waiting on THE OWNER is a
  // first-class resumable state: its worker sits idle for as long as they take, and its card is the surface
  // telling the thread what they owe. Without this, every block longer than the bound would lose its card.
  it("never reaps a turn blocked on the owner, however long its worker has been silent", () => {
    const ancient = new Date(NOW_MS - ORPHAN_SILENCE_MS * 100).toISOString();
    expect(verdict({ blockedOnHuman: true, latestActivityIso: ancient })).toStrictEqual({ kind: "keep-ticking" });
  });

  it("reaps the SAME inputs once the block is lifted, so the suppression is the block and nothing else", () => {
    const ancient = new Date(NOW_MS - ORPHAN_SILENCE_MS * 100).toISOString();
    expect(verdict({ blockedOnHuman: false, latestActivityIso: ancient }).kind).toBe("reap");
  });

  it("keeps ticking when the worker's last call is in the FUTURE, a clock skew, never a death", () => {
    const aheadIso = new Date(NOW_MS + 60_000).toISOString();
    expect(verdict({ latestActivityIso: aheadIso })).toStrictEqual({ kind: "keep-ticking" });
  });

  it("honours a caller's own bound, so the relationship is testable without the default", () => {
    const lastIso = new Date(NOW_MS - 10_000).toISOString();
    expect(verdict({ latestActivityIso: lastIso, silenceMs: 5_000 }).kind).toBe("reap");
    expect(verdict({ latestActivityIso: lastIso, silenceMs: 20_000 })).toStrictEqual({ kind: "keep-ticking" });
  });
});
