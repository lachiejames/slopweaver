/**
 * The canonical Slack-timestamp conversions.
 *
 * The first case is a measured misreading: a Slack `ts` of `1788220579.306599` was read about 80 minutes
 * late. It is pinned as a literal rather than recomputed, so this test can actually fail if the derivation
 * moves.
 */
import { describe, expect, it } from "vitest";

import {
  isSlackTs,
  slackTsFromEpochMs,
  slackTsFromPermalink,
  slackTsToEpochMs,
  slackTsToIso,
} from "../../../lib/slackTs.js";

// register-class: slack-ts-hand-converted-to-iso (docs/recurring-failure-register/bindings.md)

describe("slackTsToIso", () => {
  it("derives the instant a run once read 80 minutes wrong", () => {
    expect(slackTsToIso({ ts: "1788220579.306599" })).toBe("2026-08-31T23:56:19.000Z");
  });

  it("is NOT the hand-converted value that reached two deadman rules", () => {
    expect(slackTsToIso({ ts: "1788220579.306599" })).not.toBe("2026-09-01T01:16:19.000Z");
  });

  it("accepts a bare seconds value, which is what a person types", () => {
    expect(slackTsToIso({ ts: "1788220579" })).toBe("2026-08-31T23:56:19.000Z");
  });

  it("floors to whole seconds, so the fractional disambiguator never reaches the instant", () => {
    expect(slackTsToIso({ ts: "1788220579.999999" })).toBe("2026-08-31T23:56:19.000Z");
  });

  it("refuses a non-timestamp rather than answering for it", () => {
    expect(slackTsToIso({ ts: "not-a-ts" })).toBe(undefined);
  });

  it("refuses the empty string, which the implementations it replaced read as the epoch", () => {
    expect(slackTsToIso({ ts: "" })).toBe(undefined);
  });
});

describe("isSlackTs", () => {
  it("accepts both the bare-seconds and fractional forms", () => {
    expect(isSlackTs({ ts: "1788220579" })).toBe(true);
    expect(isSlackTs({ ts: "1788220579.306599" })).toBe(true);
  });

  it("rejects a padded value, so whitespace never resolves to an instant by accident", () => {
    expect(isSlackTs({ ts: " 1788220579 " })).toBe(false);
  });

  it("rejects a permalink, which carries a ts but is not one", () => {
    expect(isSlackTs({ ts: "https://acme.slack.com/archives/C1/p1788220579306599" })).toBe(false);
  });
});

describe("slackTsToEpochMs", () => {
  it("keeps the fractional digits an ordering comparison needs", () => {
    expect(slackTsToEpochMs({ ts: "1788220579.306599" })).toBe(1_788_220_579_307);
  });

  it("refuses a non-timestamp", () => {
    expect(slackTsToEpochMs({ ts: "yesterday" })).toBe(undefined);
  });
});

describe("slackTsFromEpochMs", () => {
  it("round-trips through slackTsToEpochMs at millisecond resolution", () => {
    expect(slackTsFromEpochMs({ ms: 1_788_220_579_306 })).toBe("1788220579.306000");
    expect(slackTsToEpochMs({ ts: slackTsFromEpochMs({ ms: 1_788_220_579_306 }) })).toBe(1_788_220_579_306);
  });

  it("pads a sub-second value to Slack's six fractional digits", () => {
    expect(slackTsFromEpochMs({ ms: 4 })).toBe("0.004000");
  });
});

describe("slackTsFromPermalink", () => {
  it("puts the dot back before the last six digits of a parent link", () => {
    expect(slackTsFromPermalink({ permalink: "https://acme.slack.com/archives/C1/p1788220579306599" })).toBe(
      "1788220579.306599",
    );
  });

  it("reads the addressed message's ts off a reply link, not its thread_ts query", () => {
    expect(
      slackTsFromPermalink({
        permalink: "https://acme.slack.com/archives/C1/p1788220579306599?thread_ts=1788000000.000100&cid=C1",
      }),
    ).toBe("1788220579.306599");
  });

  it("says nothing about a link carrying no timestamp segment", () => {
    expect(slackTsFromPermalink({ permalink: "https://acme.slack.com/archives/C1" })).toBe(undefined);
  });
});
