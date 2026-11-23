/*
 * The disclosure's shape. Its whole job is that a wall of text cannot reach the page UNASKED, and that a field
 * the owner chose to expand is still theirs to read: an over-cap line draws a head inside the cap and carries the whole
 * behind "show all". The assertions check the head against the cap for every folded line, so a change that let a
 * long head through would redden here, and the whole against the input, so one that dropped text would too.
 *
 * Under `site/__tests__/unit/` because `site/lib/` is outside `src/` and a file under `src/` may not
 * import one outside it (TS6059, the CI `compile` job); the unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import {
  LINE_MAX_CHARS,
  type RecordLine,
  recordAbsent,
  recordLine,
  recordLink,
  recordMaybe,
} from "../../lib/recordLines";

/**
 * A recorded ask, in the shape of `slopweaver handover list --json`, slug
 * `linear-cycle-hygiene-and-project-updates`. It is the wall itself — this is why the cap exists.
 */
const REAL_QUESTION =
  "Card 4 is the whole ask: the 36-row cycle list at https://claude.ai/code/artifact/f58ac5c6-844e-4caf-ac9f-30aac56c19df needs one word per line before anything moves. 8 close-with-comment (a merged PR says the work shipped), 25 trace (nothing attached, unmoved since the cycle opened, and no origin thread was read here), 3 project-update (drafts composed, health proposed). EEEE-589 is IN the list and has NOT been closed. Every mechanism to act now exists and none of it has fired: cycle reconcile (N107, b0b27133), fields-only on any issue (N115, 8157d398), project-update create (N119, 0bd55df6). Answer the list, or say which rows to drop.";

/**
 * A finding act's `witness`, in the shape `slopweaver autonomy list --json` prints,
 * action `finding-pr.supabase-carries-the-new-schema-with-every-table` — 476 characters, no sentence break before its cap to the
 * splitter, the notice that read as a bug.
 */
const REAL_WITNESS =
  "open a pull request on main: finding gate: supabase-carries-the-new-schema-with-every-table is an unruled fleet finding, and this door reaches nobody but you — · proceeding on this session's judgement under rule 10, recorded in the autonomy ledger · supabase-carries-the-new-schema-with-every-table is a fleet finding, not something we asked for — observed by workspace:93 from handover reconcile --json uncoveredOutcomes acme-schema-and-the-types at pass 601, zero ready rows";

/**
 * The folded arm of a line this test built folded, or a throw naming what it was instead.
 *
 * @param line a line the test expects to be folded
 * @returns its head and whole
 */
function foldedOf({ line }: { line: RecordLine }): { head: string; whole: string } {
  if (line.kind !== "folded") {
    throw new Error(`expected a folded line, got ${line.kind}`);
  }
  return { head: line.head, whole: line.whole };
}

describe("recordLine", () => {
  it("keeps a short field exactly as the register wrote it", () => {
    const line = recordLine({ label: "section", value: "WAITING ON OWNER" });
    expect(line).toEqual({ kind: "value", label: "section", value: "WAITING ON OWNER" });
  });

  it("collapses the whitespace a register's own line breaks left behind", () => {
    const line = recordLine({ label: "parked", value: "  waiting on\n  the owner  " });
    expect(line).toEqual({ kind: "value", label: "parked", value: "waiting on the owner" });
  });

  it("keeps a value of exactly the cap", () => {
    const line = recordLine({ label: "why", value: "x".repeat(LINE_MAX_CHARS) });
    expect(line).toEqual({ kind: "value", label: "why", value: "x".repeat(LINE_MAX_CHARS) });
  });

  it("folds whole leading sentences while they fit, and never a part of the next one", () => {
    const first = `${"a".repeat(100)}.`;
    const second = `${"b".repeat(100)}.`;
    const third = `${"c".repeat(100)}.`;
    const line = recordLine({ label: "why", value: `${first} ${second} ${third}` });
    expect(line).toEqual({
      head: `${first} ${second}`,
      kind: "folded",
      label: "why",
      whole: `${first} ${second} ${third}`,
    });
  });

  it("cuts a first sentence past the cap at its last fitting word — never mid-word, never an ellipsis", () => {
    const words = Array.from({ length: 50 }, () => "word").join(" ");
    const { head, whole } = foldedOf({ line: recordLine({ label: "why", value: `${words}.` }) });
    expect([head, head.length, whole]).toEqual([Array.from({ length: 48 }, () => "word").join(" "), 239, `${words}.`]);
  });

  it("draws an empty head when not even the first word fits, with the whole still carried", () => {
    const token = "x".repeat(LINE_MAX_CHARS + 1);
    expect(recordLine({ label: "why", value: token })).toEqual({
      head: "",
      kind: "folded",
      label: "why",
      whole: token,
    });
  });

  it("folds an expanded witness, and carries every character of it", () => {
    const { head, whole } = foldedOf({ line: recordLine({ label: "witness", value: REAL_WITNESS }) });
    expect([whole, REAL_WITNESS.length, head.length <= LINE_MAX_CHARS, whole.startsWith(head)]).toEqual([
      REAL_WITNESS,
      476,
      true,
      true,
    ]);
  });

  it("folds the real recorded ask at its first sentence", () => {
    const { head, whole } = foldedOf({ line: recordLine({ label: "question", value: REAL_QUESTION }) });
    expect([head, whole.length]).toEqual([
      "Card 4 is the whole ask: the 36-row cycle list at https://claude.ai/code/artifact/f58ac5c6-844e-4caf-ac9f-30aac56c19df needs one word per line before anything moves.",
      643,
    ]);
  });

  it("answers the empty string for a field the register wrote as whitespace", () => {
    expect(recordLine({ label: "steer", value: "   " })).toEqual({ kind: "value", label: "steer", value: "" });
  });
});

