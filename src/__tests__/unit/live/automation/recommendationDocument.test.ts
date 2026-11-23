/**
 * Reading one `--recommendations` value in each of its three spellings — an inline JSON object, a path, and
 * `-` for stdin through a plain fake — and the two ways it fails: a document that cannot be read or decoded
 * (`RECOMMENDATION_DOCUMENT_UNREADABLE`) and a decoded one that is not a set (`RECOMMENDATION_SET_INVALID`).
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveRecommendationSet } from "../../../../live/automation/recommendationDocument.js";

const SET_JSON =
  '{"recommendations":[{"act":"tune-monitor","change":"renotify 60 to 0 so a stuck group stops re-posting hourly",' +
  '"evidenceUrl":"https://ap1.datadoghq.com/monitors/700001","clears":"webhook-failures"}]}';

const EXPECTED_SET = {
  recommendations: [
    {
      act: "tune-monitor",
      change: "renotify 60 to 0 so a stuck group stops re-posting hourly",
      clears: "webhook-failures",
      evidenceUrl: "https://ap1.datadoghq.com/monitors/700001",
    },
  ],
};

/** A stdin that must never be read: the inline and path spellings never touch it. */
const STDIN_UNTOUCHED = async (): Promise<string> => {
  throw new Error("stdin was read for a value that is not '-'");
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recommendation-document-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("resolveRecommendationSet", () => {
  it("parses an inline JSON object, leading whitespace and all, without reading stdin", async () => {
    const result = await resolveRecommendationSet({ readInput: STDIN_UNTOUCHED, value: `  ${SET_JSON}` });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(EXPECTED_SET);
  });

  it("reads and parses a path to a JSON file", async () => {
    const path = join(dir, "recommendations.json");
    writeFileSync(path, SET_JSON, "utf8");

    const result = await resolveRecommendationSet({ readInput: STDIN_UNTOUCHED, value: path });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(EXPECTED_SET);
  });

  it("reads the document from stdin for '-'", async () => {
    const reads: string[] = [];

    const result = await resolveRecommendationSet({
      readInput: async () => {
        reads.push("stdin");
        return SET_JSON;
      },
      value: "-",
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(EXPECTED_SET);
    expect(reads).toEqual(["stdin"]);
  });

  it("refuses a path that is not a readable file as RECOMMENDATION_DOCUMENT_UNREADABLE, naming the path", async () => {
    const path = join(dir, "absent.json");

    const result = await resolveRecommendationSet({ readInput: STDIN_UNTOUCHED, value: path });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("RECOMMENDATION_DOCUMENT_UNREADABLE");
    const detail = `'${path}' is not a readable file: ENOENT: no such file or directory, open '${path}'`;
    expect(failure).toEqual({
      code: "RECOMMENDATION_DOCUMENT_UNREADABLE",
      detail,
      message: `--recommendations could not be read: ${detail}`,
    });
  });

  it("refuses an inline object that is not JSON as RECOMMENDATION_DOCUMENT_UNREADABLE", async () => {
    const result = await resolveRecommendationSet({ readInput: STDIN_UNTOUCHED, value: "{recommendations: []}" });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("RECOMMENDATION_DOCUMENT_UNREADABLE");
    const detail = "Expected property name or '}' in JSON at position 1 (line 1 column 2)";
    expect(failure).toEqual({
      code: "RECOMMENDATION_DOCUMENT_UNREADABLE",
      detail,
      message: `--recommendations could not be read: ${detail}`,
    });
  });

  it("refuses a decoded object that is not a set as RECOMMENDATION_SET_INVALID, listing the issue", async () => {
    const result = await resolveRecommendationSet({ readInput: STDIN_UNTOUCHED, value: '{"recommendations":[]}' });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.code).toBe("RECOMMENDATION_SET_INVALID");
    expect(failure).toEqual({
      code: "RECOMMENDATION_SET_INVALID",
      issues: ["recommendations: Too small: expected array to have >=1 items"],
      message:
        "--recommendations is not a recommendation set: recommendations: Too small: expected array to have >=1 items",
    });
  });
});
