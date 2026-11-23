/**
 * The digest's per-seat lists, read directly: which seats are not working, which events were alerts, and
 * which seats are past their depth threshold — each said in words when there are none.
 */
import { describe, expect, it } from "vitest";

import { closeDoneLines, depthLines, eventLines, watchLines } from "../../../supervisor/digestFleet.js";
import type { DigestInputs, DigestReading } from "../../../supervisor/digestRead.js";

const inputsOf = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): DigestInputs => ({
  openPagesAgeMinutes: undefined,
  priorHolds: { kind: "none" },
  readings,
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: undefined,
});

describe("digestFleet", () => {
  it("says every seat is working when none is quiet, and names a root path as such", () => {
    const working = inputsOf({
      readings: new Map([["watch-report", { kind: "json", value: { rows: [{ signal: "working" }], suppressed: 0 } }]]),
    });
    const atRoot = inputsOf({
      readings: new Map([
        ["watch-report", { kind: "json", value: { rows: [{ cwd: "/", signal: "silent" }], suppressed: 0 } }],
      ]),
    });

    expect(watchLines({ inputs: working })).toEqual(["watch: all 1 seat(s) working"]);
    expect(watchLines({ inputs: atRoot })).toEqual(["watch: silent ?m — (root)"]);
  });

  it("names only the alert rows of the event tail, cut to the alert width", () => {
    const text = `alert\t2026-09-27T07:02:55Z\tmachine\tcapacity-hold\tcpu\t${"y".repeat(170)}\ninfo\tx\ty\tz\tw\tv\n`;
    const inputs = inputsOf({ readings: new Map([["events", { kind: "text", text }]]) });

    expect(eventLines({ inputs })).toEqual([`event: capacity-hold cpu — ${"y".repeat(160)}…`]);
  });

  it("names a deep seat by its verdict and leaves the quiet verdicts out", () => {
    const inputs = inputsOf({
      readings: new Map([
        [
          "depth",
          {
            kind: "json",
            value: {
              rows: [
                { slug: "keep-me", verdict: { known: true, value: "keep" } },
                { depth: { known: false }, slug: "deep", verdict: { known: true, value: "respawn" } },
              ],
            },
          },
        ],
      ]),
    });

    expect(depthLines({ inputs })).toEqual(["depth: deep depth unknown respawn"]);
  });

  it("names the rows behind every close-done count, under the count's own key", () => {
    const outcome = ({ kind, row }: { kind: string; row: Record<string, string> }): unknown => ({
      item: { row },
      kind,
    });
    const outcomes = [
      outcome({ kind: "drift-closed", row: { slug: "orphan-row" } }),
      outcome({ kind: "closed", row: { slug: "done-seat" } }),
      outcome({ kind: "close-failed", row: { sessionKey: "key-only" } }),
      outcome({ kind: "held", row: {} }),
      ...Array.from({ length: 9 }, (_, index) => outcome({ kind: "kept", row: { slug: `k${String(index)}` } })),
    ];

    expect(closeDoneLines({ outcomes })).toEqual([
      "closed: done-seat",
      "driftClosed: orphan-row",
      "failed: key-only",
      "held: (no sessionKey)",
      "kept: k0, k1, k2, k3, k4, k5, k6, k7 and 1 more",
    ]);
  });
});
