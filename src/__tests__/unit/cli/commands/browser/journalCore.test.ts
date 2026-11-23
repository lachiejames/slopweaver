/**
 * The pure selection and rendering behind `slopweaver browser verdicts`.
 *
 * The report's one job is that a waiver does not read as an ordinary allow — a journal whose whole point is
 * making an override visible must not print it as "the guard was fine with this".
 */
import { describe, expect, it } from "vitest";

import type { BrowserJournalRecord } from "../../../../../admit/browserVerdictJournal.js";
import {
  browserVerdictTotals,
  renderBrowserVerdict,
  renderBrowserVerdicts,
  selectBrowserVerdicts,
} from "../../../../../cli/commands/browser/journalCore.js";

const TS = "2026-09-08T09:00:00.000Z";

/** One journal row, defaulted to a plain allow. */
function row(over: Partial<BrowserJournalRecord> = {}): BrowserJournalRecord {
  return {
    reason: "granted-read",
    schemaVersion: 1,
    sessionId: "s",
    toolName: "mcp__claude-in-chrome__computer",
    tsIso: TS,
    verdict: "allow",
    ...over,
  };
}

const ALLOWED = row();
const REFUSED = row({ message: "no", reason: "read-before-write-no-read", verdict: "block" });
const WAIVED = row({ message: "no", reason: "break-glass-env", waived: "doored-no-grant" });

describe("selectBrowserVerdicts", () => {
  it("keeps the most recent rows, oldest first", () => {
    const kept = selectBrowserVerdicts({
      blocked: false,
      limit: 2,
      records: [row({ tsIso: "a" }), row({ tsIso: "b" }), row({ tsIso: "c" })],
    });
    expect(kept.map((record) => record.tsIso)).toEqual(["b", "c"]);
  });

  it("returns everything when the limit exceeds what there is", () => {
    expect(selectBrowserVerdicts({ blocked: false, limit: 50, records: [ALLOWED] }).length).toBe(1);
  });

  it("--blocked keeps refusals AND waived refusals, dropping only plain allows", () => {
    const kept = selectBrowserVerdicts({ blocked: true, limit: 10, records: [ALLOWED, REFUSED, WAIVED] });
    expect(kept.map((record) => record.reason)).toEqual(["read-before-write-no-read", "break-glass-env"]);
  });
});

describe("browserVerdictTotals", () => {
  it("counts a waiver as its own thing, never as an allow", () => {
    const totals = browserVerdictTotals({ records: [ALLOWED, ALLOWED, REFUSED, WAIVED] });
    expect(totals.allowed).toBe(2);
    expect(totals.blocked).toBe(1);
    expect(totals.waived).toBe(1);
  });

  it("is all zeroes on an empty journal", () => {
    const totals = browserVerdictTotals({ records: [] });
    expect(totals.allowed).toBe(0);
    expect(totals.blocked).toBe(0);
    expect(totals.waived).toBe(0);
  });
});

describe("renderBrowserVerdict", () => {
  it("prints a waiver as WAIVED and names the verdict it overrode", () => {
    const line = renderBrowserVerdict({
      record: row({ reason: "break-glass-grant", tabId: 42, url: "https://vanta.com/x", waived: "doored-no-grant" }),
    });
    expect(line).toBe(
      "2026-09-08T09:00:00.000Z  WAIVED break-glass-grant (waived doored-no-grant)  computer tab 42 https://vanta.com/x",
    );
  });

  it("says the url was never observed rather than leaving the column blank", () => {
    const line = renderBrowserVerdict({ record: row({ reason: "unknown-tab-write", tabId: 7, verdict: "block" }) });
    expect(line).toBe("2026-09-08T09:00:00.000Z  BLOCK  unknown-tab-write  computer tab 7 (url unobserved)");
  });
});

describe("renderBrowserVerdicts", () => {
  it("explains an empty journal instead of printing a bare zero", () => {
    const lines = renderBrowserVerdicts({
      path: "/tmp/j.jsonl",
      records: [],
      totals: { allowed: 0, blocked: 0, waived: 0 },
    });
    expect(lines[0]).toBe("browser verdicts: nothing journalled yet (/tmp/j.jsonl).");
    expect(lines.length).toBe(3);
  });

  it("heads the report with the totals over the WHOLE journal, not the filtered view", () => {
    const lines = renderBrowserVerdicts({
      path: "/tmp/j.jsonl",
      records: [REFUSED],
      totals: browserVerdictTotals({ records: [ALLOWED, REFUSED, WAIVED] }),
    });
    expect(lines[0]).toBe("browser verdicts: 1 allowed, 1 refused, 1 waived by a break-glass (/tmp/j.jsonl)");
    expect(lines.length).toBe(2);
  });
});
