/**
 * `triage_end` held under the tool cap with the unread list's room left.
 */
import { describe, expect, it } from "vitest";

import { TOOL_OUTPUT_MAX } from "../../components/live/talkSession";
import { fitTriageEnd, TRIAGE_END_MAX_BYTES } from "../../components/voice/triageEndFit";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const rulingsOf = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, index) => ({ key: `ask:acme-${String(index)}`, verdict: "keep" }));

describe("fitTriageEnd", () => {
  it("leaves the cap less exactly the unread list's reserve", () => {
    expect([TRIAGE_END_MAX_BYTES, TRIAGE_END_MAX_BYTES + UNREAD_MAX_BYTES]).toEqual([22_528, TOOL_OUTPUT_MAX]);
  });

  it("hands an answer under the budget back unchanged", () => {
    const answer = { ended: true, rulings: rulingsOf({ count: 3 }) };
    expect(fitTriageEnd({ answer, maxBytes: 1000 })).toBe(answer);
  });

  it("keeps the leading rulings that fit and counts the rest, never past the budget", () => {
    const answer = { ended: true, rulings: rulingsOf({ count: 40 }) };
    const fitted = fitTriageEnd({ answer, maxBytes: 400 });
    expect(bytesOf(answer)).toBeGreaterThan(400);
    expect(bytesOf(fitted)).toBeLessThanOrEqual(400);
    expect(fitted.rulings).toEqual(answer.rulings.slice(0, fitted.rulings.length));
    expect(fitted.rulings.length + fitted.rulingsNotListed!).toBe(40);
    expect(fitted.rulings.length).toBe(9);
  });

  it("holds a pass of thousands of rulings under the real budget", () => {
    const fitted = fitTriageEnd({ answer: { ended: true, rulings: rulingsOf({ count: 5000 }) } });
    expect(bytesOf(fitted)).toBeLessThanOrEqual(TRIAGE_END_MAX_BYTES);
    expect(fitted.rulings.length + fitted.rulingsNotListed!).toBe(5000);
  });
});
