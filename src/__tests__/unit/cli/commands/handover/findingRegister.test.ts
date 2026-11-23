import { describe, expect, it } from "vitest";

import { findingProvenance } from "../../../../../cli/commands/handover/askRowRun.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { findingRulingState } from "../../../../../handover/askRow.js";
import { derivedRowState } from "../../../../../handover/derivedRowState.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

describe("askRowText for a finding", () => {
  const text = askRowText({
    anchor: undefined,
    ask: "watchPr.sh dies silent on SIGUSR1",
    askedIso: "2026-09-02T06:14:01Z",
    checkedIso: "2026-08-30T23:10:00Z",
    branch: undefined,
    dispatch: false,
    finding: { evidence: ["owner/repo#16360", "owner/repo#16384"], observedBy: "session-40" },
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "watchpr-dies",
  });
  const doc = parseHandoverDoc({ path: "/h/watchpr-dies.md", text });

  it("writes a row the board reader parses as an UNRULED finding, still an ask", () => {
    expect(doc.problems).toEqual([]);
    expect(doc.kind).toBe("ask");
    expect(doc.origin).toBe("finding");
    expect(doc.observedBy).toBe("session-40");
    expect(doc.evidence).toEqual(["owner/repo#16360", "owner/repo#16384"]);
    expect(findingRulingState({ derived: derivedRowState({ doc, events: [] }), doc })).toBe("unruled");
  });

  it("never heads the page with the ask heading — nobody asked", () => {
    expect(text).not.toContain("## What the owner asked for");
    expect(text).toContain("## What was observed");
    expect(text).toContain("## Where this came from");
    expect(text).toContain(
      "A fleet finding, not something the owner asked for. Observed by session `session-40` from:",
    );
    expect(text).toContain("- owner/repo#16360");
    expect(text).toContain("- owner/repo#16384");
  });

  it("tells the reader the one verb that lets it reach the team", () => {
    expect(text).toContain(
      '`slopweaver handover rule watchpr-dies --anchor <where the owner said it> --words "<the owner\'s words>"`.',
    );
  });

  it("keeps the ask heading for the owner's own ask", () => {
    const own = askRowText({
      anchor: undefined,
      ask: "do the thing",
      askedIso: "2026-09-02T06:14:01Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "do-the-thing",
    });
    expect(own).toContain("## What the owner asked for");
    expect(own).not.toContain("origin:");
  });
});

describe("findingProvenance", () => {
  const env = { CLAUDE_CODE_SESSION_ID: "session-40" };

  it("is undefined for an ordinary ask", () => {
    expect(findingProvenance({ env, values: { ask: "do the thing" } })).toBeUndefined();
  });

  it("refuses evidence or an observer without --finding, so a row cannot half-declare an origin", () => {
    expect(findingProvenance({ env, values: { evidence: "a#1" } })).toEqual({
      refusal: "--evidence and --observed-by only make sense with --finding",
    });
  });

  it("refuses --finding with no evidence", () => {
    expect(findingProvenance({ env, values: { finding: true } })).toEqual({
      refusal: "--finding needs --evidence <ref,...> — what was observed is the whole reason the row exists",
    });
  });

  it("defaults the observer to this session's own id", () => {
    expect(findingProvenance({ env, values: { evidence: "a#1, a#2,", finding: true } })).toEqual({
      evidence: ["a#1", "a#2"],
      observedBy: "session-40",
    });
  });

  it("takes an explicit --observed-by over the environment", () => {
    expect(findingProvenance({ env, values: { evidence: "a#1", finding: true, "observed-by": "session-99" } })).toEqual(
      {
        evidence: ["a#1"],
        observedBy: "session-99",
      },
    );
  });

  it("refuses when no session id is anywhere to be found", () => {
    expect(findingProvenance({ env: {}, values: { evidence: "a#1", finding: true } })).toEqual({
      refusal: "--finding needs --observed-by <session> — no visible session id is in this environment",
    });
  });
});
