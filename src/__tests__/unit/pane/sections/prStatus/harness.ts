/*
 * What more than one PULL REQUESTS section test file reads: the fresh Slack window and the one pull request a case
 * spreads its field under test over. A plain module, not a `*.test.ts`, so no test registers twice. It was split
 * out when the section's test suite became one file per behaviour.
 */
import { measured } from "../../../../../measurement/status.js";
import type { PrRecord } from "../../../../../pane/sections/prStatus.js";
import type { AskWindow } from "../../../../../pane/sections/slackAsk.js";

/** A green check, as `gh` shapes it. */
const GREEN = [{ __typename: "CheckRun", conclusion: "SUCCESS", name: "build", status: "COMPLETED" }];

/**
 * A Slack window read to an instant newer than every fixture here, so an absence IS reportable.
 *
 * The tests that care about the corpus being behind supply their own window instead.
 */
export const FRESH: AskWindow = {
  newestIso: measured({ value: "2099-01-01T00:00:00.000Z" }),
  startIso: "2000-01-01T00:00:00.000Z",
};

/**
 * One pull request, spread over so only the field under test varies.
 *
 * @returns an approved, green, mergeable pull request with each overridden field replaced
 */
export function pr(over: Partial<PrRecord> = {}): PrRecord {
  return {
    author: "an-author",
    body: "",
    headRefName: "a-branch",
    isDraft: false,
    mergeable: "MERGEABLE",
    number: 1,
    repo: "slopweaver/slopweaver",
    reviewDecision: "APPROVED",
    reviewRequests: [],
    statusCheckRollup: GREEN,
    title: "a title",
    updatedAt: "2026-08-06T00:00:00Z",
    url: "https://example.invalid/1",
    ...over,
  };
}
