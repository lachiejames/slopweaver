/**
 * `parsePrunePlan` — the pure half of `knowledge prune`: every line validated before anything is read, one
 * refusal refusing the whole plan, and a rewrite that kept its claim text keeping its id and history.
 */
import { describe, expect, it } from "vitest";

import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { memoryId } from "../../../knowledge/memoryRow.js";
import { parsePrunePlan } from "../../../knowledge/prune.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NONE = noInstallDomains({ home: "/tmp/sw-home" });

const LESSON_ROW = {
  behaviourChange: "check the resolver before repeating a credential claim",
  caveat: null,
  claim: "an unset destination refuses the backup rather than guessing a directory",
  domain: "store",
  evidence: "resolveBackupDestination returns a typed error when no source names a directory",
  kind: "lesson",
  learner: "fleet",
  repro: "sed -n '1,40p' src/store/backup/destination.ts",
  retrievalCue: "backup key missing",
  run: "ad-hoc",
  surface: "repo",
  tier: 3,
  verdict: "confirmed",
};

const line = (step: Record<string, unknown>): string => JSON.stringify(step);

describe("parsePrunePlan", () => {
  it("retires a named claim and carries its reason", () => {
    const plan = unwrap(
      parsePrunePlan({
        installDomains: NONE,
        lines: [line({ id: "l-aaaa", op: "retire", reason: "canon carries it" })],
      }),
    );
    expect(plan.retiredIds).toEqual(["l-aaaa"]);
    expect(plan.steps).toEqual([{ id: "l-aaaa", op: "retire", reason: "canon carries it" }]);
  });

  it("retires the replaced claim when the rewrite lands under a new id", () => {
    const plan = unwrap(
      parsePrunePlan({
        installDomains: NONE,
        lines: [line({ op: "replace", reason: "claim was false", replaces: "l-old", row: LESSON_ROW })],
      }),
    );
    const expectedId = memoryId({ claim: LESSON_ROW.claim, domain: "store", kind: "lesson" });
    expect(plan.retiredIds).toEqual(["l-old"]);
    expect(plan.steps).toMatchObject([
      { draft: { id: expectedId, importKey: null }, op: "replace", replaces: "l-old" },
    ]);
  });

  it("keeps a claim whose rewrite kept its text, so its history stays", () => {
    const sameId = memoryId({ claim: LESSON_ROW.claim, domain: "store", kind: "lesson" });
    const plan = unwrap(
      parsePrunePlan({
        installDomains: NONE,
        lines: [line({ op: "replace", reason: "evidence refreshed", replaces: sameId, row: LESSON_ROW })],
      }),
    );
    expect(plan.retiredIds).toEqual([]);
  });

  it("gives a preference null facets even when the row names a tier", () => {
    const plan = unwrap(
      parsePrunePlan({
        installDomains: NONE,
        lines: [line({ op: "replace", reason: "r", replaces: "p-old", row: { ...LESSON_ROW, kind: "preference" } })],
      }),
    );
    expect(plan.steps).toMatchObject([{ draft: { id: expect.stringMatching(/^p-/u), surface: null, tier: null } }]);
  });

  it("refuses the whole plan on one malformed line and names every refused line", () => {
    const problems = unwrapErr(
      parsePrunePlan({
        installDomains: NONE,
        lines: [
          line({ id: "l-aaaa", op: "retire", reason: "fine" }),
          "not json",
          line({ id: "l-bbbb", op: "retire" }),
          line({ op: "replace", reason: "r", replaces: "l-cccc", row: { ...LESSON_ROW, tier: 9 } }),
        ],
      }),
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      "line 2: not JSON",
      "line 3: reason is required — a retired claim says why it left",
      "line 4: tier must be one of 1|2|3|4 on a lesson",
    ]);
    expect(problems.map((problem) => problem.code)).toEqual([
      "PLAN_LINE_REFUSED",
      "PLAN_LINE_REFUSED",
      "PLAN_LINE_REFUSED",
    ]);
  });

  it("refuses a claim named twice", () => {
    const problems = unwrapErr(
      parsePrunePlan({
        installDomains: NONE,
        lines: [
          line({ id: "l-aaaa", op: "retire", reason: "one" }),
          line({ op: "replace", reason: "two", replaces: "l-aaaa", row: LESSON_ROW }),
        ],
      }),
    );
    expect(problems.map((problem) => problem.message)).toEqual(["line 2: l-aaaa is already named on line 1"]);
  });

  it("refuses a rewrite whose new claim id the same plan retires", () => {
    const landing = memoryId({ claim: LESSON_ROW.claim, domain: "store", kind: "lesson" });
    const problems = unwrapErr(
      parsePrunePlan({
        installDomains: NONE,
        lines: [
          line({ id: landing, op: "retire", reason: "duplicate" }),
          line({ op: "replace", reason: "r", replaces: "l-old", row: LESSON_ROW }),
        ],
      }),
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      `line 2: the rewrite of l-old lands on ${landing}, which this plan retires`,
    ]);
  });

  it("refuses a rewrite filed under a retired domain, naming the domain it folded into", () => {
    const problems = unwrapErr(
      parsePrunePlan({
        installDomains: NONE,
        lines: [line({ op: "replace", reason: "r", replaces: "l-old", row: { ...LESSON_ROW, domain: "backup" } })],
      }),
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      'line 1: domain "backup" folded into "store" — record it under --domain store',
    ]);
  });

  it("skips blank lines and accepts an empty plan", () => {
    const plan = unwrap(parsePrunePlan({ installDomains: NONE, lines: ["", "  "] }));
    expect(plan.steps.length).toBe(0);
    expect(plan.retiredIds).toEqual([]);
  });
});
