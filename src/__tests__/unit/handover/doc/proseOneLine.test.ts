/**
 * `parseHandoverDoc` holds every flat field to one line and keeps `summary` exact.
 *
 * The flat reader decodes a quoted value's `\n` (`handover/flatScalarCodec.ts`), so a field could now hold a real
 * break; its readers print it as one line of a row, a refusal or a recap (five such printers exist), so the
 * doc reader collapses it once. `summary` is the exception: `--keep-lines` stores lines code reads back.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";
import { encodeFlatScalar } from "../../../../handover/flatScalarCodec.js";

const BROKEN = "legit\n  FORGED ROW";

const text = [
  "---",
  "slug: prose-row",
  "kind: ask",
  `summary: ${encodeFlatScalar({ value: BROKEN })}`,
  `problem: ${encodeFlatScalar({ value: BROKEN })}`,
  `statusSummary: ${encodeFlatScalar({ value: BROKEN })}`,
  `pausedOn: ${encodeFlatScalar({ value: BROKEN })}`,
  `settlementReason: ${encodeFlatScalar({ value: BROKEN })}`,
  `evidence: [${encodeFlatScalar({ value: BROKEN })}, owner/repo#1]`,
  `repo: ${encodeFlatScalar({ value: BROKEN })}`,
  `branch: ${encodeFlatScalar({ value: BROKEN })}`,
  `artifact: ${encodeFlatScalar({ value: BROKEN })}`,
  "status: ready",
  "---",
  "",
].join("\n");

describe("parseHandoverDoc — prose on one line", () => {
  const doc = parseHandoverDoc({ path: "/h/prose-row.md", text });

  it("collapses a decoded break in every prose field to one space", () => {
    expect([doc.problem, doc.statusSummary, doc.pausedOn, doc.settlementReason]).toEqual([
      "legit FORGED ROW",
      "legit FORGED ROW",
      "legit FORGED ROW",
      "legit FORGED ROW",
    ]);
    expect(doc.evidence).toEqual(["legit FORGED ROW", "owner/repo#1"]);
  });

  // The board prints `repo:` and `why:` as lines of their own, so an identifier is held to one line too.
  it("collapses a decoded break in an identifier field the board prints on its own line", () => {
    expect([doc.repo, doc.branch, doc.artifact]).toEqual(["legit FORGED ROW", "legit FORGED ROW", "legit FORGED ROW"]);
  });

  // A NEXT LINE, which JavaScript's `\s` does not match, is collapsed too.
  it("collapses a NEXT LINE in a prose field", () => {
    const nel = parseHandoverDoc({
      path: "/h/nel.md",
      text: `---\nslug: nel\nstatus: paused\npausedOn: alice\nstatusSummary: legit${String.fromCharCode(0x85)}FORGED ROW\n---\n`,
    });
    expect(nel.statusSummary).toBe("legit FORGED ROW");
  });

  // The nested YAML reader decodes `\n` in a `doneWhen.path`, and the problem quoting it is a refusal line.
  it("holds a problem quoting a decoded nested value to one line", () => {
    const probe = parseHandoverDoc({
      path: "/h/probe.md",
      text: '---\nslug: probe\nstatus: ready\ndoneWhen:\n  - path: "/tmp/legit\\nFORGED REFUSAL"\n---\n',
    });
    expect(probe.problems.length).toBe(1);
    expect(probe.problems.filter((problem) => /[\n\r]/u.test(problem))).toEqual([]);
    expect(probe.problems[0]).toContain("/tmp/legit FORGED REFUSAL");
  });

  // `talk find-card` and two other summary printers collapse with `\s`, which omits U+0085.
  it("spells a summary's Unicode line breaks as LF, so a printer collapsing \\s folds them", () => {
    const breaks = [0x85, 0x2028, 0x2029].map((code) => String.fromCharCode(code)).join("b");
    const read = parseHandoverDoc({
      path: "/h/u85.md",
      text: `---\nslug: u85\nstatus: ready\nsummary: ${encodeFlatScalar({ value: `a${breaks}c` })}\n---\n`,
    });
    expect(read.summary).toBe("a\nb\nb\nc");
  });

  it("keeps the summary exactly as written, its break included", () => {
    expect(doc.summary).toBe(BROKEN);
  });
});
