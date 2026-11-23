import { describe, expect, it } from "vitest";

import { lstartMs } from "../../../lib/lstart.js";

/** The stamp as an ISO instant, so a wrong reading names itself. */
function iso({ text }: { text: string }): string {
  return new Date(lstartMs({ text })!).toISOString();
}

describe("lstartMs", () => {
  it("reads a real stamp, its day space-padded or not, as UTC", () => {
    expect(iso({ text: "Fri Oct  9 11:36:11 2026" })).toBe("2026-10-09T11:36:11.000Z");
    expect(iso({ text: "Sun Oct 11 10:45:46 2026\n" })).toBe("2026-10-11T10:45:46.000Z");
    expect(iso({ text: "Sat Feb 28 23:59:59 2026" })).toBe("2026-02-28T23:59:59.000Z");
  });

  it("refuses a day the month lacks, rather than rolling it into March", () => {
    expect(lstartMs({ text: "Tue Mar  3 12:00:00 2026" })).toBe(Date.UTC(2026, 2, 3, 12));
    expect(lstartMs({ text: "Sun Feb 31 12:00:00 2026" })).toBeUndefined();
  });

  it("refuses a clock past 23:59:59", () => {
    expect(lstartMs({ text: "Sat Feb 28 24:00:00 2026" })).toBeUndefined();
    expect(lstartMs({ text: "Sat Feb 28 12:60:00 2026" })).toBeUndefined();
    expect(lstartMs({ text: "Sat Feb 28 12:00:60 2026" })).toBeUndefined();
  });

  it("refuses a weekday the date does not fall on", () => {
    expect(lstartMs({ text: "Mon Feb 28 12:00:00 2026" })).toBeUndefined();
    expect(lstartMs({ text: "Xyz Feb 28 12:00:00 2026" })).toBeUndefined();
  });

  it("refuses text that is not such a stamp", () => {
    expect([
      lstartMs({ text: "" }),
      lstartMs({ text: "2026-10-09T11:36:11Z" }),
      lstartMs({ text: "Fri Okt  9 11:36:11 2026" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
