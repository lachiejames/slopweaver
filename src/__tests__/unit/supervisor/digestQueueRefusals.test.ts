/**
 * The tick digest's withheld-card lines: a complete zero reads as zero, a withheld card is named by key and the gate's
 * reason, and every way the reading fails to say "nothing withheld" says so in capitals — never as a zero.
 */
import { describe, expect, it } from "vitest";

import { queueRefusalDigestLines, queueRefusalLines } from "../../../supervisor/digestQueueRefusals.js";
import type { DigestReading } from "../../../supervisor/digestRead.js";

const REPORT_URL = "http://localhost:3100/api/queue-refusals";
const AT = "2026-10-09T06:00:00.000Z";
const UNKNOWN = "withheld Queue cards are UNKNOWN this pass, not zero";

/** The digest's lines for one `queue-refusals` reading, or none captured. */
function linesOf({ reading }: { reading: DigestReading | undefined }): readonly string[] {
  const readings = new Map<string, DigestReading>();
  if (reading !== undefined) {
    readings.set("queue-refusals", reading);
  }
  return queueRefusalDigestLines({
    inputs: {
      openPagesAgeMinutes: undefined,
      priorHolds: { kind: "none" },
      readings,
      recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
      runAgeMinutes: undefined,
    },
  });
}

/** A withheld card, numbered. */
function card({ n }: { n: number }): { key: string; kind: string; title: string; why: string } {
  return { key: `post:sd-${String(n)}`, kind: "post", title: "Post this as you?", why: `reason ${String(n)}` };
}

describe("queueRefusalDigestLines", () => {
  it("reads a complete report with nothing withheld as zero", () => {
    const value = {
      complete: true,
      consoleUrl: REPORT_URL,
      observedAtIso: AT,
      reached: true,
      unread: [],
      withheld: [],
    };
    expect(linesOf({ reading: { kind: "json", value } })).toEqual(["queue refusals: 0 withheld"]);
  });

  it("names each withheld card by key and the gate's reason, under a count that says to route them", () => {
    const value = {
      complete: true,
      consoleUrl: REPORT_URL,
      observedAtIso: AT,
      reached: true,
      unread: [],
      withheld: [card({ n: 1 }), card({ n: 2 })],
    };
    expect(linesOf({ reading: { kind: "json", value } })).toEqual([
      "queue refusals: 2 withheld — route each to a seat that fixes its source record this pass",
      "queue refusal: post:sd-1 — reason 1",
      "queue refusal: post:sd-2 — reason 2",
    ]);
  });

  it("caps a long withheld list, counting the rest rather than cutting it silently", () => {
    const withheld = Array.from({ length: 10 }, (_, index) => card({ n: index + 1 }));
    const value = { complete: true, consoleUrl: REPORT_URL, observedAtIso: AT, reached: true, unread: [], withheld };
    const lines = linesOf({ reading: { kind: "json", value } });
    expect([lines.length, lines.at(1), lines.at(-1)]).toEqual([
      10,
      "queue refusal: post:sd-1 — reason 1",
      "queue refusal: and 2 more",
    ]);
  });

  it("calls an incomplete report INCOMPLETE, naming each unread register, the known cards a lower bound", () => {
    const value = {
      complete: false,
      consoleUrl: REPORT_URL,
      observedAtIso: AT,
      reached: true,
      unread: [{ source: "board", why: "slopweaver handover list --json timed out after 90000ms" }],
      withheld: [card({ n: 1 })],
    };
    expect(linesOf({ reading: { kind: "json", value } })).toEqual([
      "queue refusals: INCOMPLETE — 1 register(s) unread, at least 1 withheld",
      "queue refusals unread: board — slopweaver handover list --json timed out after 90000ms",
      "queue refusal: post:sd-1 — reason 1",
    ]);
  });

  it("says loudly when the console did not answer", () => {
    const value = {
      consoleUrl: REPORT_URL,
      reached: false,
      why: `the console at ${REPORT_URL} did not answer: fetch failed`,
    };
    expect(linesOf({ reading: { kind: "json", value } })).toEqual([
      `queue refusals: CONSOLE NOT READ — the console at ${REPORT_URL} did not answer: fetch failed; ${UNKNOWN}`,
    ]);
  });

  it("says loudly when the reading was not captured, did not complete, or is not a shape this build reads", () => {
    expect([
      linesOf({ reading: undefined }),
      linesOf({
        reading: {
          child: { durationMs: 150_004, kind: "timed-out", signal: "SIGKILL", timeoutMs: 150_000 },
          kind: "unavailable",
        },
      }),
      linesOf({ reading: { kind: "json", value: { reached: true } } }),
    ]).toEqual([
      [`queue refusals: NOT READ — not captured this tick; ${UNKNOWN}`],
      [`queue refusals: NOT READ — timed out after 150s (killed); ${UNKNOWN}`],
      [
        `queue refusals: NOT READ — the document is not the shape this build reads (consoleUrl: Invalid input: expected string, received undefined); ${UNKNOWN}`,
      ],
    ]);
  });
});

describe("queueRefusalLines", () => {
  it("keeps the whole reason when no limit is given, for a human at the terminal", () => {
    const why = "x".repeat(300);
    const lines = queueRefusalLines({
      outcome: {
        complete: true,
        consoleUrl: REPORT_URL,
        observedAtIso: AT,
        reached: true,
        unread: [],
        withheld: [{ ...card({ n: 1 }), why }],
      },
    });
    expect(lines.withheld).toEqual([`queue refusal: post:sd-1 — ${why}`]);
  });
});
