/** Which face the Alignment page's Start here card shows (`site/lib/alignmentStartHere.ts`). */

import { describe, expect, it } from "vitest";
import { startHereFaceOf } from "../../lib/alignmentStartHere";
import type { QuotedRead } from "../../lib/quotedReason";
import type { SidebarReading } from "../../lib/sidebarCountsBasis";

const NEXT = "the console reads it again at 10:42";
const AT = "2026-11-11T03:00:00.000Z";
const age: (iso: string) => string = (iso) => `age of ${iso}`;

const LEDGER_FAILED: QuotedRead = {
  lead: "the autonomy ledger did not read",
  subject: "the autonomy ledger",
  why: "ENOENT",
};

const ANSWERS_FAILED: QuotedRead = {
  lead: "your answers on the page did not read",
  subject: "your answers on the page",
  why: "talk log exited 1",
};

describe("startHereFaceOf", () => {
  it("draws a count being updated as the progress indicator, saying how old it is — never the warning", () => {
    const waiting: SidebarReading = {
      count: { count: 3, title: "waiting" },
      phase: "measured",
      stale: { kind: "updating", notes: ["the autonomy ledger is being read again now"], observedAtIso: AT },
    };
    expect(startHereFaceOf({ age, next: NEXT, waiting })).toEqual({
      kind: "updating",
      label: `The first question to answer shows here once the count is current. This count is from age of ${AT}: the autonomy ledger is being read again now.`,
    });
  });

  it("names every failed read when the count has no number, and what the console does next after the last", () => {
    const waiting: SidebarReading = { failures: [LEDGER_FAILED, ANSWERS_FAILED], phase: "not-measured" };
    expect(startHereFaceOf({ age, next: NEXT, waiting })).toEqual({
      facts: [
        { subject: "the autonomy ledger", why: "ENOENT" },
        { after: NEXT, subject: "your answers on the page", why: "talk log exited 1" },
      ],
      kind: "failed",
    });
  });

  it("names a measured count's failed read, with the instant it is true as of", () => {
    const waiting: SidebarReading = {
      count: { count: 3, title: "waiting" },
      phase: "measured",
      stale: { failures: [LEDGER_FAILED], kind: "failed", notes: [], observedAtIso: AT },
    };
    expect(startHereFaceOf({ age, next: NEXT, waiting })).toEqual({
      facts: [{ after: NEXT, observedAtIso: AT, subject: "the autonomy ledger", why: "ENOENT" }],
      kind: "failed",
    });
  });

  it("hands a count still loading, or withheld for one reason of its own, to the stand-in", () => {
    expect([
      startHereFaceOf({ age, next: NEXT, waiting: { phase: "loading" } }),
      startHereFaceOf({ age, next: NEXT, waiting: { phase: "not-measured", why: "no ledger yet" } }),
    ]).toEqual([
      { kind: "stand-in", state: { phase: "loading" } },
      { kind: "stand-in", state: { phase: "not-measured", why: "no ledger yet" } },
    ]);
  });

  it("orders once the count is current", () => {
    const waiting: SidebarReading = { count: { count: 0, title: "nothing waiting" }, phase: "measured" };
    expect(startHereFaceOf({ age, next: NEXT, waiting })).toEqual({ kind: "ordered" });
  });
});
