/*
 * The one `ps` row every holder-liveness check reads: a zombie is no holder, any other state is, and the start stamp
 * is byte for byte what `ps -o lstart=` alone printed, so a lock stamped before the state joined the row still
 * matches its live holder. The real zombie is `subprocess/admit/zombieHolder.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { processStartFromPs } from "../../../talk/relayLease.js";

describe("processStartFromPs", () => {
  it("reads a running process's start stamp with its padding inside the date untouched", () => {
    expect(processStartFromPs({ text: "Ss   Thu Oct  1 12:25:03 2026\n" })).toEqual({
      running: true,
      start: "Thu Oct  1 12:25:03 2026",
    });
  });

  it("reads a zombie as not running, whatever follows the Z", () => {
    expect(
      ["Z    Sat Oct 10 16:11:33 2026", "ZN   Sat Oct 10 16:11:33 2026", "Z+   Sat Oct 10 16:11:33 2026"].map((text) =>
        processStartFromPs({ text }),
      ),
    ).toEqual([
      { running: false, start: undefined },
      { running: false, start: undefined },
      { running: false, start: undefined },
    ]);
  });

  // Signal 0 already reached the pid, so a row `ps` did not give leaves it a live holder rather than a dead one.
  it("leaves an empty or one-field row running and unstamped", () => {
    expect([processStartFromPs({ text: "" }), processStartFromPs({ text: "Ss\n" })]).toEqual([
      { running: true, start: undefined },
      { running: true, start: undefined },
    ]);
  });

  it("reads a row padded on both sides, and leaves a second row folded into the stamp unstamped", () => {
    expect([
      processStartFromPs({ text: "  S    Sat Oct 10 16:11:33 2026  \n" }),
      processStartFromPs({ text: "S    Sat Oct 10 16:11:33 2026\nS    Sat Oct 10 16:11:33 2026\n" }),
    ]).toEqual([
      { running: true, start: "Sat Oct 10 16:11:33 2026" },
      { running: true, start: undefined },
    ]);
  });

  // A zombie state followed by a field broken by ANY line terminator is no one row, so no verdict.
  it("leaves a zombie row broken by a line or paragraph separator running and unstamped", () => {
    expect(
      [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029), "\r"].map((separator) =>
        processStartFromPs({ text: `Z x${separator}y` }),
      ),
    ).toEqual([
      { running: true, start: undefined },
      { running: true, start: undefined },
      { running: true, start: undefined },
    ]);
  });

  // A second field that is no `lstart` stamp, compared, would read a live holder as a recycled pid.
  it("leaves a row whose second field is not an lstart stamp running and unstamped", () => {
    expect(processStartFromPs({ text: "Ss   not-a-lstart-row\n" })).toEqual({ running: true, start: undefined });
  });
});
