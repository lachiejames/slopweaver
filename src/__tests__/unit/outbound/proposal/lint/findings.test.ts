/**
 * `hasBlocker` decides a publish on severity alone: rule, message, line and position play no part.
 */
import { describe, expect, it } from "vitest";

import { hasBlocker, type ProposalFinding } from "../../../../../outbound/proposal/lint/findings.js";

const WARNING: ProposalFinding = { message: "might be a guess", rule: "soft-claim", severity: "warning" };
const WARNING_WITH_LINE: ProposalFinding = { line: 12, message: "hedged figure", rule: "hedge", severity: "warning" };
const BLOCKER: ProposalFinding = {
  line: 4,
  message: "a number with no citation",
  rule: "uncited",
  severity: "blocker",
};

describe("hasBlocker", () => {
  it("answers false for an empty lint pass", () => {
    expect(hasBlocker({ findings: [] })).toBe(false);
  });

  it("answers false when every finding is a warning, one of them carrying a line", () => {
    expect(hasBlocker({ findings: [WARNING, WARNING_WITH_LINE] })).toBe(false);
  });

  it("answers true for a mixed list holding one blocker", () => {
    expect(hasBlocker({ findings: [WARNING, BLOCKER, WARNING_WITH_LINE] })).toBe(true);
  });

  it("answers true when the only blocker is last, so the whole list is scanned", () => {
    expect(hasBlocker({ findings: [WARNING, WARNING, WARNING_WITH_LINE, BLOCKER] })).toBe(true);
  });
});
