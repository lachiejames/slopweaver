/**
 * A hand step's details: the lines behind its note's disclosure row, capped by the schema and refused rather than
 * cut (rule 7), and each read into the entry the note draws.
 */
import { describe, expect, it } from "vitest";

import {
  checkedDetails,
  DETAIL_LINE_CAP,
  DETAIL_STATUSES,
  DETAILS_MAX,
  detailActMarker,
  detailEntry,
  NEEDS_YOU,
  NOTHING_FOR_YOU,
} from "../../../hand/details.js";
import { unwrap } from "../../../lib/result.js";

/**
 * The refusal's message for a value the check must refuse — throwing, like `unwrap`, when it accepts it.
 *
 * @param value the value to check
 * @returns the refusal's message
 */
function refusal({ value }: { value: unknown }): string {
  const checked = checkedDetails({ value });
  if (checked.isOk()) {
    throw new Error("expected a refusal");
  }
  return checked.error.message;
}

describe("checkedDetails", () => {
  it("keeps each line, trimmed, and drops an absent or empty list", () => {
    expect(unwrap(checkedDetails({ value: ["  NEW   a — 12:00Z  ", "STILL b"] }))).toEqual([
      "NEW   a — 12:00Z",
      "STILL b",
    ]);
    expect(unwrap(checkedDetails({ value: undefined }))).toBe(undefined);
    expect(unwrap(checkedDetails({ value: [] }))).toBe(undefined);
  });

  it("refuses a value that is not a list of lines", () => {
    expect(refusal({ value: "one line" })).toBe("details is a list of lines");
    expect(refusal({ value: ["a", 2] })).toBe("details is a list of lines");
  });

  it("refuses an empty or multi-line entry", () => {
    expect(refusal({ value: ["a", "  "] })).toBe("details carries an empty or multi-line entry");
    expect(refusal({ value: ["a\nb"] })).toBe("details carries an empty or multi-line entry");
  });

  it("refuses a list past the cap rather than cutting it, and accepts one at it", () => {
    expect(unwrap(checkedDetails({ value: Array.from({ length: DETAILS_MAX }, () => "x") }))!.length).toBe(DETAILS_MAX);
    expect(refusal({ value: Array.from({ length: DETAILS_MAX + 1 }, () => "x") })).toBe(
      "details carries 13 lines and the cap is 12 — end the list on a line naming where the rest is read",
    );
  });

  it("refuses a line past the cap, quoting its opening, and accepts one at it", () => {
    expect(unwrap(checkedDetails({ value: ["y".repeat(DETAIL_LINE_CAP)] }))).toEqual(["y".repeat(DETAIL_LINE_CAP)]);
    expect(refusal({ value: ["z".repeat(DETAIL_LINE_CAP + 1)] })).toBe(
      `details carries a 321-character line and the cap is 320: "${"z".repeat(40)}…"`,
    );
  });
});

describe("detailEntry", () => {
  it("reads a fleet-health failure into its status, name, age and count, and its reason as prose", () => {
    expect(
      detailEntry({ line: "STILL resync-slack — 45m ago, 3× in 24h: died mid-run: HOLDER_GONE, `store lease` held" }),
    ).toEqual({
      act: "",
      meta: "45m ago, 3× in 24h",
      name: "resync-slack",
      reason: "died mid-run: HOLDER_GONE, `store lease` held",
      owner: "",
      status: "STILL",
    });
  });

  it("drops the padding a status carried for a monospaced column", () => {
    expect(detailEntry({ line: "NEW   atlas-hex — 12m ago, once: exit 1" })).toEqual({
      act: "",
      meta: "12m ago, once",
      name: "atlas-hex",
      reason: "exit 1",
      owner: "",
      status: "NEW",
    });
  });

  it("reads a tail with no `: ` as all reason — a recovered row and the bot line", () => {
    expect(detailEntry({ line: "FIXED atlas-hex — last failed 2h ago, its newest run succeeded" })).toEqual({
      act: "",
      meta: "",
      name: "atlas-hex",
      reason: "last failed 2h ago, its newest run succeeded",
      owner: "",
      status: "FIXED",
    });
    expect(detailEntry({ line: "STILL the bot off Slack — no heartbeat since 10:02Z" })).toEqual({
      act: "",
      meta: "",
      name: "the bot off Slack",
      reason: "no heartbeat since 10:02Z",
      owner: "",
      status: "STILL",
    });
  });

  it("reads a line with no dash as all name, and the more-line as a name with its verb for a reason", () => {
    expect(detailEntry({ line: "BACK  the bot is on Slack again" })).toEqual({
      act: "",
      meta: "",
      name: "the bot is on Slack again",
      reason: "",
      owner: "",
      status: "BACK",
    });
    expect(detailEntry({ line: "+4 more — slopweaver monitor check --only fleet-unhealthy prints every one" })).toEqual(
      {
        act: "",
        meta: "",
        name: "+4 more",
        reason: "slopweaver monitor check --only fleet-unhealthy prints every one",
        owner: "",
        status: "",
      },
    );
  });

  it("keeps a capitalised first word outside the closed status set as the line's own", () => {
    expect(detailEntry({ line: "API errors — since 09:00Z: 502 from the gateway" })).toEqual({
      act: "",
      meta: "since 09:00Z",
      name: "API errors",
      reason: "502 from the gateway",
      owner: "",
      status: "",
    });
    expect(DETAIL_STATUSES).toEqual(["NEW", "STILL", "FIXED", "PAST", "BACK"]);
  });

  it("reads a row that needs the owner as theirs, and takes the card its marker names off the reason", () => {
    const line = `NEW resync-atlas-xero — 45m ago, once: ${NEEDS_YOU} — sign in to go.xero.com, in your work Chrome${detailActMarker({ id: "mon-signin-go-xero-com.2" })}`;
    expect(detailEntry({ line })).toEqual({
      act: "mon-signin-go-xero-com.2",
      meta: "45m ago, once",
      name: "resync-atlas-xero",
      owner: "you",
      reason: "Needs you — sign in to go.xero.com, in your work Chrome",
      status: "NEW",
    });
  });

  it("reads a row the fleet is on as the fleet's, with no card", () => {
    expect(
      detailEntry({
        line: `STILL resync-atlas-vanta — 2h ago, 3× in 24h: ${NOTHING_FOR_YOU} — its next slot runs it again; exit 1`,
      }),
    ).toEqual({
      act: "",
      meta: "2h ago, 3× in 24h",
      name: "resync-atlas-vanta",
      owner: "fleet",
      reason: "Nothing for you — its next slot runs it again; exit 1",
      status: "STILL",
    });
  });

  it("leaves a bracket that is not a step id as reason text", () => {
    expect(detailEntry({ line: "NEW atlas-hex — 1m ago, once: exit 1 [hand:Not An Id]" })).toEqual({
      act: "",
      meta: "1m ago, once",
      name: "atlas-hex",
      owner: "",
      reason: "exit 1 [hand:Not An Id]",
      status: "NEW",
    });
  });
});
