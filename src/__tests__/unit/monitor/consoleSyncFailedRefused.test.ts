import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err } from "../../../lib/result.js";
import { type ConsoleSyncFailure, readConsoleSyncAppendFailures } from "../../../live/consoleSyncFailureStore.js";
import { evaluateConsoleSyncFailed } from "../../../monitor/consoleSyncFailed.js";
import type { FiringReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";

import {
  NEW_GENERATION,
  NOW,
  OLD_GENERATION,
  ROW_BYTES,
  refusalsInGeneration,
  refusedOf,
  rowsInGeneration,
  rowsOf,
} from "./consoleSyncFailedFixtures.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
});

function home(): string {
  const path = mkdtempSync(join(tmpdir(), "console-sync-refused-"));
  homes.push(path);
  return path;
}

describe("a failure the ledger refused still reaches the card", () => {
  const REFUSED: ConsoleSyncFailure = {
    failureId: "refused-1",
    slug: "landing",
    startedAtIso: "2026-11-12T09:58:00.000Z",
    title: "slopweaver github landing",
    tookMs: 1_000,
    why: "GitHub answered 502",
  };
  const KEPT: ConsoleSyncFailure = {
    failureId: "kept-1",
    slug: "currency",
    startedAtIso: "2026-11-12T09:57:00.000Z",
    title: "slopweaver handover currency",
    tookMs: 1_000,
    why: "timed out",
  };
  const EISDIR = "EISDIR: illegal operation on a directory, read";
  const EACCES = "EACCES: permission denied, open '/home/live/console-sync-failures.jsonl'";
  const refusalLine = ({ count, error }: { count: number; error: string }): string =>
    `the console sync failure ledger refused ${String(count)} failure(s), read from its fallback instead; the latest refusal: ${error}`;

  it("cards a refused failure when the ledger is a directory, naming the unread ledger as the blind spot", () => {
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EISDIR, failure: REFUSED }),
      ledger: err([
        `the console sync failure ledger at /home/live/console-sync-failures.jsonl could not be read: ${EISDIR}`,
      ]),
      nowIso: NOW,
    });

    expect(reading).toStrictEqual({
      blindSpot: `the console sync failure ledger at /home/live/console-sync-failures.jsonl could not be read: ${EISDIR}`,
      monitorId: "console-sync-failed",
      state: "firing",
      subjects: [
        {
          checkIn: true,
          details: [
            refusalLine({ count: 1, error: EISDIR }),
            "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
          ],
          detailsInFull: [
            refusalLine({ count: 1, error: EISDIR }),
            "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
          ],
          id: "console sync refused-1",
          key: "refused-1",
          label: "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
        },
      ],
    });
  });

  it("cards a refused failure when no ledger exists because live/ cannot be written, with no blind spot", () => {
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED }),
      ledger: rowsOf(),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.state).toBe("firing");
    expect(reading.blindSpot).toBeUndefined();
    expect(reading.subjects[0]!.key).toBe("refused-1");
    expect(reading.subjects[0]!.details![0]).toBe(refusalLine({ count: 1, error: EACCES }));
  });

  it("keys the card on whichever failure finished last across the two ledgers", () => {
    const refusedLater = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED }),
      ledger: rowsOf(KEPT),
      nowIso: NOW,
    }) as FiringReading;
    const keptLater = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED }),
      ledger: rowsOf({ ...KEPT, tookMs: 120_000 }),
      nowIso: NOW,
    }) as FiringReading;

    expect(refusedLater.subjects[0]!.key).toBe("refused-1");
    expect(refusedLater.subjects[0]!.label).toBe(
      "2 console refreshes failed in 24 hours; the latest to fail: slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
    );
    expect(keptLater.subjects[0]!.key).toBe("kept-1");
    expect(keptLater.subjects[0]!.detailsInFull).toStrictEqual([
      refusalLine({ count: 1, error: EACCES }),
      "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
      "slopweaver handover currency failed at 2026-11-12T09:57:00.000Z: timed out",
    ]);
  });

  it("keys a ledger row written after a refused one on a millisecond tie, by the fallback size it recorded", () => {
    // The ledger row was appended when the fallback already held the refused row's bytes.
    const tied = {
      ...KEPT,
      fallbackBytes: ROW_BYTES,
      fallbackGeneration: NEW_GENERATION,
      startedAtIso: REFUSED.startedAtIso,
      tookMs: REFUSED.tookMs,
    };
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusalsInGeneration({
        failures: [{ appendError: EACCES, failure: REFUSED }],
        generation: NEW_GENERATION,
      }),
      ledger: rowsOf(tied),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.key).toBe("kept-1");
  });

  it("keys a ledger row written after a refused one across a clock stepped back, by the fallback size it recorded", () => {
    const steppedBack = {
      ...KEPT,
      fallbackBytes: ROW_BYTES,
      fallbackGeneration: NEW_GENERATION,
      startedAtIso: "2026-11-12T09:56:00.000Z",
    };
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusalsInGeneration({
        failures: [{ appendError: EACCES, failure: REFUSED }],
        generation: NEW_GENERATION,
      }),
      ledger: rowsOf(steppedBack),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.key).toBe("kept-1");
    expect(reading.subjects[0]!.label).toBe(
      "2 console refreshes failed in 24 hours; the latest to fail: slopweaver handover currency failed at 2026-11-12T09:56:00.000Z: timed out",
    );
  });

  it("keys a refused row written after a ledger row across a clock stepped back, by the fallback size the ledger row recorded", () => {
    // The ledger row was appended while the fallback was still empty; the refused row came later with an earlier clock.
    const first = { ...KEPT, fallbackBytes: 0, startedAtIso: "2026-11-12T09:59:00.000Z" };
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED }),
      ledger: rowsOf(first),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.key).toBe("refused-1");
  });

  it("orders by the ledger size a refused row recorded when the ledger row recorded no fallback size", () => {
    const steppedBack = { ...KEPT, startedAtIso: "2026-11-12T09:56:00.000Z" };
    const afterKept = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({
        appendError: EACCES,
        failure: REFUSED,
        ledgerBytes: ROW_BYTES,
        ledgerGeneration: NEW_GENERATION,
      }),
      ledger: rowsInGeneration({
        failures: [{ ...KEPT, startedAtIso: "2026-11-12T09:59:30.000Z" }],
        generation: NEW_GENERATION,
      }),
      nowIso: NOW,
    }) as FiringReading;
    const beforeKept = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED, ledgerBytes: 0 }),
      ledger: rowsOf(steppedBack),
      nowIso: NOW,
    }) as FiringReading;

    expect(afterKept.subjects[0]!.key).toBe("refused-1");
    expect(beforeKept.subjects[0]!.key).toBe("kept-1");
  });

  it("falls back to the clock when neither row recorded the other file, a tie taking the refused row as the later", () => {
    const tied = { ...KEPT, startedAtIso: REFUSED.startedAtIso, tookMs: REFUSED.tookMs };
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: EACCES, failure: REFUSED }),
      ledger: rowsOf(tied),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.key).toBe("refused-1");
  });

  describe("a recorded size orders the two files only under the generation it was recorded for", () => {
    // Each case sets the clock against the right answer, so only the recorded size it names can produce the key.
    const earlier = "2026-11-12T09:56:00.000Z";
    const later = "2026-11-12T09:59:00.000Z";

    it("orders by a fallback size recorded under the fallback's current generation", () => {
      const kept = { ...KEPT, fallbackBytes: ROW_BYTES, fallbackGeneration: NEW_GENERATION, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusalsInGeneration({
          failures: [{ appendError: EACCES, failure: REFUSED }],
          generation: NEW_GENERATION,
        }),
        ledger: rowsOf(kept),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("kept-1");
    });

    it("skips a fallback size recorded for a fallback since replaced, ordering by the ledger size the refused row recorded", () => {
      const kept = { ...KEPT, fallbackBytes: ROW_BYTES, fallbackGeneration: OLD_GENERATION, startedAtIso: later };
      const refused = { ...REFUSED, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusalsInGeneration({
          failures: [
            { appendError: EACCES, failure: refused, ledgerBytes: ROW_BYTES, ledgerGeneration: NEW_GENERATION },
          ],
          generation: NEW_GENERATION,
        }),
        ledger: rowsInGeneration({ failures: [kept], generation: NEW_GENERATION }),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("refused-1");
    });

    it("skips a fallback size recorded for a fallback since replaced, falling to the clock when nothing else applies", () => {
      const kept = { ...KEPT, fallbackBytes: ROW_BYTES, fallbackGeneration: OLD_GENERATION, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusalsInGeneration({
          failures: [{ appendError: EACCES, failure: REFUSED }],
          generation: NEW_GENERATION,
        }),
        ledger: rowsOf(kept),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("refused-1");
    });

    it("skips a nonzero size recorded with no generation, a row written before the field existed", () => {
      const kept = { ...KEPT, fallbackBytes: ROW_BYTES, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusalsInGeneration({
          failures: [{ appendError: EACCES, failure: REFUSED }],
          generation: NEW_GENERATION,
        }),
        ledger: rowsOf(kept),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("refused-1");
    });

    it("skips a nonzero ledger size recorded with no generation, even against a file read with none", () => {
      // The ledger row's own fallback record is absent, so only the refused row's size or the clock can order them.
      const refused = { ...REFUSED, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusedOf({ appendError: EACCES, failure: refused, ledgerBytes: ROW_BYTES }),
        ledger: rowsOf({ ...KEPT, startedAtIso: later }),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("kept-1");
    });

    it("orders by a ledger size recorded under the ledger's current generation", () => {
      const refused = { ...REFUSED, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusedOf({
          appendError: EACCES,
          failure: refused,
          ledgerBytes: ROW_BYTES,
          ledgerGeneration: NEW_GENERATION,
        }),
        ledger: rowsInGeneration({ failures: [{ ...KEPT, startedAtIso: later }], generation: NEW_GENERATION }),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("refused-1");
    });

    it("skips a ledger size recorded for a ledger since replaced, falling to the clock", () => {
      const refused = { ...REFUSED, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusedOf({
          appendError: EACCES,
          failure: refused,
          ledgerBytes: ROW_BYTES,
          ledgerGeneration: OLD_GENERATION,
        }),
        ledger: rowsInGeneration({ failures: [{ ...KEPT, startedAtIso: later }], generation: NEW_GENERATION }),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("kept-1");
    });

    it("keeps a recorded fallback size of zero whatever generation the fallback carries now", () => {
      const kept = { ...KEPT, fallbackBytes: 0, fallbackGeneration: OLD_GENERATION, startedAtIso: later };
      const refused = { ...REFUSED, startedAtIso: earlier };
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusalsInGeneration({
          failures: [{ appendError: EACCES, failure: refused }],
          generation: NEW_GENERATION,
        }),
        ledger: rowsOf(kept),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("refused-1");
    });

    it("keeps a recorded ledger size of zero whatever generation the ledger carries now", () => {
      const reading = evaluateConsoleSyncFailed({
        appendFailures: refusedOf({
          appendError: EACCES,
          failure: { ...REFUSED, startedAtIso: later },
          ledgerBytes: 0,
        }),
        ledger: rowsInGeneration({ failures: [{ ...KEPT, startedAtIso: earlier }], generation: NEW_GENERATION }),
        nowIso: NOW,
      }) as FiringReading;

      expect(reading.subjects[0]!.key).toBe("kept-1");
    });
  });

  it("counts a failure both ledgers hold once, still naming the refusal", () => {
    const reading = evaluateConsoleSyncFailed({
      appendFailures: refusedOf({ appendError: "EIO: i/o error, fsync", failure: REFUSED }),
      ledger: rowsOf(REFUSED),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.detailsInFull).toStrictEqual([
      refusalLine({ count: 1, error: "EIO: i/o error, fsync" }),
      "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
    ]);
    expect(reading.subjects[0]!.label).toBe(
      "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
    );
  });

  it("keeps a refused failure started exactly 24 hours ago and clears one a millisecond older", () => {
    const atEdge = { ...REFUSED, startedAtIso: "2026-11-11T10:00:00.000Z" };
    const past = { ...REFUSED, startedAtIso: "2026-11-11T09:59:59.999Z" };

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: refusedOf({ appendError: EACCES, failure: atEdge }),
        ledger: rowsOf(),
        nowIso: NOW,
      }).state,
    ).toBe("firing");
    expect(
      evaluateConsoleSyncFailed({
        appendFailures: refusedOf({ appendError: EACCES, failure: past }),
        ledger: rowsOf(),
        nowIso: NOW,
      }),
    ).toStrictEqual({ monitorId: "console-sync-failed", state: "clear" });
  });

  it("names an unreadable fallback as the blind spot while the ledger still cards a failure", () => {
    const reading = evaluateConsoleSyncFailed({
      appendFailures: err(["the console sync failure fallback ledger at /home/x could not be read: EISDIR"]),
      ledger: rowsOf(KEPT),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.blindSpot).toBe("the console sync failure fallback ledger at /home/x could not be read: EISDIR");
    expect(reading.subjects[0]!.key).toBe("kept-1");
  });

  it("reads unmeasurable, naming both, when neither ledger can be read", () => {
    expect(
      evaluateConsoleSyncFailed({
        appendFailures: err(["fallback unreadable"]),
        ledger: err(["ledger unreadable"]),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      because: "ledger unreadable; fallback unreadable, and no failure inside 24 hours decodes",
      monitorId: "console-sync-failed",
      state: "unmeasurable",
    });
  });

  it("reads an unreadable fallback as unmeasurable, never clear, when the ledger holds nothing recent", () => {
    expect(
      evaluateConsoleSyncFailed({ appendFailures: err(["fallback unreadable"]), ledger: rowsOf(), nowIso: NOW }),
    ).toStrictEqual({
      because: "fallback unreadable, and no failure inside 24 hours decodes",
      monitorId: "console-sync-failed",
      state: "unmeasurable",
    });
  });

  it("reads a damaged fallback with nothing recent as unmeasurable", () => {
    const root = home();
    const path = stateHomePaths({ home: root }).consoleSyncFailureAppendFailuresJsonl;
    writeFileSync(path, `${JSON.stringify({ appendError: "", failure: REFUSED })}\n`);

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: readConsoleSyncAppendFailures({ home: root }),
        ledger: rowsOf(),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      because: `1 line(s) in the console sync failure fallback ledger at ${path} did not decode, and no failure inside 24 hours decodes`,
      monitorId: "console-sync-failed",
      state: "unmeasurable",
    });
  });
});
