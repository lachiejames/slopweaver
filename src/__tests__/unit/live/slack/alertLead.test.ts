import { describe, expect, it } from "vitest";
import { fitLead, leadNumberRefusal, resolveAlertLead } from "../../../../live/slack/alertLead.js";
import type { AlertTallyRow } from "../../../../live/slack/alertTally.js";
import { ALERT_SUMMARY_LEAD_VISIBLE_MAX } from "../../../../outbound/artifact/alertSummary.js";

/** The tally a supplied sentence is checked against. Names invented — no production monitor name may reach this public repo. */
const ROWS: readonly AlertTallyRow[] = [
  { count: 240, label: "upstream latency" },
  { count: 97, label: "token refresh 401" },
  { count: 12, label: "queue depth high" },
];

describe("leadNumberRefusal — a number the tally does not contain is REFUSED", () => {
  it("accepts a sentence with no digits at all", () => {
    expect(
      leadNumberRefusal({ lead: "One upstream monitor is drowning everything else.", rows: ROWS }),
    ).toBeUndefined();
  });

  it("REFUSES a count that is not in the tally, and says why a number here can only contradict the card", () => {
    const refusal = leadNumberRefusal({ lead: "Roughly 500 alerts fired, mostly upstream.", rows: ROWS })!;

    expect(refusal).toContain("the sentence contains a number that is not part of any alert name");
    expect(refusal).toContain("The card renders the real counts itself");
  });

  it("REFUSES a number even when it is CORRECT, because a reader cannot tell counted from recalled", () => {
    expect(leadNumberRefusal({ lead: "240 upstream timeouts dominated.", rows: ROWS })).toBeDefined();
  });

  it("ALLOWS digits that are part of an alert NAME, which is what keeps the rule usable", () => {
    // Real alert names carry digits constantly. Refusing every digit would drop the sentence on most channels,
    // so the rule subtracts the row names before looking — `token refresh 401` is accounted for.
    expect(
      leadNumberRefusal({ lead: "token refresh 401 is flapping alongside upstream.", rows: ROWS }),
    ).toBeUndefined();
  });

  it("matches an alert name case-insensitively, so a quoted name need not be quoted exactly", () => {
    expect(leadNumberRefusal({ lead: "Token Refresh 401 is flapping.", rows: ROWS })).toBeUndefined();
  });

  it("still REFUSES a fabricated number sitting beside a legitimately-quoted name", () => {
    expect(leadNumberRefusal({ lead: "token refresh 401 fired 900 times.", rows: ROWS })).toBeDefined();
  });
});

describe("fitLead — length is cosmetic, so it is trimmed VISIBLY", () => {
  it("collapses whitespace and leaves a sentence inside the cap unchanged", () => {
    expect(fitLead({ lead: "  One   upstream monitor\nis noisy.  " })).toBe("One upstream monitor is noisy.");
  });

  it("cuts an over-long sentence to exactly the cap, with the elision visible", () => {
    const fitted = fitLead({ lead: "d".repeat(400) });

    expect(fitted.length).toBe(ALERT_SUMMARY_LEAD_VISIBLE_MAX);
    expect(fitted.endsWith("…")).toBe(true);
  });

  it("leaves a sentence exactly on the cap alone", () => {
    const exact = "d".repeat(ALERT_SUMMARY_LEAD_VISIBLE_MAX);

    expect(fitLead({ lead: exact })).toBe(exact);
  });
});

describe("resolveAlertLead — a supplied sentence cannot change a number, however it is worded", () => {
  it("returns the sentence when it accounts for every digit", () => {
    const outcome = resolveAlertLead({
      rows: ROWS,
      skipped: 0,
      supplied: "One upstream monitor is drowning the rest.",
    });

    expect(outcome.lead).toBe("One upstream monitor is drowning the rest.");
    expect(outcome.warnings).toEqual([]);
  });

  it("DROPS a lead whose numbers were invented, rather than letting a wrong count onto the card", () => {
    const outcome = resolveAlertLead({
      rows: ROWS,
      skipped: 0,
      supplied: "Roughly 500 alerts fired this week, a big jump.",
    });

    expect(outcome.lead).toBeUndefined();
    expect(outcome.warnings.length).toBe(1);
    expect(outcome.warnings[0]!).toContain("the numbers never came from the sentence");
  });

  it("trims an over-long sentence rather than dropping it, because length is not a wrong number", () => {
    const outcome = resolveAlertLead({ rows: ROWS, skipped: 0, supplied: "Upstream latency ".repeat(40) });

    expect(outcome.lead!.length).toBe(ALERT_SUMMARY_LEAD_VISIBLE_MAX);
    expect(outcome.lead!.endsWith("…")).toBe(true);
  });

  it("drops a supplied sentence for a quiet window, so it cannot narrate an absence", () => {
    const outcome = resolveAlertLead({ rows: [], skipped: 0, supplied: "It was a calm week overall." });

    expect(outcome.lead).toBeUndefined();
    expect(outcome.warnings[0]!).toContain("nothing fired in this window");
  });

  it("KEEPS a supplied sentence when nothing was recognised, because that is the one window code cannot narrate", () => {
    const outcome = resolveAlertLead({
      rows: [],
      skipped: 18,
      supplied: "Knock posts a shape this tally has never parsed.",
    });

    expect(outcome.lead).toBe("Knock posts a shape this tally has never parsed.");
    expect(outcome.warnings).toEqual([]);
  });

  it("still drops an invented number when nothing was recognised, since no row can account for one", () => {
    const outcome = resolveAlertLead({ rows: [], skipped: 18, supplied: "Roughly 500 alerts fired this week." });

    expect(outcome.lead).toBeUndefined();
    expect(outcome.warnings[0]!).toContain("the numbers never came from the sentence");
  });

  it("returns no lead and no warning when nothing was supplied", () => {
    const outcome = resolveAlertLead({ rows: ROWS, skipped: 0, supplied: undefined });

    expect(outcome.lead).toBeUndefined();
    expect(outcome.warnings).toEqual([]);
  });
});
