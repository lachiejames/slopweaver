/**
 * The PARSING lanes behind the bot form registry: a refused payload names every violation rather than the
 * first, and a lane that derives nothing hands its message back untouched.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../outbound/artifact/botFormKinds.js";
import { parseFindingForm, parseNoFoldForm, parseUpdateForm } from "../../../../outbound/artifact/botFormLanes.js";
import { slackDeliveryErrorLines } from "../../../../outbound/slack/deliveryErrors.js";

describe("parseUpdateForm", () => {
  it("refuses a payload with no fields, one line per violation", () => {
    const error = unwrapErr(parseUpdateForm({ raw: {} }));
    expect(error.code).toBe("FORM_INVALID");
    const lines = slackDeliveryErrorLines({ error });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.filter((line) => line.length === 0)).toEqual([]);
  });
});

describe("parseFindingForm", () => {
  const measured = BOT_FORM_KINDS.find((entry) => entry.kind === "finding")!.fixtures[0] as Record<string, unknown>;

  it("derives the registry's measured fixture into a P0 production card", () => {
    const parsed = unwrap(parseFindingForm({ raw: measured }));
    expect(parsed.artifact).toMatchObject({
      kind: "update",
      tldr: "P0 · production · Checkout payments fail after the deploy",
    });
    expect(parsed.unresolvedOwners).toEqual([]);
  });

  it("refuses a tracked finding as a form violation naming the ticket", () => {
    const raw = { ...measured, tracking: { ticket: { id: "ACCT-1", url: "https://linear.app/x/ACCT-1" } } };
    const error = unwrapErr(parseFindingForm({ raw }));
    expect(error.code).toBe("FORM_INVALID");
    expect(slackDeliveryErrorLines({ error }).some((line) => line.includes("already tracks this in ACCT-1"))).toBe(
      true,
    );
  });
});

describe("parseNoFoldForm", () => {
  it("returns the registry's own no-fold fixture as the message, never a folded card", () => {
    const fixture = BOT_FORM_KINDS.find((entry) => entry.kind === "no-fold")!.fixtures[0];
    const parsed = unwrap(parseNoFoldForm({ raw: fixture }));
    expect(parsed.artifact).toEqual(fixture);
    expect(parsed.unresolvedOwners).toEqual([]);
  });
});