describe("recordAbsent", () => {
  it("says the absence rather than rendering a gap", () => {
    expect(recordAbsent({ label: "priority", why: "no priority" })).toEqual({
      kind: "absent",
      label: "priority",
      why: "no priority",
    });
  });

  // Codex review r2 on this branch: an absence sentence was the one arm drawn unmeasured.
  it("folds an absence sentence past the cap, as it folds a value", () => {
    const why = "x".repeat(LINE_MAX_CHARS + 1);
    expect(recordAbsent({ label: "priority", why })).toEqual({
      head: "",
      kind: "folded",
      label: "priority",
      whole: why,
    });
  });
});

describe("recordLink", () => {
  it("never measures the ADDRESS — a permalink is one click, not a wall", () => {
    const url = `https://github.com/acme/widgets/changes/seven?${"q".repeat(LINE_MAX_CHARS)}`;
    expect(recordLink({ label: "pull request", text: "acme/widgets#7", url })).toEqual({
      kind: "link",
      label: "pull request",
      text: "acme/widgets#7",
      url,
    });
  });

  // Review pass r1 (no-wall-reaches-the-page) found this arm missing: recordLink was the one constructor
  // that measured nothing, so a ledger subject that is neither a GitHub pull nor a Slack archive URL —
  // `subjectLabel`'s fallthrough, which answers the raw subject — reached the fold whole.
  it("MEASURES the label, folding an unbounded one as a value folds — drawn as text, not a link", () => {
    const url = `https://example.internal/${"p".repeat(LINE_MAX_CHARS + 1)}`;
    const label = `${"p ".repeat(LINE_MAX_CHARS)}`.trim();
    const line = recordLink({ label: "subject", text: label, url });
    expect(line).toEqual({
      head: "p ".repeat(LINE_MAX_CHARS / 2).trim(),
      kind: "folded",
      label: "subject",
      whole: label,
    });
  });

  it("keeps a label of exactly the cap, with its address intact", () => {
    const url = "https://example.internal/x";
    expect(recordLink({ label: "subject", text: "p".repeat(LINE_MAX_CHARS), url })).toEqual({
      kind: "link",
      label: "subject",
      text: "p".repeat(LINE_MAX_CHARS),
      url,
    });
  });
});

describe("recordMaybe", () => {
  it("states the absence when the register did not write the field", () => {
    expect(recordMaybe({ absent: "no priority", label: "priority", value: undefined })).toEqual({
      kind: "absent",
      label: "priority",
      why: "no priority",
    });
  });

  it("goes through the fold when the register did write it", () => {
    const line = recordMaybe({ absent: "no question", label: "question", value: REAL_QUESTION });
    expect(foldedOf({ line }).whole).toBe(REAL_QUESTION);
  });
});

describe("the disclosure a real row produces", () => {
  it("carries the walls IN, draws no head past the cap, and drops no character", () => {
    const inputs = [
      { label: "slug", value: "linear-cycle-hygiene-and-project-updates" },
      { label: "section", value: "WAITING ON OWNER" },
      { label: "question", value: REAL_QUESTION },
      { label: "parked", value: `waiting on the owner: ${REAL_QUESTION}` },
      { label: "witness", value: REAL_WITNESS },
      { label: "token", value: "x".repeat(LINE_MAX_CHARS * 2) },
    ];
    const lines = inputs.map((input) => recordLine(input));
    const folded = lines.filter((line) => line.kind === "folded");
    // Both halves, per `testing.md`: the input CARRIES the walls, so a fix that dropped a field would redden the
    // first assertion, one that drew a long head the second, and one that lost text the third.
    expect(folded.map((line) => line.label)).toEqual(["question", "parked", "witness", "token"]);
    expect(folded.filter((line) => line.head.length > LINE_MAX_CHARS)).toEqual([]);
    expect(folded.map((line) => line.whole.length)).toEqual([643, 665, 476, LINE_MAX_CHARS * 2]);
  });
});
