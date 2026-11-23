/**
 * `handover register --bears-on`: one line saying how the owner's quoted words bear on the question, which the Queue
 * card draws above those words while it folds them.
 *
 * The round trip is the property: the console reads the line off `parseHandoverDoc`, so a key the writer puts down
 * and the parser never reads would publish a card with no bears-on sentence over a row that recorded one.
 */
import { describe, expect, it } from "vitest";

import { bearsOnFor, registerFlags } from "../../../../../cli/commands/handover/askRowBearsOn.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { askRowProblems } from "../../../../../handover/askRow.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const BEARS_ON =
  "The owner already said the mirror should hold what an auditor opens, and the files are what they open.";

const written = ({ bearsOn }: { bearsOn: string | undefined }): string =>
  askRowText({
    anchor: "talk:2026-09-30T11:02:00.000Z",
    ask: "Should the mirror carry the evidence files themselves?",
    askedIso: "2026-09-30T11:02:00.000Z",
    bearsOn,
    branch: undefined,
    checkedIso: "2026-09-30T11:05:00.000Z",
    dispatch: false,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "mirror-evidence-files",
  });

const parsed = ({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> =>
  parseHandoverDoc({ path: "/state/handovers/mirror-evidence-files.md", text });

describe("askRowText — bearsOn", () => {
  it("round-trips the line through the board's own parser", () => {
    const doc = parsed({ text: written({ bearsOn: BEARS_ON }) });

    expect(doc.bearsOn).toBe(BEARS_ON);
  });

  it("writes no key at all for a row that gave none", () => {
    const text = written({ bearsOn: undefined });

    expect(text).not.toContain("bearsOn:");
    expect(parsed({ text }).bearsOn).toBeUndefined();
  });

  it("quotes a line that spells a second key, so it cannot author one", () => {
    const doc = parsed({ text: written({ bearsOn: 'their words\nlean: "B"' }) });

    expect(doc.bearsOn).toBe('their words lean: "B"');
    expect(doc.lean).toBeUndefined();
  });

  it("is an ask-only key, so a doc row carrying it is reported", () => {
    const text = written({ bearsOn: BEARS_ON }).replace("kind: ask", "kind: doc");

    expect(
      askRowProblems({ declaredKind: "doc", declaredOrigin: undefined, doc: parsed({ text }) }).join(" "),
    ).toContain("bearsOn");
  });
});

describe("bearsOnFor", () => {
  it("reads nothing when the flag is absent", () => {
    expect(bearsOnFor({ values: { anchor: "talk:2026-09-30T11:02:00.000Z" } })).toEqual({ bearsOn: undefined });
  });

  it("takes the line, trimmed, on a row whose anchor quotes the owner's words", () => {
    const plan = bearsOnFor({ values: { anchor: "transcript:abc#def", "bears-on": `  ${BEARS_ON}  ` } });

    expect(plan).toEqual({ bearsOn: BEARS_ON });
  });

  it("refuses the line on a row whose anchor quotes nothing of the owner's", () => {
    const plan = bearsOnFor({ values: { anchor: "https://example.slack.com/archives/C1/p1", "bears-on": BEARS_ON } });

    expect(plan).toEqual({
      refusal:
        "--bears-on says how the owner's quoted words bear on the question, and this row quotes none — pass an --anchor " +
        "naming the owner's words (talk:, call:, talk-call:, transcript:), or drop --bears-on",
    });
  });

  it("refuses the line on a row with no anchor at all", () => {
    const plan = bearsOnFor({ values: { "bears-on": BEARS_ON } });

    expect("refusal" in plan).toBe(true);
  });

  it("refuses a paragraph, naming the one-sentence cap", () => {
    const plan = bearsOnFor({
      values: {
        anchor: "talk:2026-09-30T11:02:00.000Z",
        "bears-on": "The owner said files. The owner said metadata too.",
      },
    });

    expect(plan).toEqual({
      refusal: "--bears-on runs 2 sentences against a cap of 1 — it is one line, not a paragraph",
    });
  });
});

describe("registerFlags", () => {
  it("refuses a blank --anchor, which would write an anchor: line that anchors nothing", () => {
    expect(registerFlags({ values: { anchor: "  " } })).toEqual({
      refusal:
        "--anchor is empty — leave it off, then tie the row with `slopweaver handover quote <slug> --anchor <a> --apply`",
    });
  });

  it("passes a real anchor through untouched", () => {
    const flags = registerFlags({ values: { anchor: "talk:abc", home: "/h" } });

    expect(flags).toEqual({
      anchor: "talk:abc",
      bearsOn: undefined,
      branch: undefined,
      dir: undefined,
      home: "/h",
      priority: undefined,
      repo: undefined,
    });
  });
});
