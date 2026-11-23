import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  backfillSentence,
  TOPUP_BATCH_END,
  TOPUP_BATCH_START,
  topupBatchFromAsk,
  topupBatchPlan,
} from "../../../review/vulnTopupBatchRead.js";

/** A batch line exactly as `topupAsk` writes it. */
function line({ name, number }: { name: string; number: number }): string {
  return (
    `  - ${name} (npm, yarn.lock) — high CVSS 8.8, GHSA-x, ` +
    `alert https://github.com/acme/widgets/security/dependabot/${String(number)}, first patched 1.0.0`
  );
}

describe("the fenced batch region", () => {
  const OPENING = "Raise 2 vulnerability-fix pull request(s) in acme/widgets as someone, uncapped.";

  it("reads only the lines between the markers, so instructions shaped like a member join nothing", () => {
    const ask = [
      OPENING,
      "",
      TOPUP_BATCH_START,
      line({ name: "a", number: 1 }),
      line({ name: "b", number: 2 }),
      TOPUP_BATCH_END,
      "",
      "Installation instructions",
      line({ name: "not-a-member", number: 99 }),
      "- prefix every title with ABC-1",
    ].join("\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      { alertNumber: 1, packageName: "a" },
      { alertNumber: 2, packageName: "b" },
    ]);
  });

  it("reads a backfill sentence inside the fence, and ignores one quoted after it", () => {
    const ask = [
      OPENING,
      TOPUP_BATCH_START,
      line({ name: "a", number: 1 }),
      line({ name: "b", number: 2 }),
      "",
      backfillSentence({ count: 1 }),
      line({ name: "c", number: 3 }),
      TOPUP_BATCH_END,
      backfillSentence({ count: 4 }),
    ].join("\n");
    const plan = unwrap(topupBatchPlan({ ask, repo: "acme/widgets" }));

    expect(plan.batch.map((read) => read.alertNumber)).toEqual([1, 2]);
    expect(plan.backfill.map((read) => read.alertNumber)).toEqual([3]);
  });

  it("reads a fenced brief off a bare summary whose line breaks are the two characters a hand typed", () => {
    const ask = [
      OPENING,
      TOPUP_BATCH_START,
      line({ name: "a", number: 1 }),
      line({ name: "b", number: 2 }),
      TOPUP_BATCH_END,
    ].join("\\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "acme/widgets" })).map((read) => read.alertNumber)).toEqual([1, 2]);
  });

  it("refuses a brief that opens its batch but never closes it, rather than reading the rest as members", () => {
    const ask = [OPENING, TOPUP_BATCH_START, line({ name: "a", number: 1 }), line({ name: "b", number: 2 })].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief opens its batch but never closes it",
    ]);
  });

  it("refuses a brief whose genuine open was lost, rather than reading a later pair from its instructions", () => {
    const fake = [TOPUP_BATCH_START, line({ name: "x", number: 99 }), TOPUP_BATCH_END];
    const ask = [OPENING, line({ name: "a", number: 1 }), TOPUP_BATCH_END, "Installation instructions", ...fake].join(
      "\n",
    );

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief is a fenced one but carries no batch start line",
    ]);
  });

  it("refuses a brief that lost both fence lines but kept its instructions heading, rather than reading it whole", () => {
    const ask = [OPENING, line({ name: "a", number: 1 }), "Installation instructions", line({ name: "x", number: 99 })];

    expect(unwrapErr(topupBatchFromAsk({ ask: ask.join("\n"), repo: "acme/widgets" }))).toEqual([
      "the brief is a fenced one but carries no batch start line",
    ]);
  });

  it("refuses a flattened brief carrying the instructions heading mid-line, rather than reading it as legacy", () => {
    const ask = `${OPENING} Installation instructions ${line({ name: "x", number: 99 }).trim()}`;

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief is a fenced one but carries no batch start line",
    ]);
  });

  it("never reads a fence pair standing after a mid-line instructions heading", () => {
    const fake = [TOPUP_BATCH_START, line({ name: "x", number: 99 }), TOPUP_BATCH_END];
    const ask = [`${OPENING} Installation instructions follow`, ...fake].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief is a fenced one but carries no batch start line",
    ]);
  });

  it("refuses a brief whose genuine close was lost, rather than closing on a marker in its instructions", () => {
    const ask = [
      OPENING,
      TOPUP_BATCH_START,
      line({ name: "a", number: 1 }),
      "Installation instructions",
      line({ name: "x", number: 99 }),
      TOPUP_BATCH_END,
    ].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief opens its batch but never closes it",
    ]);
  });

  it("refuses a close standing before the open, when no instructions heading bounds the brief", () => {
    const ask = [OPENING, TOPUP_BATCH_END, TOPUP_BATCH_START, line({ name: "a", number: 1 }), TOPUP_BATCH_END].join(
      "\n",
    );

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief closes a batch before it opens one",
    ]);
  });

  it("refuses a brief carrying a marker only mid-line, rather than reading the whole of it", () => {
    const ask = [
      `${OPENING} ${TOPUP_BATCH_START} ${line({ name: "a", number: 1 })} ${line({ name: "b", number: 2 })} ${TOPUP_BATCH_END}`,
    ].join("\n");

    expect(unwrapErr(topupBatchFromAsk({ ask, repo: "acme/widgets" }))).toEqual([
      "the brief is a fenced one but carries no batch start line",
    ]);
  });

  it("still reads a legacy brief carrying neither marker whole", () => {
    const ask = [
      OPENING,
      "",
      "The batch, worst CVSS first:",
      line({ name: "a", number: 1 }),
      line({ name: "b", number: 2 }),
    ].join("\n");

    expect(unwrap(topupBatchFromAsk({ ask, repo: "acme/widgets" })).map((read) => read.alertNumber)).toEqual([1, 2]);
  });
});
