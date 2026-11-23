import { describe, expect, it } from "vitest";

import { BADGE_TARGETS, badgeRowOf, readBadgeRow } from "../../../../../outbound/github/legacy/badgeRow.js";
import { FULL_BODY, MINIMAL_BODY } from "./fixtures.js";

describe("BADGE_TARGETS", () => {
  it("names the three heading anchors", () => {
    expect(BADGE_TARGETS).toEqual({
      problem: "problem",
      risk: "what-can-go-wrong-if-this-merges",
      solved: "other-claims",
    });
  });
});

describe("badgeRowOf", () => {
  it("writes a plain row of risk and problem, with the risk line beside it", () => {
    const { row, riskLine } = badgeRowOf({ body: MINIMAL_BODY, shape: "plain" })._unsafeUnwrap();
    expect(riskLine).toBe("Risk: low.");
    expect(row).toContain('<a href="#what-can-go-wrong-if-this-merges"');
    expect(row).toContain('alt="risk: low"');
    expect(row).toContain('alt="problem: no evidence yet"');
    expect(row).not.toContain("solved");
  });

  it("writes a third solved badge in the withSolved shape", () => {
    const { row } = badgeRowOf({ body: FULL_BODY, shape: "withSolved" })._unsafeUnwrap();
    expect(row).toContain('<a href="#other-claims"');
    expect(row).toContain("img.shields.io/badge/solved-gold%20%C2%B7%201%20gap-ffd700?style=flat");
  });

  it("carries the review as a trailing comment on a plain row", () => {
    const { row } = badgeRowOf({ body: FULL_BODY, shape: "plain" })._unsafeUnwrap();
    expect(row.endsWith("-->")).toBe(true);
  });

  it("refuses an unranked risk list", () => {
    const body = { ...MINIMAL_BODY, risk: { ...MINIMAL_BODY.risk, items: [] } };
    expect(badgeRowOf({ body, shape: "plain" })._unsafeUnwrapErr().code).toBe("RISK_UNRANKED");
  });
});

describe("readBadgeRow", () => {
  it("reads a plain row back to the seen state, the stamp and the shape", () => {
    const { row } = badgeRowOf({ body: MINIMAL_BODY, shape: "plain" })._unsafeUnwrap();
    expect(readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap()).toEqual({
      badges: "plain",
      problemSeen: { kind: "unevidenced" },
      review: undefined,
      writtenOn: "2026-10-01",
    });
  });

  it("reads a plain row's review comment back", () => {
    const { row } = badgeRowOf({ body: FULL_BODY, shape: "plain" })._unsafeUnwrap();
    const facts = readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap();
    expect([facts.badges, facts.review, facts.problemSeen]).toEqual(["plain", FULL_BODY.review, FULL_BODY.problemSeen]);
  });

  it("reads a withSolved row back in its own shape", () => {
    const { row } = badgeRowOf({ body: FULL_BODY, shape: "withSolved" })._unsafeUnwrap();
    const facts = readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap();
    expect([facts.badges, facts.review, facts.writtenOn]).toEqual(["withSolved", FULL_BODY.review, "2026-10-01"]);
  });

  it("stops at the badge row when the block is absent or not a row", () => {
    expect(readBadgeRow({ cursor: { at: 0, blocks: [] } })._unsafeUnwrapErr().message).toContain("the badge row");
    expect(readBadgeRow({ cursor: { at: 0, blocks: ["nope"] } })._unsafeUnwrapErr().message).toContain("the badge row");
  });

  it("stops at the badge tooltips when a hover is not the template", () => {
    const { row } = badgeRowOf({ body: MINIMAL_BODY, shape: "plain" })._unsafeUnwrap();
    const broken = row.replace(/(problem" title=")[^"]*/u, "$1garbage");
    expect(readBadgeRow({ cursor: { at: 0, blocks: [broken] } })._unsafeUnwrapErr().message).toContain(
      "the badge tooltips",
    );
  });
});
