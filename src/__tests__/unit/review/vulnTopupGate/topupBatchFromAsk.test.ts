import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { BACKFILL_MARKER, backfillSentence, topupBatchFromAsk } from "../../../../review/vulnTopupBatchRead.js";
import { backfillAsk, line } from "./harness.js";

describe("topupBatchFromAsk", () => {
  it("reads every batch member back, in the order the brief lists them", () => {
    const ask = [
      "Raise 2.",
      "",
      "The batch, worst CVSS first:",
      line({ name: "@scope/b", number: 9 }),
      line({ name: "a", number: 3 }),
    ].join("\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      { alertNumber: 9, packageName: "@scope/b" },
      { alertNumber: 3, packageName: "a" },
    ]);
  });

  it("reads the batch off a real board row, whose summary the frontmatter reader hands back still escaped", () => {
    // The shape `handover register --ask` wrote for a vulnfix top-up row.
    const text = [
      "---",
      "slug: vulnfix-topup-owner-name-1789805089763",
      "kind: ask",
      String.raw`summary: "Raise 1.\n\nThe batch, worst CVSS first:\n  - pdfjs-dist (npm, yarn.lock) — high CVSS 8.8, GHSA-wgrm-67xf-hhpq, alert https://github.com/owner/name/security/dependabot/26, first patched 4.2.67"`,
      "status: ready",
      "---",
      "",
    ].join("\n");
    const summary = parseHandoverDoc({ path: "/board/row.md", text }).summary!;

    expect(unwrap(topupBatchFromAsk({ ask: summary, repo: "owner/name" }))).toEqual([
      { alertNumber: 26, packageName: "pdfjs-dist" },
    ]);
  });

  it("reads a brief `handover register` flattened onto one line, as it did to every older ask", () => {
    const ask = [
      "Raise 2 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      "",
      "The batch, worst CVSS first:",
      line({ name: "@scope/b", number: 9 }),
      line({ name: "a", number: 3 }),
      "",
      "Once every pull request above is open, post the batch:",
      "  slopweaver vulnfix digest --family security --repo owner/name --post",
    ]
      .join("\n")
      .replace(/\s+/gu, " ");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      { alertNumber: 9, packageName: "@scope/b" },
      { alertNumber: 3, packageName: "a" },
    ]);
  });

  it("reads a batch line at any indentation, so a whitespace change cannot shrink the batch", () => {
    const ask = [
      "Raise 3.",
      line({ name: "pkg-7", number: 7 }),
      ` ${line({ name: "pkg-8", number: 8 })}`,
      `\t${line({ name: "pkg-9", number: 9 }).trimStart()}`,
    ].join("\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      { alertNumber: 7, packageName: "pkg-7" },
      { alertNumber: 8, packageName: "pkg-8" },
      { alertNumber: 9, packageName: "pkg-9" },
    ]);
  });

  it("refuses a differently indented dash line with no alert, rather than skipping it", () => {
    const ask = [line({ name: "pkg-7", number: 7 }), "   - pkg-8 (npm, yarn.lock) — high CVSS 8.8"].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "a batch line carries no Dependabot alert: - pkg-8 (npm, yarn.lock) — high CVSS 8.8",
    ]);
  });

  it("refuses a batch line that carries no alert, rather than dropping it", () => {
    const ask = ["The batch:", "  - lodash (npm, yarn.lock) — high CVSS 8.8"].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "a batch line carries no Dependabot alert: - lodash (npm, yarn.lock) — high CVSS 8.8",
    ]);
  });

  it("refuses a batch line citing two alerts, rather than judging whichever one a pattern caught (Codex review)", () => {
    const twice = `${line({ name: "pkg-a", number: 7 })}, note alert https://github.com/owner/name/security/dependabot/9`;

    expect(unwrapErr(topupBatchFromAsk({ ask: ["Raise 1.", twice].join("\n"), repo: "owner/name" }))).toEqual([
      `a batch line cites more than one Dependabot alert: ${twice.trim()}`,
    ]);
  });

  it("refuses a batch line citing another repository's alert, whose number means nothing here (Codex review)", () => {
    const foreign = line({ name: "pkg-a", number: 7 }).replace("owner/name", "other/repo");

    expect(unwrapErr(topupBatchFromAsk({ ask: ["Raise 1.", foreign].join("\n"), repo: "owner/name" }))).toEqual([
      `a batch line cites an alert in other/repo, not owner/name: ${foreign.trim()}`,
    ]);
  });

  it("refuses an alert number past the safe-integer range, which would round onto another alert", () => {
    const huge = line({ name: "pkg", number: 7 }).replace("dependabot/7", "dependabot/9007199254740993");

    expect(unwrapErr(topupBatchFromAsk({ ask: ["Raise 1.", huge].join("\n"), repo: "owner/name" }))).toEqual([
      `a batch line cites alert 9007199254740993, too large to read exactly: ${huge.trim()}`,
    ]);
  });

  it("refuses an alert listed twice", () => {
    const ask = [line({ name: "a", number: 3 }), line({ name: "b", number: 3 })].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual(["alert 3 is listed twice"]);
  });

  it("refuses a brief listing fewer members than it says it raised, whatever shape the missing lines took (Codex review)", () => {
    const ask = [
      "Raise 3 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      line({ name: "pkg-1", number: 1 }),
      line({ name: "pkg-2", number: 2 }).replace("  - ", "  * "),
      line({ name: "pkg-3", number: 3 }).replace("  - ", "  * "),
    ].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief says it raises 3 but lists 1 batch line(s)",
    ]);
  });

  it("refuses a brief that does not say how many it raised", () => {
    expect(unwrapErr(topupBatchFromAsk({ ask: line({ name: "pkg-1", number: 1 }), repo: "owner/name" }))).toEqual([
      "the brief does not open with how many it raises",
    ]);
  });

  it("refuses a brief with no batch lines, so a misparse can never read as 'nothing was raised'", () => {
    expect(unwrapErr(topupBatchFromAsk({ ask: "Raise pull requests.", repo: "owner/name" }))).toEqual([
      "the brief lists no batch lines at all",
    ]);
  });

  it("reads the backfill lines as members too, after the batch, so a backfill a seat raised counts toward the gate", () => {
    const ask = backfillAsk({ backfill: 2 });

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      { alertNumber: 1141, packageName: "happy-dom" },
      { alertNumber: 1108, packageName: "@modelcontextprotocol/sdk" },
      { alertNumber: 1084, packageName: "shell-quote" },
      { alertNumber: 842, packageName: "find-my-way" },
    ]);
  });

  it("reads a flattened older brief quoting the backfill sentence exactly as it did before", () => {
    const ask = [
      "Raise 1 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      line({ name: "pkg", number: 1 }),
      `Note: ${backfillSentence({ count: 1 })} is merely quoted here.`,
    ].join(" ");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([{ alertNumber: 1, packageName: "pkg" }]);
  });

  it("reads a backfill brief off a real board row, its line breaks still escaped", () => {
    const ask = backfillAsk({ backfill: 2 }).replaceAll("\n", String.raw`\n`);

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" })).map((read) => read.alertNumber)).toEqual([
      1141, 1108, 1084, 842,
    ]);
  });

  it("refuses backfill lines no backfill sentence counts, rather than reading them as an over-long batch", () => {
    const ask = backfillAsk({ backfill: 2 }).replace(BACKFILL_MARKER, "Then these");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief says it raises 2 but lists 4 batch line(s)",
    ]);
  });

  it("refuses a backfill sentence whose count is not the lines under it", () => {
    const ask = backfillAsk({ backfill: 1 });

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief says it raises 2 with a backfill of 1 but lists 4 batch line(s)",
    ]);
  });

  it("refuses a backfill sentence with no line under it, rather than reading the last batch member as backfill", () => {
    const ask = [
      "Raise 2 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      line({ name: "happy-dom", number: 1141 }),
      line({ name: "@modelcontextprotocol/sdk", number: 1108 }),
      line({ name: "shell-quote", number: 1084 }),
      backfillSentence({ count: 1 }),
    ].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief states a backfill of 1 but lists 0 line(s) under it",
    ]);
  });

  it("refuses a backfill of 0 with a line under it, rather than reading that line as a batch member", () => {
    const ask = [
      "Raise 2 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      line({ name: "happy-dom", number: 1141 }),
      backfillSentence({ count: 0 }),
      line({ name: "shell-quote", number: 1084 }),
    ].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief states a backfill of 0 but lists 1 line(s) under it",
    ]);
  });

  it("refuses a brief stating its backfill twice, rather than reading whichever came first", () => {
    const ask = `${backfillAsk({ backfill: 2 })}\n${backfillSentence({ count: 2 })}`;

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief states its backfill 2 times",
    ]);
  });

  it("reads an older brief whose free text quotes the backfill marker mid-line exactly as it did before", () => {
    const ask = [
      "Raise 1 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
      line({ name: "happy-dom", number: 1141 }),
      `loop CI on every "${backfillSentence({ count: 1 })}" leg, then post.`,
    ].join("\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      { alertNumber: 1141, packageName: "happy-dom" },
    ]);
  });

  it("refuses a backfill count past the safe-integer range", () => {
    const ask = backfillAsk({ backfill: 2 }).replace(`${BACKFILL_MARKER} 2:`, `${BACKFILL_MARKER} 9007199254740993:`);

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "owner/name" }))).toEqual([
      "the brief states a backfill of 9007199254740993, too large to read exactly",
    ]);
  });
});
