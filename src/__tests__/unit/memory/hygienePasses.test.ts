/**
 * The hygiene-pass fold. The case that matters is the first one: a PASS is a distinct instant, not a row,
 * because one run writes one row per proposal and stamps them all identically — so a row count reports six
 * passes where two ran, and the staleness figure it feeds would be wrong in the same direction every time.
 */
import { describe, expect, it } from "vitest";

import type { HygieneRow } from "../../../memory/hygiene/ledger.js";
import { hygienePasses } from "../../../memory/hygiene/passes.js";
import type { HygieneDisposition } from "../../../memory/hygiene/types.js";

const LEDGER = "/home/knowledge/hygiene.jsonl";

/**
 * A real `HygieneRow`, defaulted on every field this fold does not read.
 *
 * Built as the ledger's own type rather than cast into it, so a rename of `tsIso` or `disposition` fails to
 * compile here instead of silently folding zero passes.
 *
 * @param over the instant and disposition this case cares about
 * @returns the row
 */
const row = (over: { tsIso: string; disposition: HygieneDisposition }): HygieneRow => ({
  check: "duplicate",
  id: `proposal-${over.tsIso}-${over.disposition}`,
  recommendation: "keep",
  subject: "a memory",
  ...over,
});

describe("hygienePasses", () => {
  const folded = hygienePasses({
    ledgerPath: LEDGER,
    nowIso: "2026-09-20T00:00:00Z",
    rows: [
      row({ disposition: "accepted", tsIso: "2026-09-14T10:00:00Z" }),
      row({ disposition: "refused", tsIso: "2026-09-14T10:00:00Z" }),
      row({ disposition: "proposed", tsIso: "2026-09-14T10:00:00Z" }),
      row({ disposition: "accepted", tsIso: "2026-09-18T09:00:00Z" }),
    ],
  });

  it("groups by instant, so three rows written by one run are one pass", () => {
    expect(folded.passes.length).toBe(2);
    expect(folded.passes[0]!.tsIso).toBe("2026-09-18T09:00:00Z");
    expect(folded.passes[1]!.proposals).toBe(3);
  });

  it("tallies each pass's dispositions", () => {
    expect(folded.passes[1]!.accepted).toBe(1);
    expect(folded.passes[1]!.refused).toBe(1);
  });

  it("ages the NEWEST pass in whole days and names the ledger it folded", () => {
    expect(folded.lastPassIso).toBe("2026-09-18T09:00:00Z");
    expect(folded.daysSinceLastPass).toBe(1);
    expect(folded.ledgerPath).toBe(LEDGER);
  });

  it("reports a never-swept home as ABSENT, never as zero days — they are opposite facts", () => {
    const never = hygienePasses({ ledgerPath: LEDGER, nowIso: "2026-09-20T00:00:00Z", rows: [] });
    expect(never.passes).toEqual([]);
    expect(never.lastPassIso).toBeUndefined();
    expect(never.daysSinceLastPass).toBeUndefined();
  });

  it("reports a pass taken minutes ago as zero days, which is what distinguishes it from never", () => {
    const fresh = hygienePasses({
      ledgerPath: LEDGER,
      nowIso: "2026-09-20T00:10:00Z",
      rows: [row({ disposition: "accepted", tsIso: "2026-09-20T00:00:00Z" })],
    });
    expect(fresh.daysSinceLastPass).toBe(0);
  });
});
