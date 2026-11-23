import { describe, expect, it } from "vitest";

import type { RefreshResult } from "../../../../../cli/commands/refresh/core.js";
import { refreshFailureClosingLine } from "../../../../../cli/commands/refresh/failureClosingLine.js";
import type { CorpusSource } from "../../../../../corpus/types.js";

const result = ({ source, errors = [] }: { source: CorpusSource; errors?: readonly string[] }): RefreshResult => ({
  deduped: 0,
  errors,
  ok: errors.length === 0,
  projected: 1,
  source,
  warnings: [],
  written: 1,
});

describe("refreshFailureClosingLine", () => {
  it("is null when every leg succeeded", () => {
    expect(
      refreshFailureClosingLine({
        deriveFailures: [],
        hydrationFailures: [],
        numbersOnly: false,
        results: [result({ source: "slack" })],
        storeFailures: [],
      }),
    ).toBe(null);
  });

  it("names a store failure the hydration lanes would otherwise bury, with its source", () => {
    expect(
      refreshFailureClosingLine({
        deriveFailures: [],
        hydrationFailures: [],
        numbersOnly: false,
        results: [result({ source: "slack" })],
        storeFailures: [{ reason: "connect ECONNREFUSED 127.0.0.1:54322", source: "slack" }],
      }),
    ).toBe("refresh failed: store: slack: connect ECONNREFUSED 127.0.0.1:54322");
  });

  it("keeps every failure in the order the legs ran: ingest, store, members, structures, derive", () => {
    expect(
      refreshFailureClosingLine({
        deriveFailures: [{ reason: "corpus unreadable", source: null }],
        hydrationFailures: [
          { lane: "members", reason: "roster read crashed" },
          { lane: "structures", reason: "channel list crashed" },
        ],
        numbersOnly: false,
        results: [
          result({ errors: ["gap one", "gap two"], source: "linear" }),
          result({ source: "github" }),
          result({ errors: ["token revoked"], source: "slack" }),
        ],
        storeFailures: [{ reason: "this run has no store seam wired, so nothing can reach the store", source: null }],
      }),
    ).toBe(
      "refresh failed: ingest: linear: gap one; ingest: linear: gap two; ingest: slack: token revoked; " +
        "store: this run has no store seam wired, so nothing can reach the store; members: roster read crashed; " +
        "structures: channel list crashed; derive: corpus unreadable",
    );
  });

  it("stands a failed ingest source with no error text on a stated reason rather than dropping it", () => {
    const silent: RefreshResult = { ...result({ source: "notion" }), ok: false };
    expect(
      refreshFailureClosingLine({
        deriveFailures: [],
        hydrationFailures: [],
        numbersOnly: false,
        results: [silent],
        storeFailures: [],
      }),
    ).toBe("refresh failed: ingest: notion: failed without an error message");
  });

  it("states a reason for a blank one on every leg, so no clause ends bare", () => {
    const blank: RefreshResult = { ...result({ source: "slack" }), errors: ["", " \n"], ok: false };
    expect(
      refreshFailureClosingLine({
        deriveFailures: [{ reason: "\t", source: null }],
        hydrationFailures: [],
        numbersOnly: false,
        results: [blank],
        storeFailures: [{ reason: "", source: "slack" }],
      }),
    ).toBe(
      "refresh failed: ingest: slack: failed without an error message; " +
        "store: slack: failed without an error message; derive: failed without an error message",
    );
  });

  it("collapses a reason's line breaks so the logger writes ONE line", () => {
    expect(
      refreshFailureClosingLine({
        deriveFailures: [{ reason: "first half\n  second\thalf\r\n", source: null }],
        hydrationFailures: [],
        numbersOnly: false,
        results: [],
        storeFailures: [],
      }),
    ).toBe("refresh failed: derive: first half second half");
  });

  it("withholds every reason under --numbers-only while keeping each leg and source", () => {
    const line = refreshFailureClosingLine({
      deriveFailures: [{ reason: "could not read /Users/someone/.slopweaver/corpus/silver", source: null }],
      hydrationFailures: [{ lane: "members", reason: "workspace T0SECRET unreadable" }],
      numbersOnly: true,
      results: [result({ errors: ["channel C0SECRET gone"], source: "slack" })],
      storeFailures: [{ reason: "password authentication failed for user someone", source: "slack" }],
    });
    expect(line).toBe(
      "refresh failed: ingest: slack: [withheld]; store: slack: [withheld]; members: [withheld]; derive: [withheld]",
    );
  });
});
